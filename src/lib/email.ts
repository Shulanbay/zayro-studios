import { Resend } from 'resend';
import type { Booking, Service } from './db/schema';
import { formatBookingDateUTC as formatBookingDate } from './utils';

function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

interface BookingEmailData {
  booking: Booking;
  service: Service;
}

/**
 * Sends the customer-facing confirmation email. Never throws — a failed
 * email must not fail booking confirmation. Returns whether it was sent.
 */
export async function sendBookingConfirmationEmail({ booking, service }: BookingEmailData): Promise<{ sent: boolean; error?: string }> {
  const resend = getResendClient();
  const from = process.env.EMAIL_FROM;

  if (!resend || !from) {
    return { sent: false, error: 'Email not configured (RESEND_API_KEY / EMAIL_FROM missing)' };
  }

  try {
    // Resend reports API failures in the result instead of throwing.
    const { error: sendError } = await resend.emails.send({
      from: `ZAYRO Studios <${from}>`,
      to: booking.customer_email,
      subject: 'Your ZAYRO Studios Booking Is Confirmed',
      html: `
        <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto;">
          <h1 style="font-size: 20px;">Booking confirmed ✓</h1>
          <p>Hi ${booking.customer_first_name}, your session at ZAYRO Studios is confirmed.</p>
          <table style="width: 100%; border-collapse: collapse; margin: 24px 0;">
            <tr><td style="padding: 6px 0; color: #666;">Booking ID</td><td style="padding: 6px 0; text-align: right; font-weight: bold;">${booking.booking_id}</td></tr>
            <tr><td style="padding: 6px 0; color: #666;">Service</td><td style="padding: 6px 0; text-align: right;">${service.name}</td></tr>
            <tr><td style="padding: 6px 0; color: #666;">Date</td><td style="padding: 6px 0; text-align: right;">${formatBookingDate(booking.booking_date)}</td></tr>
            <tr><td style="padding: 6px 0; color: #666;">Time</td><td style="padding: 6px 0; text-align: right;">${booking.start_time} - ${booking.end_time} ET</td></tr>
            <tr><td style="padding: 6px 0; color: #666;">Total</td><td style="padding: 6px 0; text-align: right; font-weight: bold;">$${booking.total_amount}</td></tr>
          </table>
          <p>Location: 40 W 37th St, Suite 603, New York, NY 10018</p>
          <p>Please arrive 10 minutes early. Questions? Reply to this email or contact hello@zayro.studio.</p>
        </div>
      `,
    });
    if (sendError) return { sent: false, error: sendError.message };
    return { sent: true };
  } catch (error: any) {
    console.error('Error sending confirmation email:', error);
    return { sent: false, error: error?.message || String(error) };
  }
}

export async function sendOwnerNotificationEmail({ booking, service }: BookingEmailData): Promise<{ sent: boolean; error?: string }> {
  const resend = getResendClient();
  const from = process.env.EMAIL_FROM;
  const ownerEmail = process.env.OWNER_EMAIL;

  if (!resend || !from || !ownerEmail) {
    return { sent: false, error: 'Owner notification not configured (RESEND_API_KEY / EMAIL_FROM / OWNER_EMAIL missing)' };
  }

  try {
    // Resend reports API failures in the result instead of throwing.
    const { error: sendError } = await resend.emails.send({
      from: `ZAYRO Studios <${from}>`,
      to: ownerEmail,
      subject: `New Booking: ${service.name} on ${formatBookingDate(booking.booking_date)}`,
      html: `
        <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto;">
          <h1 style="font-size: 20px;">New booking received</h1>
          <table style="width: 100%; border-collapse: collapse; margin: 24px 0;">
            <tr><td style="padding: 6px 0; color: #666;">Booking ID</td><td style="padding: 6px 0; text-align: right; font-weight: bold;">${booking.booking_id}</td></tr>
            <tr><td style="padding: 6px 0; color: #666;">Service</td><td style="padding: 6px 0; text-align: right;">${service.name}</td></tr>
            <tr><td style="padding: 6px 0; color: #666;">Date</td><td style="padding: 6px 0; text-align: right;">${formatBookingDate(booking.booking_date)}</td></tr>
            <tr><td style="padding: 6px 0; color: #666;">Time</td><td style="padding: 6px 0; text-align: right;">${booking.start_time} - ${booking.end_time} ET</td></tr>
            <tr><td style="padding: 6px 0; color: #666;">Customer</td><td style="padding: 6px 0; text-align: right;">${booking.customer_first_name} ${booking.customer_last_name}</td></tr>
            <tr><td style="padding: 6px 0; color: #666;">Email</td><td style="padding: 6px 0; text-align: right;">${booking.customer_email}</td></tr>
            <tr><td style="padding: 6px 0; color: #666;">Phone</td><td style="padding: 6px 0; text-align: right;">${booking.customer_phone}</td></tr>
            <tr><td style="padding: 6px 0; color: #666;">Total</td><td style="padding: 6px 0; text-align: right; font-weight: bold;">$${booking.total_amount}</td></tr>
          </table>
          ${booking.notes ? `<p><strong>Notes:</strong> ${booking.notes}</p>` : ''}
        </div>
      `,
    });
    if (sendError) return { sent: false, error: sendError.message };
    return { sent: true };
  } catch (error: any) {
    console.error('Error sending owner notification email:', error);
    return { sent: false, error: error?.message || String(error) };
  }
}
