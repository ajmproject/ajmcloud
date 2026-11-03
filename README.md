# AjmCloud API (`ajmcloud-api`)

Backend API untuk aplikasi **AjmCloud** — personal cloud storage berbasis galeri pintar dengan multi-akun Google Drive.

Deploy target: **Vercel Serverless Functions**.

## Tanggung Jawab Repository Ini

1. **Autentikasi & Verifikasi JWT:** Memvalidasi Supabase Access Token pada setiap request yang terlindungi.
2. **Google OAuth & Token Management:** Menangani OAuth flow untuk menghubungkan banyak akun Google Drive, mengenkripsi refresh token di database menggunakan AES-256-GCM.
3. **Resumable Upload Session:** Menginisiasi sesi resumable upload Google Drive langsung ke client (mobile) agar file besar tidak membebani limit serverless Vercel.
4. **Storage Routing Engine:** Memilih akun Google Drive yang paling layak berdasarkan ketersediaan kuota, status koneksi, dan ukuran file.
5. **Sumber Tunggal Migrasi Database:** Folder `supabase/migrations/` di repository ini adalah satu-satunya acuan skema PostgreSQL dan kebijakan RLS (Row Level Security).
6. **API Administratif:** Endpoint moderasi user (*accept*, *block*, *unblock*, *delete*) dan audit logging.

## Persyaratan Lingkungan

- Node.js >= 20.x
- npm >= 10.x
- Supabase Project (PostgreSQL + Auth)
- Google Cloud Project dengan Google Drive API diaktifkan

## Setup & Instalasi Lokal

```bash
# 1. Masuk ke folder repo
cd ajmcloud-api

# 2. Install dependencies
npm install

# 3. Salin konfigurasi environment
cp .env.example .env.local
# Kemudian isi variabel yang dibutuhkan di .env.local

# 4. Jalankan server development (port 3001)
npm run dev
```

## Struktur Folder

```
ajmcloud-api/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── health/route.ts
│   │   │   └── v1/
│   │   │       ├── me/route.ts
│   │   │       ├── drive/
│   │   │       │   ├── connect/route.ts
│   │   │       │   ├── callback/route.ts
│   │   │       │   └── accounts/route.ts
│   │   │       ├── files/
│   │   │       │   ├── upload-session/route.ts
│   │   │       │   ├── verify-upload/route.ts
│   │   │       │   └── route.ts
│   │   │       └── admin/
│   │   │           ├── users/route.ts
│   │   │           └── audit-logs/route.ts
│   │   └── layout.tsx & page.tsx (status page)
│   ├── lib/
│   │   ├── crypto.ts          # Enkripsi & dekripsi token AES-256-GCM
│   │   ├── supabase-admin.ts  # Supabase client dengan service role (server only)
│   │   ├── supabase-client.ts # Helper verifikasi Supabase JWT
│   │   ├── google-drive.ts    # Integrasi Google Drive API & OAuth2
│   │   └── storage-router.ts  # Logika alokasi file ke akun Google Drive
│   └── types/
│       └── index.ts           # Definisi tipe TypeScript
├── supabase/
│   └── migrations/            # Acuan tunggal SQL migrations
├── .env.example
├── .gitignore
├── next.config.mjs
├── package.json
└── tsconfig.json
```

## Menjalankan Typecheck

```bash
npm run typecheck
```
