# Stripe Test Mode Setup - Vercel Deployment

## Overview

This guide walks through setting up ZAYRO Studios for **real** Stripe Test Mode testing using Vercel deployment (not localhost). This ensures:

- ✅ Real webhook delivery from Stripe
- ✅ Signature verification on actual public HTTPS endpoint
- ✅ Production-like testing environment
- ✅ Proper success/cancel URL routing

---

## Prerequisites Verified

✅ **Phase 3 Code Implemented**
- Checkout session creation: `/api/payment/create-checkout-session`
- Webhook handler: `/api/payment/webhook` 
- Events: `checkout.session.completed`, `charge.succeeded`
- Signature verification: Required and enforced
- Success/cancel pages: Ready

✅ **Code Requirements**
- Success URL uses: `NEXTAUTH_URL/booking/success?session_id={id}`
- Cancel URL uses: `NEXTAUTH_URL/booking/cancel?hold_id={id}`
- Webhook expects: `stripe-signature` header + `STRIPE_WEBHOOK_SECRET`

---

## STOP POINT 1: Check Current Vercel Project

**YOUR ACTION REQUIRED:**

1. Go to https://vercel.com
2. Find the ZAYRO Studios project
3. Note the **Production URL** (looks like: `https://zayro-studios.vercel.app` or `https://zayro.studio`)
4. Check Environment Variables section
5. Tell me:
   - **Exact production deployment URL**
   - **Which environment variables already exist** (DATABASE_URL, Stripe keys, etc.)

Once you reply with this information, I will tell you exactly which variables are missing.

---

## STOP POINT 2: Verify Neon Database

**YOUR ACTION REQUIRED:**

1. Go to https://console.neon.tech
2. Check if "zayro_studios" or similar database exists (NOT Film Me Studio)
3. If it exists:
   - Verify schema has required tables (services, customers, bookings, etc.)
   - Tell me: **Database exists and can be used**
4. If it does NOT exist:
   - Create new project: "ZAYRO Studios"
   - Create branch/database: "zayro_studios_dev" or similar
   - Once created, tell me: **New Neon database created**

Do NOT share DATABASE_URL in chat. Just confirm when it's ready.

---

## STOP POINT 3: Add Environment Variables to Vercel

**YOUR ACTION REQUIRED:**

Once you have Vercel and Neon ready:

1. Go to Vercel project → Settings → Environment Variables
2. Add these variables:

### Variables YOU must enter (don't share values in chat):

```
DATABASE_URL = [your Neon connection string]
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = pk_test_...
STRIPE_SECRET_KEY = sk_test_...
NEXTAUTH_URL = https://[your-vercel-domain]
NEXTAUTH_SECRET = [any secure random string]
```

### Placeholder variables (not needed yet, Phase 4):
```
RESEND_API_KEY = [leave blank or placeholder]
GOOGLE_CALENDAR_EMAIL = [leave blank or placeholder]
GOOGLE_CALENDAR_PRIVATE_KEY = [leave blank or placeholder]
GOOGLE_CALENDAR_ID = [leave blank or placeholder]
GOOGLE_SHEETS_EMAIL = [leave blank or placeholder]
GOOGLE_SHEETS_PRIVATE_KEY = [leave blank or placeholder]
GOOGLE_SHEETS_ID = [leave blank or placeholder]
```

**For STRIPE_WEBHOOK_SECRET:**
- Do NOT add yet - we'll add it after creating the webhook endpoint
- Tell me when other variables are added

3. After adding variables, **redeploy** the project:
   - Click "Deployments" tab
   - Click "..." on most recent deployment
   - Select "Redeploy"
   - Wait for deployment to complete

---

## STOP POINT 4: Verify Database Connection

**YOUR ACTION REQUIRED (after Neon + Vercel variables):**

1. Wait for Vercel redeployment to complete
2. Test the services API:
   ```
   curl https://[your-vercel-domain]/api/services
   ```
