import { google } from 'googleapis';
import { decryptToken, encryptToken } from './crypto';
import { supabaseAdmin } from './supabase-admin';

// Scopes minimum: drive.file (hanya akses ke file yang diupload/dikelola AjmCloud) + email
export const GOOGLE_DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
];

function cleanEnvVal(val?: string): string {
  if (!val) return '';
  return val.trim().replace(/^["']|["']$/g, '');
}

export function getOAuth2Client() {
  const clientId = cleanEnvVal(process.env.GOOGLE_CLIENT_ID);
  const clientSecret = cleanEnvVal(process.env.GOOGLE_CLIENT_SECRET);
  const redirectUri = cleanEnvVal(process.env.GOOGLE_REDIRECT_URI);

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Google OAuth configuration is missing in environment variables.');
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/**
 * Generate Google OAuth consent URL for user to connect their Drive.
 * Passes state parameter containing user ID and anti-CSRF token.
 */
export function generateAuthUrl(state: string): string {
  const oauth2Client = getOAuth2Client();

  return oauth2Client.generateAuthUrl({
    access_type: 'offline', // Memerlukan refresh token
    prompt: 'consent',     // Memaksa persetujuan agar selalu mendapatkan refresh token
    scope: GOOGLE_DRIVE_SCOPES,
    state,
  });
}

/**
 * Exchange authorization code from Google OAuth callback for tokens.
 */
export async function exchangeCodeForTokens(code: string) {
  const oauth2Client = getOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.access_token) {
    throw new Error('Failed to retrieve access token from Google.');
  }

  // Set credentials to fetch the user's Google email
  oauth2Client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  const userInfo = await oauth2.userinfo.get();

  const googleEmail = userInfo.data.email;
  if (!googleEmail) {
    throw new Error('Failed to retrieve email for this Google account.');
  }

  return {
    tokens,
    googleEmail,
    name: userInfo.data.name || googleEmail,
  };
}

/**
 * Ensures an active access token is available. If expired, refreshes it using the stored refresh token.
 */
export async function getValidAccessToken(driveAccountId: string): Promise<string> {
  const { data: account, error } = await supabaseAdmin
    .from('google_drive_accounts')
    .select('*')
    .eq('id', driveAccountId)
    .single();

  if (error || !account) {
    throw new Error(`Google Drive account not found: ${driveAccountId}`);
  }

  const now = new Date();
  const expiry = account.token_expiry ? new Date(account.token_expiry) : null;

  // If token is still valid for at least 5 minutes, return it
  if (expiry && expiry.getTime() - now.getTime() > 5 * 60 * 1000) {
    return decryptToken(account.encrypted_access_token);
  }

  // Token is expiring or expired -> Refresh token
  const refreshToken = decryptToken(account.encrypted_refresh_token);
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  try {
    const refreshResponse = await oauth2Client.refreshAccessToken();
    const newTokens = refreshResponse.credentials;

    if (!newTokens.access_token) {
      throw new Error('Refresh failed: No access token returned');
    }

    const newExpiry = newTokens.expiry_date
      ? new Date(newTokens.expiry_date).toISOString()
      : new Date(Date.now() + 3600 * 1000).toISOString();

    // Update in database
    await supabaseAdmin
      .from('google_drive_accounts')
      .update({
        encrypted_access_token: encryptToken(newTokens.access_token),
        token_expiry: newExpiry,
        status: 'connected',
        updated_at: new Date().toISOString(),
      })
      .eq('id', driveAccountId);

    return newTokens.access_token;
  } catch (refreshErr) {
    // If refresh fails, mark account as needing reconnect
    await supabaseAdmin
      .from('google_drive_accounts')
      .update({
        status: 'needs_reconnect',
        updated_at: new Date().toISOString(),
      })
      .eq('id', driveAccountId);

    throw new Error(`Google Drive token refresh failed for ${account.google_email}. Reconnect required.`);
  }
}

/**
 * Creates a resumable upload session on Google Drive API.
 * Returns the resumable session URI where client can stream/upload bytes directly.
 */
export async function createGoogleResumableSession(
  accessToken: string,
  params: {
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    description?: string;
  }
): Promise<string> {
  const metadata = {
    name: params.fileName,
    description: params.description || 'Uploaded via AjmCloud',
  };

  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': params.mimeType,
        'X-Upload-Content-Length': params.sizeBytes.toString(),
      },
      body: JSON.stringify(metadata),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Google Drive API error initiating resumable upload: ${response.status} - ${errText}`);
  }

  const uploadUri = response.headers.get('Location');
  if (!uploadUri) {
    throw new Error('Google Drive API did not return Location header for resumable session.');
  }

  return uploadUri;
}
