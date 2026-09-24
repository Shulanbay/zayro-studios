import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createLoginToken } from '@/lib/adminAuth';
import { canRequestLogin } from '@/lib/crm/auth';
import { enforceRateLimit } from '@/lib/crm/rateLimit';
import { isValidEmail, getBaseUrl } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// Always returns the same generic response whether or not the email is an
// admin, so this endpoint can't be used to enumerate admin addresses.
export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, 'admin-login', 5, 900);
  if (limited) return limited;
  try {
    const { email } = await request.json();
    const generic = NextResponse.json({
      message: 'If that email is an admin account, a sign-in link has been sent.',
    });

    if (!email || !isValidEmail(email)) {
      return generic;
    }

    if (!(await canRequestLogin(email))) {
      return generic;
    }

    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!apiKey || !from) {
      console.error('Admin login requested but RESEND_API_KEY / EMAIL_FROM not configured');
      return generic;
    }

    const token = createLoginToken(email);
    const baseUrl = getBaseUrl(request);
    const link = `${baseUrl}/api/admin/verify?token=${encodeURIComponent(token)}`;

    const resend = new Resend(apiKey);
    await resend.emails.send({
      from: `ZAYRO Studios Admin <${from}>`,
      to: email,
      subject: 'Your ZAYRO Studios admin sign-in link',
      html: `
        <div style="font-family: sans-serif;">
          <p>Click the link below to sign in to the ZAYRO Studios admin panel. This link expires in 15 minutes and can only be used once.</p>
          <p><a href="${link}" style="display:inline-block;padding:12px 20px;background:#315CFF;color:#fff;text-decoration:none;border-radius:4px;">Sign in to Admin</a></p>
          <p style="color:#888;font-size:12px;">If you didn't request this, you can ignore this email.</p>
        </div>
      `,
    });

    return generic;
  } catch (error) {
    console.error('Error requesting admin login:', error);
    return NextResponse.json({ message: 'If that email is an admin account, a sign-in link has been sent.' });
  }
}
