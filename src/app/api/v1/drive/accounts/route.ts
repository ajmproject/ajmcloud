import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/supabase-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { ApiResponse } from '@/types';

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, { requireActive: true });

    // Fetch accounts for this user (never select encrypted tokens)
    const { data: accounts, error } = await supabaseAdmin
      .from('google_drive_accounts')
      .select('id, google_email, account_name, storage_total_bytes, storage_used_bytes, status, is_active, created_at, updated_at')
      .eq('user_id', auth.userId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch accounts: ${error.message}`);
    }

    // Calculate aggregated logical storage
    const aggregated = (accounts || []).reduce(
      (acc, curr) => {
        if (curr.is_active && curr.status === 'connected') {
          acc.totalBytes += Number(curr.storage_total_bytes || 0);
          acc.usedBytes += Number(curr.storage_used_bytes || 0);
        }
        return acc;
      },
      { totalBytes: 0, usedBytes: 0 }
    );

    return NextResponse.json<ApiResponse>({
      success: true,
      data: {
        accounts: accounts || [],
        storageSummary: {
          totalBytes: aggregated.totalBytes,
          usedBytes: aggregated.usedBytes,
          availableBytes: Math.max(0, aggregated.totalBytes - aggregated.usedBytes),
          totalAccounts: (accounts || []).length,
          activeAccounts: (accounts || []).filter((a) => a.is_active && a.status === 'connected').length,
        },
      },
    });
  } catch (error: any) {
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: 'FETCH_ACCOUNTS_ERROR',
          message: error.message || 'Gagal mengambil daftar akun Google Drive.',
        },
      },
      { status: 400 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, { requireActive: true });
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get('id');

    if (!accountId) {
      throw new Error('Parameter id akun Google Drive wajib disertakan.');
    }

    // Ensure account belongs to user
    const { data: account, error: fetchError } = await supabaseAdmin
      .from('google_drive_accounts')
      .select('id, google_email')
      .eq('id', accountId)
      .eq('user_id', auth.userId)
      .single();

    if (fetchError || !account) {
      throw new Error('Akun Google Drive tidak ditemukan atau Anda tidak memiliki akses.');
    }

    // Delete record from AjmCloud (does not delete user's Google Drive files)
    const { error: deleteError } = await supabaseAdmin
      .from('google_drive_accounts')
      .delete()
      .eq('id', accountId);

    if (deleteError) {
      throw new Error(`Gagal memutuskan akun: ${deleteError.message}`);
    }

    return NextResponse.json<ApiResponse>({
      success: true,
      data: {
        message: `Koneksi akun Google Drive (${account.google_email}) berhasil diputuskan.`,
      },
    });
  } catch (error: any) {
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: 'DISCONNECT_ACCOUNT_ERROR',
          message: error.message || 'Gagal memutuskan akun Google Drive.',
        },
      },
      { status: 400 }
    );
  }
}
