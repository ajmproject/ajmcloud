import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getValidAccessToken } from '@/lib/google-drive';
import dns from 'dns';

try {
  dns.setDefaultResultOrder('ipv4first');
} catch {}

// In-memory cache to eliminate repeated Supabase queries during video range buffering
const fileMetadataCache = new Map<
  string,
  {
    data: {
      id: string;
      name: string;
      mime_type: string;
      size_bytes: number;
      google_drive_file_id: string;
      drive_account_id: string;
    };
    cachedAt: number;
  }
>();

const accessTokenCache = new Map<string, { token: string; expiresAt: number }>();

async function getCachedAccessToken(driveAccountId: string): Promise<string> {
  const cached = accessTokenCache.get(driveAccountId);
  const now = Date.now();
  if (cached && cached.expiresAt > now + 60 * 1000) {
    return cached.token;
  }

  const freshToken = await getValidAccessToken(driveAccountId);
  // Cache for 45 minutes
  accessTokenCache.set(driveAccountId, {
    token: freshToken,
    expiresAt: now + 45 * 60 * 1000,
  });
  return freshToken;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // 1. Ambil metadata file (gunakan in-memory cache jika sudah ada)
    let fileData: {
      id: string;
      name: string;
      mime_type: string;
      size_bytes: number;
      google_drive_file_id: string;
      drive_account_id: string;
    } | null = null;

    const cachedFile = fileMetadataCache.get(id);
    if (cachedFile && Date.now() - cachedFile.cachedAt < 15 * 60 * 1000) {
      fileData = cachedFile.data;
    } else {
      const { data: file, error: fileErr } = await supabaseAdmin
        .from('files')
        .select('id, name, mime_type, size_bytes, google_drive_file_id, drive_account_id')
        .eq('id', id)
        .single();

      if (fileErr || !file || !file.google_drive_file_id) {
        return new NextResponse('File tidak ditemukan', { status: 404 });
      }

      fileData = file as any;
      fileMetadataCache.set(id, {
        data: file as any,
        cachedAt: Date.now(),
      });
    }

    if (!fileData) {
      return new NextResponse('File tidak ditemukan', { status: 404 });
    }

    // 2. Dapatkan token akses Google Drive instan dari memory cache
    const accessToken = await getCachedAccessToken(fileData.drive_account_id);

    // 3. Forward Range Header dari pemutar video klien untuk mendukung seeking/scrubbing
    const clientRange = request.headers.get('range');
    const googleHeaders: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
    };

    if (clientRange) {
      googleHeaders['Range'] = clientRange;
    }

    // 4. Streaming langsung dari Google Drive API
    const googleStreamUrl = `https://www.googleapis.com/drive/v3/files/${fileData.google_drive_file_id}?alt=media`;
    const googleRes = await fetch(googleStreamUrl, {
      headers: googleHeaders,
    });

    if (!googleRes.ok && googleRes.status !== 206) {
      // Jika token expired di Google, invalidate cache dan coba sekali lagi
      if (googleRes.status === 401) {
        accessTokenCache.delete(fileData.drive_account_id);
      }
      const errText = await googleRes.text().catch(() => '');
      return new NextResponse(`Google Drive Stream Error: ${googleRes.status} - ${errText}`, {
        status: googleRes.status,
      });
    }

    // 5. Susun response header streaming video
    const responseHeaders = new Headers();
    responseHeaders.set('Content-Type', fileData.mime_type || googleRes.headers.get('content-type') || 'video/mp4');
    responseHeaders.set('Accept-Ranges', 'bytes');
    responseHeaders.set('Cache-Control', 'public, max-age=86400');

    const contentRange = googleRes.headers.get('content-range');
    if (contentRange) {
      responseHeaders.set('Content-Range', contentRange);
    }

    const contentLength = googleRes.headers.get('content-length');
    if (contentLength) {
      responseHeaders.set('Content-Length', contentLength);
    }

    return new Response(googleRes.body, {
      status: googleRes.status,
      headers: responseHeaders,
    });
  } catch (error: any) {
    return new NextResponse(`Stream error: ${error.message}`, { status: 500 });
  }
}
