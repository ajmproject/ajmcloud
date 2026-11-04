import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
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

    const { data: file, error: fileErr } = await supabaseAdmin
      .from('files')
      .select('id, name, mime_type, size_bytes')
      .eq('id', id)
      .single();

    if (fileErr || !file) {
      return new NextResponse('File tidak ditemukan', { status: 404 });
    }

    const streamUrl = `/api/v1/files/${file.id}/stream`;
    const fileName = file.name || 'Video Player';

    const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${fileName} - AjmCloud Player</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: #090D16;
      color: #FFFFFF;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      height: 100vh;
      overflow: hidden;
    }
    header {
      padding: 16px 20px;
      display: flex;
      align-items: center;
      gap: 12px;
      background: rgba(15, 23, 42, 0.9);
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      z-index: 10;
    }
    .title {
      font-size: 15px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
    }
    .video-container {
      flex: 1;
      display: flex;
      justify-content: center;
      align-items: center;
      background: #000000;
      position: relative;
    }
    video {
      width: 100%;
      height: 100%;
      max-height: 85vh;
      outline: none;
    }
    footer {
      padding: 12px 20px;
      background: rgba(15, 23, 42, 0.9);
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      display: flex;
      justifyContent: space-between;
      align-items: center;
    }
    .download-btn {
      background: #2563EB;
      color: #FFFFFF;
      text-decoration: none;
      padding: 10px 18px;
      border-radius: 9999px;
      font-size: 13px;
      font-weight: bold;
    }
  </style>
</head>
<body>
  <header>
    <div class="title">${fileName}</div>
  </header>
  <div class="video-container">
    <video src="${streamUrl}" controls autoplay playsinline preload="metadata"></video>
  </div>
  <footer>
    <span style="color: #94A3B8; font-size: 12px;">AjmCloud Direct Streaming</span>
    <a href="${streamUrl}" class="download-btn" download="${fileName}">Unduh File</a>
  </footer>
</body>
</html>`;

    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
    });
  } catch (error: any) {
    return new NextResponse(`Error: ${error.message}`, { status: 500 });
  }
}
