import { NextRequest } from 'next/server';
import { supabaseAdmin } from './supabase-admin';
import { UserProfile, UserRole } from '@/types';

export interface AuthContext {
  userId: string;
  email: string;
  profile: UserProfile;
  roles: UserRole[];
  isAdmin: boolean;
}

/**
 * Verifies the Supabase JWT token from the Authorization header.
 * Ensures the user exists and validates their account status.
 */
export async function authenticateRequest(
  request: NextRequest,
  options: { requireActive?: boolean; requireAdmin?: boolean } = { requireActive: true, requireAdmin: false }
): Promise<AuthContext> {
  const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('UNAUTHORIZED: Missing or invalid Authorization header.');
  }

  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) {
    throw new Error('UNAUTHORIZED: Empty bearer token.');
  }

  // 1. Verify token with Supabase Auth
  const { data: userData, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !userData?.user) {
    throw new Error(`UNAUTHORIZED: Invalid access token - ${authError?.message || 'User not found'}`);
  }

  const user = userData.user;

  // 2. Fetch profile from database (atau buat profil otomatis jika belum ada)
  let { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile) {
    // Buat profil otomatis dengan status 'active' agar langsung bisa masuk
    const username = user.email ? user.email.split('@')[0] : 'user';
    const { data: createdProfile } = await supabaseAdmin
      .from('profiles')
      .upsert({
        id: user.id,
        email: user.email || '',
        username,
        full_name: user.user_metadata?.full_name || username,
        status: 'active',
      })
      .select('*')
      .maybeSingle();

    if (createdProfile) {
      profile = createdProfile;
    } else {
      // Fallback object jika RLS menolak insert anonim
      profile = {
        id: user.id,
        email: user.email || '',
        username,
        full_name: user.user_metadata?.full_name || username,
        avatar_url: null,
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    }
  }

  // 3. Fetch user roles
  const { data: rolesData } = await supabaseAdmin
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id);

  const roles: UserRole[] = (rolesData || []).map((r) => r.role as UserRole);
  const isAdmin = roles.includes('admin');

  // 4. Validate Account Status
  if (options.requireActive && !isAdmin) {
    if (profile.status === 'pending') {
      throw new Error('ACCOUNT_PENDING: Akun Anda sedang menunggu persetujuan admin.');
    }
    if (profile.status === 'blocked') {
      throw new Error('ACCOUNT_BLOCKED: Akun Anda telah dinonaktifkan oleh admin.');
    }
  }

  // 5. Validate Admin requirement if specified
  if (options.requireAdmin && !isAdmin) {
    throw new Error('FORBIDDEN: Endpoint ini hanya dapat diakses oleh administrator.');
  }

  return {
    userId: user.id,
    email: user.email || profile.email,
    profile,
    roles,
    isAdmin,
  };
}
