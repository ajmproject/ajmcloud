import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/supabase-auth';
import { syncGoogleDriveFiles } from '@/lib/google-drive';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { ApiResponse } from '@/types';

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, { requireActive: true });

    const { searchParams } = new URL(request.url);
    const specificAccountId = searchParams.get('accountId');

    // Fetch user's connected google drive accounts
    let query = supabaseAdmin
      .from('google_drive_accounts')
      .select('id, google_email, status, is_active')
      .eq('user_id', auth.userId)
      .eq('status', 'connected');

    if (specificAccountId) {
      query = query.eq('id', specificAccountId);
    }

    const { data: accounts, error: accError } = await query;

    if (accError) {
      throw new Error(`Gagal memuat akun Google Drive: ${accError.message}`);
    }

    if (!accounts || accounts.length === 0) {
      return NextResponse.json<ApiResponse>(
        {
          success: true,
          data: {
            message: 'Tidak ada akun Google Drive yang terhubung untuk disinkronkan.',
            totalSynced: 0,
            accountsCount: 0,
          },
        },
        { status: 200 }
      );
    }

    // Sinkronkan seluruh akun Google Drive secara PARALEL untuk kecepatan maksimal
    const syncResults = await Promise.all(
      accounts.map(async (acc) => {
        try {
          const { totalSynced } = await syncGoogleDriveFiles(acc.id, auth.userId);
          return {
            accountId: acc.id,
            email: acc.google_email,
            totalSynced,
            success: true,
          };
        } catch (syncErr: any) {
          return {
            accountId: acc.id,
            email: acc.google_email,
            totalSynced: 0,
            success: false,
            error: syncErr.message,
          };
        }
      })
    );

    const grandTotalSynced = syncResults.reduce((sum, r) => sum + r.totalSynced, 0);

    return NextResponse.json<ApiResponse>(
      {
        success: true,
        data: {
          totalSynced: grandTotalSynced,
          accountsCount: accounts.length,
          results: syncResults,
        },
      },
      { status: 200 }
    );
  } catch (error: any) {
    const isAuthError = error.message?.startsWith('UNAUTHORIZED') || error.message?.startsWith('ACCOUNT_');
    const statusCode = isAuthError ? 401 : 500;

    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: isAuthError ? 'UNAUTHORIZED' : 'SYNC_FAILED',
          message: error.message || 'Gagal menyinkronkan file dari Google Drive.',
        },
      },
      { status: statusCode }
    );
  }
}
