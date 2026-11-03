export type AccountStatus = 'pending' | 'active' | 'blocked';
export type UserRole = 'admin' | 'user';
export type DriveAccountStatus = 'connected' | 'needs_reconnect' | 'revoked' | 'disabled';
export type UploadStatus = 'pending' | 'uploading' | 'verifying' | 'completed' | 'failed' | 'cancelled';
export type FileCategory = 'photo' | 'video' | 'document' | 'archive' | 'audio' | 'other';

export interface UserProfile {
  id: string;
  email: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  status: AccountStatus;
  created_at: string;
  updated_at: string;
}

export interface GoogleDriveAccount {
  id: string;
  user_id: string;
  google_email: string;
  account_name: string | null;
  storage_total_bytes: number;
  storage_used_bytes: number;
  status: DriveAccountStatus;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CloudFile {
  id: string;
  user_id: string;
  google_drive_account_id: string;
  google_file_id: string;
  name: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  extension: string | null;
  category: FileCategory;
  thumbnail_url: string | null;
  is_starred: boolean;
  is_trashed: boolean;
  trashed_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface UploadJob {
  id: string;
  user_id: string;
  google_drive_account_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  resumable_session_uri: string | null;
  status: UploadStatus;
  bytes_uploaded: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}
