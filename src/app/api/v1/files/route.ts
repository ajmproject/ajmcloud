import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/supabase-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { ApiResponse } from '@/types';

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, { requireActive: true });
    const { searchParams } = new URL(request.url);

    const category = searchParams.get('category');
    const isStarred = searchParams.get('isStarred');
    const isTrashed = searchParams.get('isTrashed') === 'true';
    const search = searchParams.get('search');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '30', 10)));
    const offset = (page - 1) * limit;

    let query = supabaseAdmin
      .from('files')
      .select('*', { count: 'exact' })
      .eq('user_id', auth.userId)
      .eq('is_trashed', isTrashed)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (category) {
      query = query.eq('category', category);
    }

    if (isStarred === 'true') {
      query = query.eq('is_starred', true);
    }

    if (search) {
      query = query.ilike('name', `%${search}%`);
    }

    const { data: files, count, error } = await query;

    if (error) {
      throw new Error(`Failed to list files: ${error.message}`);
    }

    return NextResponse.json<ApiResponse>({
      success: true,
      data: {
        files: files || [],
        pagination: {
          page,
          limit,
          totalItems: count || 0,
          totalPages: Math.ceil((count || 0) / limit),
        },
      },
    });
  } catch (error: any) {
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: 'LIST_FILES_ERROR',
          message: error.message || 'Gagal mengambil daftar file.',
        },
      },
      { status: 400 }
    );
  }
}
