import { NextResponse } from 'next/server';
import { generateAuthUrl } from '@/lib/google-drive';

export async function GET() {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID || '';
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || '';
    const authUrl = generateAuthUrl('test_state_123');

    const sKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    const aKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
    const sUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';

    return NextResponse.json({
      supabaseUrl: sUrl,
      serviceRoleKeyLength: sKey.length,
      serviceRoleKeyPrefix: sKey.slice(0, 10),
      serviceRoleKeySuffix: sKey.slice(-5),
      serviceRoleKeyHasWhitespace: /\s/.test(sKey),
      anonKeyLength: aKey.length,
      anonKeyPrefix: aKey.slice(0, 10),
      clientIdLength: clientId.length,
      clientIdHasWhitespace: /\s/.test(clientId),
      clientSecretLength: clientSecret.length,
      redirectUri,
      authUrl,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