3. You should get:
   - `[]` if empty (that's OK)
   - OR list of services if already seeded

4. Tell me: **Database connection verified** or describe any errors

---

## STOP POINT 5: Seed ZAYRO Test Services

**YOUR ACTION REQUIRED (if services table is empty):**

Once database is connected, run this SQL against your Neon database:

```sql
INSERT INTO services (name, description, base_price, duration_minutes, category, is_active, created_at, updated_at)
VALUES
  ('Single Podcaster', '1 camera, 1 microphone - Recording Only', '170.00', 60, 'podcast', true, NOW(), NOW()),
  ('Podcast Pro', '3 cameras, 2 microphones - Recording Only', '200.00', 60, 'podcast', true, NOW(), NOW()),
  ('Full Podcast Package', 'Recording + Professional Editing', '450.00', 120, 'podcast', true, NOW(), NOW())
ON CONFLICT DO NOTHING;

INSERT INTO availability (day_of_week, start_time, end_time, is_available, created_at, updated_at)
VALUES
  ('Monday', '09:00', '18:00', true, NOW(), NOW()),
  ('Tuesday', '09:00', '18:00', true, NOW(), NOW()),
  ('Wednesday', '09:00', '18:00', true, NOW(), NOW()),
  ('Thursday', '09:00', '18:00', true, NOW(), NOW()),
  ('Friday', '09:00', '18:00', true, NOW(), NOW()),
  ('Saturday', '10:00', '16:00', true, NOW(), NOW()),
  ('Sunday', '10:00', '16:00', true, NOW(), NOW())
ON CONFLICT DO NOTHING;

INSERT INTO business_settings (setting_key, setting_value, created_at, updated_at)
VALUES
  ('tax_rate', '0.08625', NOW(), NOW())
ON CONFLICT (setting_key) DO NOTHING;
```

Tell me: **Services seeded successfully**

---

## STOP POINT 6: Create Stripe Test Webhook

**YOUR ACTION REQUIRED (after Vercel is live):**

1. Go to https://dashboard.stripe.com
2. Make sure you're in **TEST mode**
3. Navigate to **Developers** → **Webhooks**
4. Click **Add an endpoint**
5. Enter URL: `https://[your-vercel-domain]/api/payment/webhook`
6. Click **Select events**
7. Search for and select:
   - ✅ `checkout.session.completed`
   - ✅ `charge.succeeded`
8. Click **Add endpoint**
9. Copy the **Signing secret** (starts with `whsec_test_`)
   - Do NOT share it in chat
10. Tell me: **Webhook created at [exact URL]**

---

## STOP POINT 7: Add Webhook Secret to Vercel

**YOUR ACTION REQUIRED:**

1. Go back to Vercel project → Settings → Environment Variables
2. Add new variable:
   ```
   STRIPE_WEBHOOK_SECRET = [the whsec_test_ value from Stripe]
   ```
3. Redeploy the project:
   - Click "Deployments"
   - Click "..." on most recent
   - Select "Redeploy"
4. Wait for deployment to complete
5. Tell me: **Webhook secret added and redeployed**

---

## STOP POINT 8: Verify Webhook Endpoint

**YOUR ACTION REQUIRED:**

Test that the webhook endpoint is accessible and rejects bad signatures:

```bash
curl -X POST https://[your-vercel-domain]/api/payment/webhook \
  -H "stripe-signature: invalid" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Expected response: HTTP 401 (unauthorized)

Tell me: **Webhook endpoint verified** (or describe error)

---

## Ready for Real Test

Once all STOP POINTS are complete:

- ✅ Vercel deployment live
- ✅ Neon database connected
- ✅ Test services seeded
- ✅ Stripe TEST keys in Vercel
- ✅ Stripe webhook endpoint created
- ✅ Webhook signing secret in Vercel
- ✅ Webhook endpoint tested

I will guide you through the complete payment flow test.

---

## Summary of Required Values (Don't Share)

Keep these secure, never paste in chat:

| Variable | Where to get | Where it goes |
|----------|-------------|---------------|
| DATABASE_URL | Neon console | Vercel env vars |
| NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY | Stripe → Developers → API Keys | Vercel env vars |
| STRIPE_SECRET_KEY | Stripe → Developers → API Keys | Vercel env vars |
| STRIPE_WEBHOOK_SECRET | Stripe → Developers → Webhooks → Signing secret | Vercel env vars |
| NEXTAUTH_URL | Your Vercel deployment URL | Vercel env vars |
| NEXTAUTH_SECRET | Generate a random string | Vercel env vars |

---

## Troubleshooting

### "Webhook URL already exists"
- Vercel and Stripe webhook URLs must match exactly
- Check for trailing slashes or typos
- Delete old endpoint and create new one if needed

### "Database connection refused"
- Verify DATABASE_URL in Vercel is correct
- Check Neon database is running
- Verify Neon allows connections from Vercel IP range

### "Stripe keys rejected"
- Verify you're in TEST mode (not live)
- Verify key hasn't been rotated/deleted
- Keys are case-sensitive

### "Vercel deployment failed"
- Check build logs in Vercel dashboard
- Verify all required env vars are set
- Restart deployment

---

## Next Phase

Once all STOP POINTS are complete and verified, I will guide you through:

1. ✅ Real Stripe Test Mode payment flow
2. ✅ Webhook signature verification
3. ✅ Database state verification
4. ✅ Idempotency testing
5. ✅ Cancel flow testing
6. ✅ Security audit
7. ✅ Final STRIPE_TEST_MODE_REPORT.md

---

**Current Status:** Ready for STOP POINT 1

**Next Action:** Check your Vercel project and Neon database status
