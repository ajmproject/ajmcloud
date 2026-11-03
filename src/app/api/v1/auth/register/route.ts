import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { ApiResponse } from '@/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password, username, fullName } = body;

    if (!email || !password) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: { code: 'INVALID_INPUT', message: 'Email dan password wajib diisi.' },
        },
        { status: 400 }
      );
    }

    const cleanUsername = username || email.split('@')[0];
    const cleanFullName = fullName || cleanUsername;

    // 1. Cek apakah pengguna sudah ada di Supabase Auth
    const { data: userList } = await supabaseAdmin.auth.admin.listUsers();
    const existing = userList?.users?.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase()
    );

    let userId: string;

    if (existing) {
      // Jika sudah ada, update password dan pastikan email terkonfirmasi
      const { data: updated, error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(
        existing.id,
        {
          password,
          email_confirm: true,
          user_metadata: {
            username: cleanUsername,
            full_name: cleanFullName,
          },
        }
      );

      if (updateErr) {
        throw new Error(updateErr.message);
      }

      userId = updated.user.id;
    } else {
      // Buat user baru langsung terkonfirmasi (email_confirm: true)
      const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          username: cleanUsername,
          full_name: cleanFullName,
        },
      });

      if (createErr) {
        throw new Error(createErr.message);
      }

      userId = created.user.id;
    }

    // 2. Pastikan row di tabel profiles aktif
    await supabaseAdmin.from('profiles').upsert(
      {
        id: userId,
        email,
        username: cleanUsername,
        full_name: cleanFullName,
        status: 'active',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    );

    return NextResponse.json<ApiResponse>({
      success: true,
      data: {
        userId,
        email,
        message: 'Pendaftaran berhasil dan akun langsung aktif!',
      },
    });
  } catch (error: any) {
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: 'REGISTER_ERROR',
          message: error.message || 'Gagal memproses pendaftaran.',
        },
      },
      { status: 400 }
    );
  }
}
