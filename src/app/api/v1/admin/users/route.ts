import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/supabase-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { ApiResponse } from '@/types';
import { z } from 'zod';

const createUserSchema = z.object({
  email: z.string().email('Format email tidak valid'),
  password: z.string().min(6, 'Password minimal 6 karakter'),
  username: z.string().min(3, 'Username minimal 3 karakter').optional(),
  fullName: z.string().optional(),
});

const updateStatusSchema = z.object({
  userId: z.string().uuid('User ID tidak valid'),
  status: z.enum(['pending', 'active', 'blocked']),
  reason: z.string().optional(),
});

// GET /api/v1/admin/users — List all users for admin review
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, { requireAdmin: true });
    const { searchParams } = new URL(request.url);

    const status = searchParams.get('status');
    const search = searchParams.get('search');

    let query = supabaseAdmin
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    if (search) {
      query = query.or(`email.ilike.%${search}%,username.ilike.%${search}%,full_name.ilike.%${search}%`);
    }

    const { data: profiles, error } = await query;

    if (error) {
      throw new Error(`Failed to list users: ${error.message}`);
    }

    return NextResponse.json<ApiResponse>({
      success: true,
      data: {
        users: profiles || [],
      },
    });
  } catch (error: any) {
    const status = error.message?.startsWith('FORBIDDEN') ? 403 : 400;
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: status === 403 ? 'FORBIDDEN' : 'ADMIN_USERS_ERROR',
          message: error.message || 'Gagal mengambil data pengguna.',
        },
      },
      { status }
    );
  }
}

// POST /api/v1/admin/users — Create user manually by Admin
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, { requireAdmin: true });

    const body = await request.json();
    const validation = createUserSchema.safeParse(body);

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

    const { email, password, username, fullName } = validation.data;

    // 1. Create auth user with Admin API
    const { data: newUserData, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName || username || email.split('@')[0],
      },
    });

    if (createError || !newUserData.user) {
      throw new Error(`Gagal membuat akun: ${createError?.message}`);
    }

    const newUserId = newUserData.user.id;

    // 2. Set profile status to 'active' immediately since it was created manually by admin
    await supabaseAdmin
      .from('profiles')
      .update({
        username: username || email.split('@')[0],
        full_name: fullName || username || email.split('@')[0],
        status: 'active',
        updated_at: new Date().toISOString(),
      })
      .eq('id', newUserId);

    // 3. Record audit log
    await supabaseAdmin.from('admin_audit_logs').insert({
      admin_id: auth.userId,
      action: 'CREATE_USER_MANUAL',
      target_user_id: newUserId,
      details: { email, username },
    });

    return NextResponse.json<ApiResponse>({
      success: true,
      data: {
        userId: newUserId,
        email,
        status: 'active',
        message: 'Pengguna berhasil dibuat secara manual oleh admin.',
      },
    });
  } catch (error: any) {
    const status = error.message?.startsWith('FORBIDDEN') ? 403 : 400;
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: status === 403 ? 'FORBIDDEN' : 'CREATE_USER_ERROR',
          message: error.message || 'Gagal membuat akun pengguna baru.',
        },
      },
      { status }
    );
  }
}

// PATCH /api/v1/admin/users — Moderation action (accept / block / unblock)
export async function PATCH(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, { requireAdmin: true });

    const body = await request.json();
    const validation = updateStatusSchema.safeParse(body);

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

    const { userId, status, reason } = validation.data;

    // Prevent admin from blocking self
    if (userId === auth.userId && status === 'blocked') {
      throw new Error('Anda tidak dapat memblokir akun Anda sendiri.');
    }

    // Update status in profiles
    const { data: updatedProfile, error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)
      .select('*')
      .single();

    if (updateError || !updatedProfile) {
      throw new Error(`Gagal mengubah status: ${updateError?.message}`);
    }

    // Record audit log
    await supabaseAdmin.from('admin_audit_logs').insert({
      admin_id: auth.userId,
      action: `STATUS_CHANGE_TO_${status.toUpperCase()}`,
      target_user_id: userId,
      details: { previousStatus: updatedProfile.status, newStatus: status, reason },
    });

    return NextResponse.json<ApiResponse>({
      success: true,
      data: {
        profile: updatedProfile,
        message: `Status pengguna berhasil diperbarui menjadi ${status}.`,
      },
    });
  } catch (error: any) {
    const status = error.message?.startsWith('FORBIDDEN') ? 403 : 400;
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: status === 403 ? 'FORBIDDEN' : 'UPDATE_STATUS_ERROR',
          message: error.message || 'Gagal memperbarui status pengguna.',
        },
      },
      { status }
    );
  }
}

// DELETE /api/v1/admin/users — Delete user account (AjmCloud metadata only, preserves physical Google Drive files)
export async function DELETE(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, { requireAdmin: true });
    const { searchParams } = new URL(request.url);
    const targetUserId = searchParams.get('userId');

    if (!targetUserId) {
      throw new Error('Parameter userId wajib disertakan.');
    }

    if (targetUserId === auth.userId) {
      throw new Error('Anda tidak dapat menghapus akun Anda sendiri dari panel admin.');
    }

    // 1. Log audit prior to deletion
    await supabaseAdmin.from('admin_audit_logs').insert({
      admin_id: auth.userId,
      action: 'DELETE_USER',
      target_user_id: targetUserId,
      details: { note: 'Deleted user account metadata from AjmCloud. Drive files preserved.' },
    });

    // 2. Delete auth user (cascades profiles, drive accounts, files metadata in AjmCloud)
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(targetUserId);

    if (deleteError) {
      throw new Error(`Gagal menghapus user: ${deleteError.message}`);
    }

    return NextResponse.json<ApiResponse>({
      success: true,
      data: {
        message: 'Akun dan metadata pengguna di AjmCloud berhasil dihapus. File asli pada Google Drive tetap utuh.',
      },
    });
  } catch (error: any) {
    const status = error.message?.startsWith('FORBIDDEN') ? 403 : 400;
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: status === 403 ? 'FORBIDDEN' : 'DELETE_USER_ERROR',
          message: error.message || 'Gagal menghapus akun pengguna.',
        },
      },
      { status }
    );
  }
}
