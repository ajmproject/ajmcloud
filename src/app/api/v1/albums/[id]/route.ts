import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/supabase-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { ApiResponse } from '@/types';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticateRequest(request, { requireActive: true });
    const { id } = await params;

    // Handle Smart Albums
    if (id.startsWith('smart-')) {
      let category = 'photo';
      if (id === 'smart-videos') category = 'video';
      if (id === 'smart-docs') category = 'document';

      let query = supabaseAdmin
        .from('files')
        .select('*')
        .eq('user_id', auth.userId)
        .eq('is_trashed', false)
        .order('created_at', { ascending: false });

      if (id === 'smart-favorites') {
        query = query.eq('is_favorite', true);
      } else {
        query = query.eq('category', category);
      }

      const { data: files, error } = await query;
      if (error) throw new Error(error.message);

      return NextResponse.json<ApiResponse>({
        success: true,
        data: {
          album: {
            id,
            title: id === 'smart-photos' ? 'Semua Foto' : id === 'smart-videos' ? 'Koleksi Video' : id === 'smart-favorites' ? 'Favorit' : 'Dokumen',
            isSmart: true,
          },
          files: files || [],
        },
      });
    }

    // Custom Album
    const { data: album, error: albError } = await supabaseAdmin
      .from('albums')
      .select('*')
      .eq('id', id)
      .eq('user_id', auth.userId)
      .single();

    if (albError || !album) {
      throw new Error('Album tidak ditemukan.');
    }

    const { data: items, error: itemsError } = await supabaseAdmin
      .from('album_items')
      .select('file_id')
      .eq('album_id', id);

    if (itemsError) throw new Error(itemsError.message);

    const fileIds = (items || []).map((i) => i.file_id);
    let files: any[] = [];

    if (fileIds.length > 0) {
      const { data: filesData } = await supabaseAdmin
        .from('files')
        .select('*')
        .in('id', fileIds)
        .eq('is_trashed', false)
        .order('created_at', { ascending: false });

      files = filesData || [];
    }

    return NextResponse.json<ApiResponse>({
      success: true,
      data: {
        album,
        files,
      },
    });
  } catch (error: any) {
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: 'FETCH_ALBUM_ERROR',
          message: error.message || 'Gagal mengambil isi album.',
        },
      },
      { status: 500 }
    );
  }
}
