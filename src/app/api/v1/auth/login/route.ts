import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ApiResponse } from '@/types';
import { z } from 'zod';
import dns from 'dns';

// Pastikan koneksi server selalu memprioritaskan IPv4 untuk menghindari masalah NAT64/IPv6 Connection Reset
try {
  dns.setDefaultResultOrder('ipv4first');
} catch {}

const loginSchema = z.object({
  email: z.string().email('Format email tidak valid'),
  password: z.string().min(1, 'Password tidak boleh kosong'),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validation = loginSchema.safeParse(body);

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

    const { email, password } = validation.data;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://gasqpvlrcfwqdrprnabp.supabase.co';
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    const supabaseAnon = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { data, error } = await supabaseAnon.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.session) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'AUTH_FAILED',
            message: error?.message || 'Email atau password salah.',
          },
        },
        { status: 401 }
      );
    }

    return NextResponse.json<ApiResponse>({
      success: true,
      data: {
        session: data.session,
        user: data.user,
      },
    });
  } catch (error: any) {
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: 'LOGIN_ERROR',
          message: error.message || 'Terjadi kesalahan saat memproses login.',
        },
      },
      { status: 500 }
    );
  }
}
