import { supabaseAdmin } from './supabase-admin';
import { FileCategory, GoogleDriveAccount } from '@/types';

/**
 * Classify file category from MIME type and extension.
 */
export function determineFileCategory(mimeType: string, extension?: string | null): FileCategory {
  const mime = mimeType.toLowerCase();
  const ext = (extension || '').toLowerCase().replace('.', '');

  if (
    mime.startsWith('image/') ||
    ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'svg', 'bmp', 'tiff'].includes(ext)
  ) {
    return 'photo';
  }

  if (
    mime.startsWith('video/') ||
    ['mp4', 'mov', 'mkv', 'avi', 'webm', '3gp', 'flv', 'wmv'].includes(ext)
  ) {
    return 'video';
  }

  if (
    mime.startsWith('audio/') ||
    ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'wma'].includes(ext)
  ) {
    return 'audio';
  }

  if (
    mime.includes('pdf') ||
    mime.includes('word') ||
    mime.includes('sheet') ||
    mime.includes('presentation') ||
    mime.includes('text') ||
    ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'rtf'].includes(ext)
  ) {
    return 'document';
  }

  if (
    mime.includes('zip') ||
    mime.includes('tar') ||
    mime.includes('rar') ||
    mime.includes('7z') ||
    ['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].includes(ext)
  ) {
    return 'archive';
  }

  return 'other';
}

/**
 * Selects an eligible Google Drive account for an incoming upload.
 * Considers connection status, available quota, and active upload reservations.
 */
export async function selectDriveAccountForUpload(
  userId: string,
  requiredSizeBytes: number
): Promise<GoogleDriveAccount> {
  // 1. Fetch all active and connected Google Drive accounts for this user
  const { data: accounts, error } = await supabaseAdmin
    .from('google_drive_accounts')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'connected')
    .eq('is_active', true);

  if (error || !accounts || accounts.length === 0) {
    throw new Error('NO_DRIVE_ACCOUNT: Tidak ada akun Google Drive yang terhubung atau aktif.');
  }

  // 2. Fetch pending upload reservations to prevent race conditions on quota
  const { data: pendingJobs } = await supabaseAdmin
    .from('upload_jobs')
    .select('drive_account_id, size_bytes')
    .eq('user_id', userId)
    .in('status', ['pending', 'uploading', 'verifying']);

  const reservedSpaceByAccount = new Map<string, number>();
  (pendingJobs || []).forEach((job) => {
    const current = reservedSpaceByAccount.get(job.drive_account_id) || 0;
    reservedSpaceByAccount.set(job.drive_account_id, current + Number(job.size_bytes));
  });

  // 3. Find candidates with sufficient space
  const candidates = accounts
    .map((account) => {
      const total = Number(account.storage_total_bytes || 0);
      const used = Number(account.storage_used_bytes || 0);
      const reserved = reservedSpaceByAccount.get(account.id) || 0;
      // If total is 0 (unlimited or not fetched yet), default to a large available space
      const available = total > 0 ? total - (used + reserved) : Number.MAX_SAFE_INTEGER;

      return {
        account: account as GoogleDriveAccount,
        availableSpace: available,
      };
    })
    .filter((candidate) => candidate.availableSpace >= requiredSizeBytes)
    .sort((a, b) => b.availableSpace - a.availableSpace); // Prioritize account with largest free space

  if (candidates.length === 0) {
    throw new Error('INSUFFICIENT_STORAGE: Kapasitas pada semua akun Google Drive yang terhubung tidak mencukupi untuk file ini.');
  }

  return candidates[0].account;
}
