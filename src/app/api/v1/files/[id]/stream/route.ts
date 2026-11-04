import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getValidAccessToken } from '@/lib/google-drive';
import dns from 'dns';

try {
  dns.setDefaultResultOrder('ipv4first');
} catch {}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // 1. Ambil metadata file dari database
    const { data: file, error: fileErr } = await supabaseAdmin
      .from('files')
      .select('id, name, mime_type, size_bytes, google_drive_file_id, drive_account_id')
      .eq('id', id)
      .single();

    if (fileErr || !file || !file.google_drive_file_id) {
      return new NextResponse('File tidak ditemukan', { status: 404 });
    }

    // 2. Dapatkan token akses Google Drive yang valid (otomatis refresh jika kadaluarsa)
    const accessToken = await getValidAccessToken(file.drive_account_id);

    // 3. Forward Range Header dari pemutar video klien untuk mendukung seeking/scrubbing
    const clientRange = request.headers.get('range');
    const googleHeaders: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
    };

    if (clientRange) {
      googleHeaders['Range'] = clientRange;
    }

    // 4. Streaming langsung dari Google Drive API
    const googleStreamUrl = `https://www.googleapis.com/drive/v3/files/${file.google_drive_file_id}?alt=media`;
    const googleRes = await fetch(googleStreamUrl, {
      headers: googleHeaders,
    });

    if (!googleRes.ok && googleRes.status !== 206) {
      const errText = await googleRes.text().catch(() => '');
      return new NextResponse(`Google Drive Stream Error: ${googleRes.status} - ${errText}`, {
        status: googleRes.status,
      });
    }

    // 5. Susun response header streaming video
    const responseHeaders = new Headers();
    responseHeaders.set('Content-Type', file.mime_type || googleRes.headers.get('content-type') || 'video/mp4');
    responseHeaders.set('Accept-Ranges', 'bytes');
    responseHeaders.set('Cache-Control', 'public, max-age=3600');

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
