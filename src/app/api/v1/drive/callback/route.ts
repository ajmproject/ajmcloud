import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeForTokens } from '@/lib/google-drive';
import { encryptToken } from '@/lib/crypto';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { ApiResponse } from '@/types';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const errorParam = searchParams.get('error');

    if (errorParam) {
      throw new Error(`Google OAuth error: ${errorParam}`);
    }

    if (!code || !state) {
      throw new Error('Missing code or state parameter from Google OAuth callback.');
    }

    // Decode and verify state
    let stateData: { userId: string; timestamp: number };
    try {
      const decoded = Buffer.from(state, 'base64url').toString('utf8');
      stateData = JSON.parse(decoded);
    } catch {
      throw new Error('Invalid or corrupted OAuth state parameter.');
    }

    // Verify state age (< 10 minutes)
    if (Date.now() - stateData.timestamp > 10 * 60 * 1000) {
      throw new Error('OAuth state has expired. Please try connecting your account again.');
    }

    // Exchange authorization code for tokens
    const { tokens, googleEmail, name } = await exchangeCodeForTokens(code);

    if (!tokens.access_token || !tokens.refresh_token) {
      throw new Error('Did not receive both access and refresh tokens. Ensure offline access is allowed.');
    }

    const encryptedAccessToken = encryptToken(tokens.access_token);
    const encryptedRefreshToken = encryptToken(tokens.refresh_token);
    const tokenExpiry = tokens.expiry_date
      ? new Date(tokens.expiry_date).toISOString()
      : new Date(Date.now() + 3600 * 1000).toISOString();

    // Upsert into google_drive_accounts table
    const { data: driveAccount, error: dbError } = await supabaseAdmin
      .from('google_drive_accounts')
      .upsert(
        {
          user_id: stateData.userId,
          google_email: googleEmail,
          account_name: name,
          encrypted_access_token: encryptedAccessToken,
          encrypted_refresh_token: encryptedRefreshToken,
          token_expiry: tokenExpiry,
          status: 'connected',
          is_active: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,google_email' }
      )
      .select('id, google_email, account_name, status, is_active')
      .single();

    if (dbError) {
      throw new Error(`Failed to save Google Drive account: ${dbError.message}`);
    }

    // Return HTML success response (or redirect) for browser/web view
    return new NextResponse(
      `<!DOCTYPE html>
      <html>
        <head>
          <title>AjmCloud — Google Drive Terhubung</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0f172a; color: #f8fafc; }
            .card { background: #1e293b; padding: 2rem; border-radius: 1rem; text-align: center; max-width: 400px; box-shadow: 0 10px 25px rgba(0,0,0,0.3); }
            h1 { color: #38bdf8; font-size: 1.5rem; margin-bottom: 0.5rem; }
            p { color: #94a3b8; font-size: 0.95rem; line-height: 1.5; }
            .badge { display: inline-block; background: #0369a1; color: white; padding: 0.25rem 0.75rem; border-radius: 9999px; font-weight: 500; font-size: 0.85rem; margin: 1rem 0; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>Berhasil Terhubung!</h1>
            <div class="badge">${googleEmail}</div>
            <p>Akun Google Drive berhasil dihubungkan ke AjmCloud. Anda dapat menutup halaman ini dan kembali ke aplikasi.</p>
          </div>
        </body>
      </html>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  } catch (error: any) {
    return new NextResponse(
      `<!DOCTYPE html>
      <html>
        <head>
          <title>AjmCloud — Gagal Menghubungkan</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0f172a; color: #f8fafc; }
            .card { background: #1e293b; padding: 2rem; border-radius: 1rem; text-align: center; max-width: 400px; box-shadow: 0 10px 25px rgba(0,0,0,0.3); }
            h1 { color: #f43f5e; font-size: 1.5rem; margin-bottom: 0.5rem; }
            p { color: #94a3b8; font-size: 0.95rem; line-height: 1.5; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>Gagal Menghubungkan</h1>
            <p>${error.message || 'Terjadi kesalahan saat memproses otorisasi Google Drive.'}</p>
          </div>
        </body>
      </html>`,
      { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}
