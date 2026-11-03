import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/supabase-auth';
import { generateAuthUrl } from '@/lib/google-drive';
import { ApiResponse } from '@/types';
import crypto from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, { requireActive: true });

    // Generate state with userId and random anti-CSRF token
    const randomNonce = crypto.randomBytes(16).toString('hex');
    const statePayload = JSON.stringify({
      userId: auth.userId,
      nonce: randomNonce,
      timestamp: Date.now(),
    });
    const encodedState = Buffer.from(statePayload).toString('base64url');

    const authUrl = generateAuthUrl(encodedState);

    return NextResponse.json<ApiResponse>({
      success: true,
      data: {
        authUrl,
      },
    });
  } catch (error: any) {
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: 'DRIVE_CONNECT_ERROR',
          message: error.message || 'Gagal membuat URL koneksi Google Drive.',
        },
      },
      { status: 400 }
    );
  }
}
