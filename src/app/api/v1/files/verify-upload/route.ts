import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/supabase-auth';
import { getValidAccessToken } from '@/lib/google-drive';
import { determineFileCategory } from '@/lib/storage-router';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { ApiResponse } from '@/types';
import { google } from 'googleapis';
import { z } from 'zod';

const verifyUploadSchema = z.object({
  uploadJobId: z.string().uuid('ID upload job tidak valid'),
  googleFileId: z.string().min(1, 'Google File ID tidak boleh kosong'),
});

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, { requireActive: true });

    const body = await request.json();
    const validation = verifyUploadSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: validation.error.errors.map((e) => e.message).join(', '),
          },
        },
        { status: 400 }
      );
    }

    const { uploadJobId, googleFileId } = validation.data;

    // 1. Fetch upload job
    const { data: job, error: jobError } = await supabaseAdmin
      .from('upload_jobs')
      .select('*')
      .eq('id', uploadJobId)
      .eq('user_id', auth.userId)
      .single();

    if (jobError || !job) {
      throw new Error('Upload job tidak ditemukan atau bukan milik Anda.');
    }

    // 2. Fetch fresh token for the target drive account
    const accessToken = await getValidAccessToken(job.google_drive_account_id);

    // 3. Verify file exists directly on Google Drive API
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    const fileMetaResponse = await drive.files.get({
      fileId: googleFileId,
      fields: 'id, name, mimeType, size, thumbnailLink, webViewLink, createdTime',
    });

    const gFile = fileMetaResponse.data;
    if (!gFile.id) {
      throw new Error('File tidak ditemukan pada Google Drive.');
    }

    const finalSize = Number(gFile.size || job.size_bytes);
    const fileName = gFile.name || job.file_name;
    const extension = fileName.includes('.') ? fileName.split('.').pop() || null : null;
    const category = determineFileCategory(job.mime_type, extension);

    // 4. Save metadata to 'files' table
    const { data: newFile, error: fileInsertError } = await supabaseAdmin
      .from('files')
      .insert({
        user_id: auth.userId,
        drive_account_id: job.google_drive_account_id,
        google_drive_file_id: gFile.id,
        name: fileName,
        mime_type: job.mime_type,
        size_bytes: finalSize,
        category,
        thumbnail_url: gFile.thumbnailLink || null,
        view_url: gFile.webViewLink || null,
        download_url: (gFile as any).webContentLink || null,
        is_favorite: false,
        is_trashed: false,
      })
      .select('*')
      .single();

    if (fileInsertError || !newFile) {
      throw new Error(`Gagal menyimpan metadata file: ${fileInsertError?.message}`);
    }

    // 5. Update upload job status to completed
    await supabaseAdmin
      .from('upload_jobs')
      .update({
        status: 'completed',
        bytes_uploaded: finalSize,
        updated_at: new Date().toISOString(),
      })
      .eq('id', uploadJobId);

    // 6. Update storage_used_bytes on google_drive_accounts
    const { data: accountData } = await supabaseAdmin
      .from('google_drive_accounts')
      .select('storage_used_bytes')
      .eq('id', job.google_drive_account_id)
      .single();

    if (accountData) {
      const currentUsed = Number(accountData.storage_used_bytes || 0);
      await supabaseAdmin
        .from('google_drive_accounts')
        .update({
          storage_used_bytes: currentUsed + finalSize,
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.google_drive_account_id);
    }

    return NextResponse.json<ApiResponse>({
      success: true,
      data: {
        file: newFile,
      },
    });
  } catch (error: any) {
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: 'VERIFY_UPLOAD_ERROR',
          message: error.message || 'Gagal memverifikasi hasil upload ke Google Drive.',
        },
      },
      { status: 400 }
    );
  }
}
