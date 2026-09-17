# Stripe Setup Quick Start

## Get Your Test Mode Credentials

### 1. Stripe Account
- Go to https://dashboard.stripe.com
- Ensure you're in **Test mode** (toggle in top right corner)

### 2. API Keys
- Click **Developers** → **API keys**
- Copy your keys:
  - **Publishable key** (starts with `pk_test_`)
  - **Secret key** (starts with `sk_test_`)

⚠️ **NEVER share or commit the secret key!**

### 3. Webhook Signing Secret
- Click **Developers** → **Webhooks**
- Click **Add an endpoint**
- For development, use: `http://localhost:3000/api/payment/webhook`
- For production, use: `https://yourdomain.com/api/payment/webhook`
- Click **Select events** and choose:
  - `checkout.session.completed`
  - `charge.succeeded`
- Copy the **Signing secret** (starts with `whsec_test_`)

---

## Local Development Setup

### 1. Update `.env.local`

Create or update `/Users/shulanbaybotabek/Documents/VibeCoding/ZayroStudios/.env.local`:

```env
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_YOUR_KEY_HERE
STRIPE_SECRET_KEY=sk_test_YOUR_KEY_HERE
STRIPE_WEBHOOK_SECRET=whsec_test_YOUR_KEY_HERE
NEXTAUTH_URL=http://localhost:3000
DATABASE_URL=postgresql://user:password@localhost:5432/zayro_studios
```

### 2. Start Development Server

```bash
npm run dev
```

Runs on http://localhost:3000

### 3. Test Webhook Locally (Optional)

If you want to test webhooks without exposing your local machine:

```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Authenticate
stripe login

# Forward webhooks to your local endpoint
stripe listen --forward-to localhost:3000/api/payment/webhook

# Copy the signing secret from CLI and update .env.local
```

---

## Test the Payment Flow

### 1. Start Booking
- Navigate to http://localhost:3000/booking
- Select a service (e.g., "Single Hour")
- Select a future date
- Select an available time
- Fill in customer info
- Review booking summary
- Click "CONTINUE TO PAYMENT"

### 2. Proceed to Stripe
- Click "SECURE CHECKOUT"
- Redirected to Stripe test checkout

### 3. Complete Payment (Test Mode)

Use a Stripe test card:

**Successful Payment:**
- Card: `4242 4242 4242 4242`
- Expiry: Any future date (e.g., 12/25)
- CVC: Any 3 digits (e.g., 123)
- Name: Any name
- Click "Pay"

**Declined Payment (Optional test):**
- Card: `4000 0000 0000 0002`
- Same other details
- Will show "Card declined"

### 4. Verify Success

If payment succeeded:
- Redirected to `/booking/success?session_id=...`
- Shows "✓ CONFIRMED"
- Displays booking details

If payment failed:
- Redirected to `/booking/cancel?hold_id=...`
- Can retry if hold still valid (within 15 minutes)

---

## Database Verification

Check that booking was created:

```sql
-- See confirmed bookings
SELECT id, booking_id, status, payment_status, stripe_session_id 
FROM bookings 
WHERE status = 'confirmed' 
ORDER BY created_at DESC 
LIMIT 5;

-- See payments
SELECT id, status, stripe_payment_id 
FROM payments 
WHERE status = 'succeeded' 
ORDER BY created_at DESC 
LIMIT 5;

-- See converted holds
SELECT id, status FROM temporary_holds 
WHERE status = 'converted_to_booking' 
ORDER BY created_at DESC 
LIMIT 5;

-- See integration logs
SELECT integration_type, status, error_message, created_at 
FROM integration_logs 
WHERE integration_type = 'stripe' 
ORDER BY created_at DESC 
LIMIT 10;
```

---

## Stripe Dashboard Monitoring

After payment:
- Go to https://dashboard.stripe.com
- Click **Payments** → View your test payment
- Click **Events** → See webhook activity
- Click **Logs** → See API calls

---

## Production Deployment

When ready to go live:

1. **Get Live Mode Keys**
   - Disable test mode in Stripe Dashboard
   - Copy live keys (start with `pk_live_` and `sk_live_`)

2. **Update Vercel**
   - Go to Vercel project settings
   - Update environment variables:
     - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` = pk_live_...
     - `STRIPE_SECRET_KEY` = sk_live_...
     - `STRIPE_WEBHOOK_SECRET` = whsec_live_...

3. **Update Stripe Webhook**
   - Stripe Dashboard → Webhooks
   - Update endpoint URL to: `https://yourdomain.com/api/payment/webhook`
   - Use live mode webhook signing secret

4. **Test on Production**
   - Use real test card: `4242 4242 4242 4242`
   - Complete a test payment
   - Verify booking created
   - Verify webhook processed

⚠️ **Never commit live keys to code!** Always use environment variables.

---

## Troubleshooting

### Payment fails with "Missing required fields"
- **Fix:** Ensure all customer info is filled (first name, last name, email, phone)

### Error: "Booking hold has expired"
- **Reason:** Hold is only valid for 15 minutes
- **Fix:** Start a new booking to create a fresh hold

### Stripe checkout shows wrong amount
- **Reason:** Service price changed after checkout started
- **Debug:** Check `integration_logs` for "Pricing calculation failed"
- **Fix:** Contact support

### Webhook not received (local)
- **Check:** Is Stripe CLI running? (`stripe listen --forward-to ...`)
- **Check:** Did you copy the signing secret to .env.local?
- **Check:** Is `http://localhost:3000/api/payment/webhook` accessible?

### Webhook signature verification failed
- **Reason:** Wrong webhook secret
- **Fix:** Copy exact signing secret from Stripe CLI or Dashboard

### Booking not confirmed after payment
- **Check:** Did webhook arrive? (Stripe Dashboard → Events)
- **Check:** Is webhook returning 200 OK?
- **Debug:** Check integration_logs for error message
- **Manual Fix:** Verify payment succeeded in Stripe, then update booking status

---

## Test Cards Reference

| Card Number      | Status     | Description |
|------------------|-----------|-------------|
| 4242 4242 4242 4242 | Success | Most common test card |
| 4000 0000 0000 0002 | Declined | Always declines |
| 5555 5555 5555 4444 | Success | Mastercard |
| 3782 822463 10005 | Success | American Express |

---

## Documentation

- **Full Testing Guide:** [PHASE3_TESTING.md](./PHASE3_TESTING.md)
- **Architecture & Implementation:** [PHASE3_COMPLETION_REPORT.md](./PHASE3_COMPLETION_REPORT.md)
- **Stripe Docs:** https://stripe.com/docs

---

## Support

For issues or questions:
1. Check integration_logs table for error details
2. Verify Stripe Dashboard shows expected events
3. Review PHASE3_TESTING.md troubleshooting section
4. Check that all required environment variables are set

Good luck! 🚀
