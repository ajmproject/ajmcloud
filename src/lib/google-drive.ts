import { google } from 'googleapis';
import { decryptToken, encryptToken } from './crypto';
import { supabaseAdmin } from './supabase-admin';
import { determineFileCategory } from './storage-router';

// Scope: Akses penuh ke Google Drive untuk membaca file yang sudah ada maupun menyimpan file baru
export const GOOGLE_DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive',
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

/**
 * Synchronizes files from the user's Google Drive account into AjmCloud's files table.
 * Highly optimized with parallel requests, pageSize: 250, and single-pass ID deduplication.
 */
export async function syncGoogleDriveFiles(
  driveAccountId: string,
  userId: string
): Promise<{ totalSynced: number }> {
  const accessToken = await getValidAccessToken(driveAccountId);
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  let totalSynced = 0;

  try {
    // Jalankan pengambilan Quota, File List pertama (250 file), dan ID yang sudah ada secara PARALEL
    const [aboutRes, listRes, existingRes] = await Promise.all([
      drive.about.get({ fields: 'storageQuota' }).catch((err) => {
        console.warn('Failed to fetch storageQuota:', err?.message);
        return null;
      }),
      drive.files.list({
        pageSize: 250,
        fields:
          'nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime, thumbnailLink, webViewLink, webContentLink)',
        q: "trashed = false and mimeType != 'application/vnd.google-apps.folder'",
        orderBy: 'createdTime desc',
      }),
      supabaseAdmin
        .from('files')
        .select('google_drive_file_id')
        .eq('drive_account_id', driveAccountId),
    ]);

    // 1. Update kuota akun ke database
    if (aboutRes?.data?.storageQuota) {
      const quota = aboutRes.data.storageQuota;
      const total = quota.limit ? Number(quota.limit) : 16106127360; // 15 GB default
      const used = quota.usage ? Number(quota.usage) : 0;
      await supabaseAdmin
        .from('google_drive_accounts')
        .update({
          storage_total_bytes: total,
          storage_used_bytes: used,
          updated_at: new Date().toISOString(),
        })
        .eq('id', driveAccountId);
    }

    // 2. Set ID file yang sudah ada di database untuk O(1) deduplication
    const existingIdSet = new Set(
      (existingRes?.data || []).map((f) => f.google_drive_file_id)
    );

    let currentList = listRes?.data?.files || [];
    let pageToken = listRes?.data?.nextPageToken || undefined;

    while (currentList.length > 0) {
      const recordsToInsert = [];

      for (const file of currentList) {
        if (!file.id || existingIdSet.has(file.id)) {
          continue;
        }

        existingIdSet.add(file.id); // Hindari duplikasi dalam batch yang sama

        const fileName = file.name || 'Untitled';
        const extension = fileName.includes('.') ? fileName.split('.').pop() || null : null;
        const mimeType = file.mimeType || 'application/octet-stream';
        const category = determineFileCategory(mimeType, extension);
        const sizeBytes = file.size ? Number(file.size) : 0;

        recordsToInsert.push({
          user_id: userId,
          drive_account_id: driveAccountId,
          google_drive_file_id: file.id,
          name: fileName,
          mime_type: mimeType,
          size_bytes: sizeBytes,
          category,
          thumbnail_url: file.thumbnailLink || null,
          view_url: file.webViewLink || null,
          download_url: (file as any).webContentLink || null,
          is_favorite: false,
          is_trashed: false,
          created_at: file.createdTime ? new Date(file.createdTime).toISOString() : new Date().toISOString(),
          updated_at: file.modifiedTime ? new Date(file.modifiedTime).toISOString() : new Date().toISOString(),
        });
      }

      if (recordsToInsert.length > 0) {
        const { error: insertErr } = await supabaseAdmin
          .from('files')
          .insert(recordsToInsert);

        if (insertErr) {
          console.error('Failed to insert synced files:', insertErr);
        } else {
          totalSynced += recordsToInsert.length;
        }
      }

      // Jika ada halaman berikutnya dan kuota sinkron masih belum melampaui batas
      if (pageToken && totalSynced < 500) {
        const nextRes: any = await drive.files.list({
          pageSize: 250,
          pageToken,
          fields:
            'nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime, thumbnailLink, webViewLink, webContentLink)',
          q: "trashed = false and mimeType != 'application/vnd.google-apps.folder'",
          orderBy: 'createdTime desc',
        });
        currentList = nextRes?.data?.files || [];
        pageToken = nextRes?.data?.nextPageToken || undefined;
      } else {
        break;
      }
    }
  } catch (listErr: any) {
    console.error('Google Drive fast sync error:', listErr?.message || listErr);
  }

  return { totalSynced };
}
