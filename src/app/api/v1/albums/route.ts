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

    // 1. Fetch custom user albums & all user files in PARALLEL in a single round-trip
    const [customAlbumsRes, userFilesRes] = await Promise.all([
      supabaseAdmin
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
        .order('created_at', { ascending: false }),
      supabaseAdmin
        .from('files')
        .select('id, name, category, thumbnail_url, view_url, is_favorite, created_at')
        .eq('user_id', auth.userId)
        .eq('is_trashed', false)
        .order('created_at', { ascending: false }),
    ]);

    if (customAlbumsRes.error) {
      throw new Error(`Gagal memuat album: ${customAlbumsRes.error.message}`);
    }

    const customAlbums = customAlbumsRes.data || [];
    const allFiles = userFilesRes.data || [];

    // 2. Enrich custom albums (if any)
    const enrichedCustomAlbums = await Promise.all(
      customAlbums.map(async (alb) => {
        const { count } = await supabaseAdmin
          .from('album_items')
          .select('*', { count: 'exact', head: true })
          .eq('album_id', alb.id);

        let coverUrl: string | null = null;
        if (alb.cover_file_id) {
          const match = allFiles.find((f) => f.id === alb.cover_file_id);
          coverUrl = match?.thumbnail_url || match?.view_url || null;
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

    // 3. Generate Smart Albums in-memory instantly (0 extra database queries)
    const photos = allFiles.filter((f) => f.category === 'photo');
    const videos = allFiles.filter((f) => f.category === 'video');
    const documents = allFiles.filter((f) => f.category === 'document');
    const archives = allFiles.filter((f) => f.category === 'archive');
    const favorites = allFiles.filter((f) => f.is_favorite);

    const smartAlbums = [
      {
        id: 'smart-photos',
        title: 'Semua Foto',
        description: 'Seluruh foto dari Google Drive Anda',
        itemCount: photos.length,
        coverUrl: photos[0]?.thumbnail_url || photos[0]?.view_url || null,
        isSmart: true,
        type: 'photo',
      },
      {
        id: 'smart-videos',
        title: 'Koleksi Video',
        description: 'Video kenangan dari Google Drive',
        itemCount: videos.length,
        coverUrl: videos[0]?.thumbnail_url || videos[0]?.view_url || null,
        isSmart: true,
        type: 'video',
      },
      {
        id: 'smart-docs',
        title: 'Dokumen',
        description: 'Kumpulan dokumen & PDF',
        itemCount: documents.length,
        coverUrl: documents[0]?.thumbnail_url || null,
        isSmart: true,
        type: 'document',
      },
      {
        id: 'smart-archives',
        title: 'Arsip & Berkas',
        description: 'File ZIP, RAR, dan berkas arsip',
        itemCount: archives.length,
        coverUrl: archives[0]?.thumbnail_url || null,
        isSmart: true,
        type: 'archive',
      },
      {
        id: 'smart-favorites',
        title: 'Favorit',
        description: 'File yang Anda tandai sebagai favorit',
        itemCount: favorites.length,
        coverUrl: favorites[0]?.thumbnail_url || favorites[0]?.view_url || null,
        isSmart: true,
        type: 'favorite',
      },
    ];

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
