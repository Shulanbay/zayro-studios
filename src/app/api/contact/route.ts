import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { isValidEmail } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const { name, email, message } = await request.json();

    if (!name?.trim() || !email?.trim() || !message?.trim()) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (!isValidEmail(email)) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
    }

    if (message.length > 5000) {
      return NextResponse.json({ error: 'Message is too long' }, { status: 400 });
    }

    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    const ownerEmail = process.env.OWNER_EMAIL;

    if (!apiKey || !from || !ownerEmail) {
      console.error('Contact form submitted but email is not configured', { name, email });
      return NextResponse.json(
        { error: 'Message could not be sent right now. Please email us directly.' },
        { status: 503 }
      );
    }

    const resend = new Resend(apiKey);
    await resend.emails.send({
      from: `ZAYRO Studios Contact Form <${from}>`,
      to: ownerEmail,
      reply_to: email,
      subject: `New contact form message from ${name}`,
      html: `
        <div style="font-family: sans-serif;">
          <p><strong>From:</strong> ${name} (${email})</p>
          <p><strong>Message:</strong></p>
          <p>${String(message).replace(/</g, '&lt;').replace(/\n/g, '<br/>')}</p>
        </div>
      `,
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error sending contact form email:', error);
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
  }
}
