import { NextResponse } from 'next/server';
import { generateAuthUrl } from '@/lib/google-drive';

export async function GET() {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID || '';
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || '';
    const authUrl = generateAuthUrl('test_state_123');

    return NextResponse.json({
      clientIdLength: clientId.length,
      clientIdHasWhitespace: /\s/.test(clientId),
      clientIdHasQuotes: clientId.startsWith('"') || clientId.startsWith("'"),
      clientSecretLength: clientSecret.length,
      clientSecretHasWhitespace: /\s/.test(clientSecret),
      redirectUri,
      redirectUriHasWhitespace: /\s/.test(redirectUri),
      redirectUriHasQuotes: redirectUri.startsWith('"') || redirectUri.startsWith("'"),
      authUrl,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
