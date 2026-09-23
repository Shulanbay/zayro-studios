import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { isValidEmail } from '@/lib/utils';

export const dynamic = 'force-dynamic';

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

export async function POST(request: NextRequest) {
  try {
    const { name, email, message, topic } = await request.json();

    if (!name?.trim() || !email?.trim() || !message?.trim()) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (!isValidEmail(email)) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
    }

    if (message.length > 5000 || String(name).length > 200) {
      return NextResponse.json({ error: 'Message is too long' }, { status: 400 });
    }

    // Optional subject line, e.g. "Monthly Package: …" or "On-location photography"
    // prefilled from the pricing page.
    const topicText = typeof topic === 'string' ? oneLine(topic).slice(0, 200) : '';

    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    const ownerEmail = process.env.OWNER_EMAIL;

    if (!apiKey || !from || !ownerEmail) {
      console.error('Contact form submitted but email is not configured');
      return NextResponse.json(
        { error: 'Message could not be sent right now. Please email us directly.' },
        { status: 503 }
      );
    }

    const safeName = oneLine(String(name));
    const resend = new Resend(apiKey);
    const { error: sendError } = await resend.emails.send({
      from: `ZAYRO Studios Contact Form <${from}>`,
      to: ownerEmail,
      reply_to: email,
      subject: topicText ? `${topicText} — request from ${safeName}` : `New contact form message from ${safeName}`,
      html: `
        <div style="font-family: sans-serif;">
          ${topicText ? `<p><strong>Regarding:</strong> ${escapeHtml(topicText)}</p>` : ''}
          <p><strong>From:</strong> ${escapeHtml(safeName)} (${escapeHtml(email)})</p>
          <p><strong>Message:</strong></p>
          <p>${escapeHtml(String(message)).replace(/\n/g, '<br/>')}</p>
        </div>
      `,
    });

    if (sendError) {
      console.error('Contact form email was rejected by Resend:', sendError.message);
      return NextResponse.json({ error: 'Failed to send message' }, { status: 502 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error sending contact form email:', error?.message || error);
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
  }
}
