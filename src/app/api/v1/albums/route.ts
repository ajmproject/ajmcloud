import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/supabase-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { ApiResponse } from '@/types';
import { z } from 'zod';

const createAlbumSchema = z.object({
  title: z.string().min(1, 'Judul album tidak boleh kosong').max(100),
  description: z.string().max(500).optional(),
  coverFileId: z.string().uuid().optional(),
  fileIds: z.array(z.string().uuid()).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, { requireActive: true });

    // 1. Fetch custom user albums from 'albums' table
    const { data: customAlbums, error: albumError } = await supabaseAdmin
      .from('albums')
      .select(`
        id,
        title,
        description,
        cover_file_id,
        created_at,
        updated_at
      `)
      .eq('user_id', auth.userId)
      .order('created_at', { ascending: false });

    if (albumError) {
      throw new Error(`Gagal memuat album: ${albumError.message}`);
    }

    // 2. Fetch cover photos & count for custom albums
    const enrichedCustomAlbums = await Promise.all(
      (customAlbums || []).map(async (alb) => {
        const { count } = await supabaseAdmin
          .from('album_items')
          .select('*', { count: 'exact', head: true })
          .eq('album_id', alb.id);

        let coverUrl: string | null = null;
        if (alb.cover_file_id) {
          const { data: coverFile } = await supabaseAdmin
            .from('files')
            .select('thumbnail_url, view_url')
            .eq('id', alb.cover_file_id)
            .single();
          coverUrl = coverFile?.thumbnail_url || coverFile?.view_url || null;
        }

        return {
          id: alb.id,
          title: alb.title,
          description: alb.description,
          itemCount: count || 0,
          coverUrl,
          isSmart: false,
          type: 'custom',
          createdAt: alb.created_at,
        };
      })
    );

    // 3. Generate Smart Albums from user's real files in Google Drive
    const { data: photos, count: photoCount } = await supabaseAdmin
      .from('files')
      .select('id, thumbnail_url, view_url, created_at')
      .eq('user_id', auth.userId)
      .eq('category', 'photo')
      .eq('is_trashed', false)
      .order('created_at', { ascending: false })
      .limit(1);

    const { data: videos, count: videoCount } = await supabaseAdmin
      .from('files')
      .select('id, thumbnail_url, view_url, created_at')
      .eq('user_id', auth.userId)
      .eq('category', 'video')
      .eq('is_trashed', false)
      .order('created_at', { ascending: false })
      .limit(1);

    const { data: documents, count: docCount } = await supabaseAdmin
      .from('files')
      .select('id, thumbnail_url, view_url, created_at')
      .eq('user_id', auth.userId)
      .eq('category', 'document')
      .eq('is_trashed', false)
      .order('created_at', { ascending: false })
      .limit(1);

    const { data: favorites, count: favCount } = await supabaseAdmin
      .from('files')
      .select('id, thumbnail_url, view_url, created_at')
      .eq('user_id', auth.userId)
      .eq('is_favorite', true)
      .eq('is_trashed', false)
      .order('created_at', { ascending: false })
      .limit(1);

    const smartAlbums = [];

    if ((photoCount || 0) > 0) {
      smartAlbums.push({
        id: 'smart-photos',
        title: 'Semua Foto',
        description: 'Seluruh foto dari Google Drive Anda',
        itemCount: photoCount || 0,
        coverUrl: photos?.[0]?.thumbnail_url || photos?.[0]?.view_url || null,
        isSmart: true,
        type: 'photo',
      });
    }

    if ((videoCount || 0) > 0) {
      smartAlbums.push({
        id: 'smart-videos',
        title: 'Koleksi Video',
        description: 'Video kenangan dari Google Drive',
        itemCount: videoCount || 0,
        coverUrl: videos?.[0]?.thumbnail_url || videos?.[0]?.view_url || null,
        isSmart: true,
        type: 'video',
      });
    }

    if ((favCount || 0) > 0) {
      smartAlbums.push({
        id: 'smart-favorites',
        title: 'Favorit',
        description: 'File yang Anda tandai sebagai favorit',
        itemCount: favCount || 0,
        coverUrl: favorites?.[0]?.thumbnail_url || favorites?.[0]?.view_url || null,
        isSmart: true,
        type: 'favorite',
      });
    }

    if ((docCount || 0) > 0) {
      smartAlbums.push({
        id: 'smart-docs',
        title: 'Dokumen',
        description: 'Kumpulan dokumen & PDF',
        itemCount: docCount || 0,
        coverUrl: documents?.[0]?.thumbnail_url || null,
        isSmart: true,
        type: 'document',
      });
    }

    return NextResponse.json<ApiResponse>({
      success: true,
      data: {
        smartAlbums,
        customAlbums: enrichedCustomAlbums,
        allAlbums: [...smartAlbums, ...enrichedCustomAlbums],
      },
    });
  } catch (error: any) {
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: 'FETCH_ALBUMS_ERROR',
          message: error.message || 'Gagal memuat album.',
        },
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, { requireActive: true });
    const body = await request.json();
    const validation = createAlbumSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: validation.error.errors.map((e) => e.message).join(', '),
          },
        },
        { status: 400 }
      );
    }

    const { title, description, coverFileId, fileIds } = validation.data;

    // 1. Create album
    const { data: newAlbum, error: createError } = await supabaseAdmin
      .from('albums')
      .insert({
        user_id: auth.userId,
        title,
        description: description || null,
        cover_file_id: coverFileId || (fileIds && fileIds.length > 0 ? fileIds[0] : null),
      })
      .select('*')
      .single();

    if (createError || !newAlbum) {
      throw new Error(`Gagal membuat album: ${createError?.message}`);
    }

    // 2. Add items to album if provided
    if (fileIds && fileIds.length > 0) {
      const itemsToInsert = fileIds.map((fileId) => ({
        album_id: newAlbum.id,
        file_id: fileId,
        user_id: auth.userId,
      }));

      await supabaseAdmin.from('album_items').insert(itemsToInsert);
    }

    return NextResponse.json<ApiResponse>({
      success: true,
      data: {
        album: newAlbum,
      },
    });
  } catch (error: any) {
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: 'CREATE_ALBUM_ERROR',
          message: error.message || 'Gagal membuat album baru.',
        },
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, { requireActive: true });
    const { searchParams } = new URL(request.url);
    const albumId = searchParams.get('id');

    if (!albumId) {
      throw new Error('Parameter ID album diperlukan.');
    }

    const { error: delError } = await supabaseAdmin
      .from('albums')
      .delete()
      .eq('id', albumId)
      .eq('user_id', auth.userId);

    if (delError) {
      throw new Error(`Gagal menghapus album: ${delError.message}`);
    }

    return NextResponse.json<ApiResponse>({
      success: true,
      data: { message: 'Album berhasil dihapus.' },
    });
  } catch (error: any) {
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: 'DELETE_ALBUM_ERROR',
          message: error.message || 'Gagal menghapus album.',
        },
      },
      { status: 400 }
    );
  }
}
