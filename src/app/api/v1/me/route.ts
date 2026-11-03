import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/supabase-auth';
import { ApiResponse } from '@/types';

export async function GET(request: NextRequest) {
  try {
    // Note: requireActive is false here so pending or blocked users can still check their profile status
    const auth = await authenticateRequest(request, { requireActive: false });

    return NextResponse.json<ApiResponse>({
      success: true,
      data: {
        user: {
          id: auth.userId,
          email: auth.email,
          username: auth.profile.username,
          fullName: auth.profile.full_name,
          avatarUrl: auth.profile.avatar_url,
          status: auth.profile.status,
          roles: auth.roles,
          isAdmin: auth.isAdmin,
          createdAt: auth.profile.created_at,
        },
      },
    });
  } catch (error: any) {
    const isUnauthorized = error.message?.startsWith('UNAUTHORIZED');
    const statusCode = isUnauthorized ? 401 : 400;

    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: isUnauthorized ? 'UNAUTHORIZED' : 'BAD_REQUEST',
          message: error.message || 'Gagal memverifikasi identitas pengguna.',
        },
      },
      { status: statusCode }
    );
  }
}
