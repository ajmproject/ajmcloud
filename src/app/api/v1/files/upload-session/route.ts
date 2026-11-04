import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/supabase-auth';
import { selectDriveAccountForUpload } from '@/lib/storage-router';
import { createGoogleResumableSession, getValidAccessToken } from '@/lib/google-drive';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { ApiResponse } from '@/types';
import { z } from 'zod';

const uploadSessionSchema = z.object({
  fileName: z.string().min(1, 'Nama file tidak boleh kosong'),
  mimeType: z.string().min(1, 'MIME type tidak boleh kosong'),
  sizeBytes: z.number().positive('Ukuran file harus lebih dari 0 bytes'),
});

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, { requireActive: true });

    const body = await request.json();
    const validation = uploadSessionSchema.safeParse(body);

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

    const { fileName, mimeType, sizeBytes } = validation.data;

    // 1. Select the best eligible Google Drive account for this file
    const targetAccount = await selectDriveAccountForUpload(auth.userId, sizeBytes);

    // 2. Obtain a valid Google Access Token (auto-refresh if expired)
    const accessToken = await getValidAccessToken(targetAccount.id);

    // 3. Create Google Drive resumable upload session
    const resumableSessionUri = await createGoogleResumableSession(accessToken, {
      fileName,
      mimeType,
      sizeBytes,
    });

    // 4. Record the upload job in database
    const { data: job, error: jobError } = await supabaseAdmin
      .from('upload_jobs')
      .insert({
        user_id: auth.userId,
        drive_account_id: targetAccount.id,
        file_name: fileName,
        mime_type: mimeType,
        size_bytes: sizeBytes,
        resumable_session_url: resumableSessionUri,
        status: 'uploading',
      })
      .select('id')
      .single();

    if (jobError || !job) {
      throw new Error(`Failed to create upload job: ${jobError?.message}`);
    }

    // 5. Return session details for direct client-to-Google-Drive streaming
    return NextResponse.json<ApiResponse>({
      success: true,
      data: {
        uploadJobId: job.id,
        resumableSessionUri,
        googleDriveAccountId: targetAccount.id,
        targetEmail: targetAccount.google_email,
      },
    });
  } catch (error: any) {
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: 'UPLOAD_SESSION_ERROR',
          message: error.message || 'Gagal membuat sesi upload ke Google Drive.',
        },
      },
      { status: 400 }
    );
  }
}
