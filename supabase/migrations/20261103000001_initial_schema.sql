-- ==============================================================================
-- AjmCloud — Supabase Migration: Initial Schema & RLS Policies
-- File: supabase/migrations/20261103000001_initial_schema.sql
-- ==============================================================================

-- 1. ENUMS
CREATE TYPE account_status AS ENUM ('pending', 'active', 'blocked');
CREATE TYPE user_role AS ENUM ('admin', 'user');
CREATE TYPE drive_account_status AS ENUM ('connected', 'needs_reconnect', 'revoked', 'disabled');
CREATE TYPE upload_status AS ENUM ('pending', 'uploading', 'verifying', 'completed', 'failed', 'cancelled');
CREATE TYPE file_category AS ENUM ('photo', 'video', 'document', 'archive', 'audio', 'other');

-- 2. PROFILES TABLE
-- Menyimpan status pengguna: 'pending' (default untuk registrasi publik), 'active', 'blocked'.
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    username TEXT UNIQUE,
    full_name TEXT,
    avatar_url TEXT,
    status account_status NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 3. USER ROLES TABLE
-- Menyimpan peran (admin / user) untuk otorisasi server-side.
CREATE TABLE public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role user_role NOT NULL DEFAULT 'user',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT unique_user_role UNIQUE (user_id, role)
);

-- 4. GOOGLE DRIVE ACCOUNTS TABLE
-- Menyimpan akun Google Drive yang dihubungkan pengguna. Token disimpan terenkripsi di sisi server.
CREATE TABLE public.google_drive_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    google_email TEXT NOT NULL,
    account_name TEXT,
    encrypted_access_token TEXT NOT NULL,
    encrypted_refresh_token TEXT NOT NULL,
    token_expiry TIMESTAMPTZ,
    storage_total_bytes BIGINT NOT NULL DEFAULT 0,
    storage_used_bytes BIGINT NOT NULL DEFAULT 0,
    status drive_account_status NOT NULL DEFAULT 'connected',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT unique_user_google_email UNIQUE (user_id, google_email)
);

-- 5. FILES TABLE
-- Metadata seluruh file. Satu file utuh disimpan pada satu akun Google Drive.
CREATE TABLE public.files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    google_drive_account_id UUID NOT NULL REFERENCES public.google_drive_accounts(id) ON DELETE RESTRICT,
    google_file_id TEXT NOT NULL,
    name TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL DEFAULT 0,
    extension TEXT,
    category file_category NOT NULL DEFAULT 'other',
    thumbnail_url TEXT,
    is_starred BOOLEAN NOT NULL DEFAULT false,
    is_trashed BOOLEAN NOT NULL DEFAULT false,
    trashed_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 6. ALBUMS TABLE
CREATE TABLE public.albums (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    cover_file_id UUID REFERENCES public.files(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 7. ALBUM ITEMS TABLE
CREATE TABLE public.album_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    album_id UUID NOT NULL REFERENCES public.albums(id) ON DELETE CASCADE,
    file_id UUID NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT unique_album_item UNIQUE (album_id, file_id)
);

-- 8. UPLOAD JOBS TABLE
-- Melacak proses inisiasi dan status resumable upload langsung ke Google Drive.
CREATE TABLE public.upload_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    google_drive_account_id UUID NOT NULL REFERENCES public.google_drive_accounts(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    resumable_session_uri TEXT,
    status upload_status NOT NULL DEFAULT 'pending',
    bytes_uploaded BIGINT NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 9. ADMIN AUDIT LOGS TABLE
-- Mencatat seluruh aksi administratif (accept, block, unblock, delete, create user).
CREATE TABLE public.admin_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID NOT NULL REFERENCES auth.users(id),
    action TEXT NOT NULL,
    target_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 10. INDEXES UNTUK PERFORMA QUERY
CREATE INDEX idx_profiles_status ON public.profiles(status);
CREATE INDEX idx_user_roles_user_id ON public.user_roles(user_id);
CREATE INDEX idx_drive_accounts_user_id ON public.google_drive_accounts(user_id);
CREATE INDEX idx_files_user_id ON public.files(user_id);
CREATE INDEX idx_files_category ON public.files(category);
CREATE INDEX idx_files_is_trashed ON public.files(is_trashed);
CREATE INDEX idx_files_created_at ON public.files(created_at DESC);
CREATE INDEX idx_albums_user_id ON public.albums(user_id);
CREATE INDEX idx_album_items_album_id ON public.album_items(album_id);
CREATE INDEX idx_upload_jobs_user_status ON public.upload_jobs(user_id, status);

-- 11. SECURITY DEFINER HELPER FUNCTION (is_admin)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.user_roles
        WHERE user_id = auth.uid() AND role = 'admin'
    );
$$;

-- 12. TRIGGER: OTOMATIS BUAT PROFILE 'pending' SAAT USER MENDAFTAR
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- 1. Buat profil dengan status awal 'pending'
    INSERT INTO public.profiles (id, email, username, full_name, status)
    VALUES (
        NEW.id,
        NEW.email,
        LOWER(SPLIT_PART(NEW.email, '@', 1)),
        COALESCE(NEW.raw_user_meta_data->>'full_name', SPLIT_PART(NEW.email, '@', 1)),
        'pending'
    );

    -- 2. Berikan role default 'user'
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'user');

    RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 13. ROW LEVEL SECURITY (RLS) POLICIES
-- Aktifkan RLS di seluruh tabel
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_drive_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.albums ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.album_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upload_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

-- POLICIES: PROFILES
-- User hanya bisa melihat profil sendiri; Admin bisa melihat semua profil
CREATE POLICY "Users can view own profile"
    ON public.profiles FOR SELECT
    USING (auth.uid() = id OR public.is_admin());

-- User hanya bisa update profil sendiri (tapi tidak boleh mengganti status 'status' sendiri)
CREATE POLICY "Users can update own profile"
    ON public.profiles FOR UPDATE
    USING (auth.uid() = id);

-- Admin dapat mengupdate status profil apa pun
CREATE POLICY "Admins can update any profile"
    ON public.profiles FOR UPDATE
    USING (public.is_admin());

-- POLICIES: USER ROLES
-- User hanya bisa melihat role sendiri; Admin bisa melihat semua
CREATE POLICY "Users can view own role"
    ON public.user_roles FOR SELECT
    USING (auth.uid() = user_id OR public.is_admin());

-- POLICIES: GOOGLE DRIVE ACCOUNTS
-- User hanya bisa mengakses akun drive miliknya sendiri
CREATE POLICY "Users can manage own drive accounts"
    ON public.google_drive_accounts FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- POLICIES: FILES
-- User hanya bisa mengakses file miliknya sendiri
CREATE POLICY "Users can view own files"
    ON public.files FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own files"
    ON public.files FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own files"
    ON public.files FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own files"
    ON public.files FOR DELETE
    USING (auth.uid() = user_id);

-- POLICIES: ALBUMS & ITEMS
CREATE POLICY "Users can manage own albums"
    ON public.albums FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can manage own album items"
    ON public.album_items FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- POLICIES: UPLOAD JOBS
CREATE POLICY "Users can manage own upload jobs"
    ON public.upload_jobs FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- POLICIES: ADMIN AUDIT LOGS
-- Hanya admin yang dapat melihat dan menulis audit logs
CREATE POLICY "Admins can view audit logs"
    ON public.admin_audit_logs FOR SELECT
    USING (public.is_admin());

CREATE POLICY "Admins can insert audit logs"
    ON public.admin_audit_logs FOR INSERT
    WITH CHECK (public.is_admin());
