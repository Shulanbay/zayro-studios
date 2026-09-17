# Stripe Test Mode - Local Setup Guide

## Current Status

✅ **Completed:**
- Phase 3 code implemented and compiled
- Dev server running on http://localhost:3000
- Webhook endpoint ready: `/api/payment/webhook`
- Environment variables structure in place
- .env.local properly gitignored

⚠️ **Blocked:**
- PostgreSQL database not running
- Cannot test payment flow without database

---

## Step 1: Get Your Stripe TEST Mode Credentials

**IMPORTANT: Do NOT share these in chat. Only edit locally in .env.local**

1. Go to https://dashboard.stripe.com
2. Make sure you're in **TEST mode** (toggle in top right)
3. Navigate to **Developers** → **API keys**
4. Copy and save these (keep secret):
   - **Publishable Key** (starts with `pk_test_`)
   - **Secret Key** (starts with `sk_test_`)

5. Navigate to **Developers** → **Webhooks**
6. Click **Add an endpoint**
7. For now use: `http://localhost:3000/api/payment/webhook` (local)
8. Select events:
   - `checkout.session.completed`
   - `charge.succeeded`
9. Copy the **Signing secret** (starts with `whsec_test_`)

---

## Step 2: Configure Database

**Choose ONE of these options:**

### Option A: Local PostgreSQL (If installed)

```bash
# Start PostgreSQL
brew services start postgresql

# Create development database
createdb -U postgres zayro_studios_dev

# .env.local already configured for this:
DATABASE_URL=postgresql://postgres:password@localhost:5432/zayro_studios_dev

# Test connection
psql -U postgres -d zayro_studios_dev
```

### Option B: Use Neon (Cloud PostgreSQL)

```bash
# 1. Go to https://console.neon.tech
# 2. Create new project
# 3. Copy connection string (looks like):
#    postgresql://user:password@ep-xxx.region.neon.tech/zayro_studios_dev?sslmode=require

# 4. Update .env.local:
DATABASE_URL=postgresql://user:password@ep-xxx.region.neon.tech/zayro_studios_dev?sslmode=require
```

---

## Step 3: Add Stripe Credentials to .env.local

**File location:**
```
/Users/shulanbaybotabek/Documents/VibeCoding/ZayroStudios/.env.local
```

**Edit lines 15-17:**

```env
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_YOUR_ACTUAL_KEY
STRIPE_SECRET_KEY=sk_test_YOUR_ACTUAL_KEY
STRIPE_WEBHOOK_SECRET=whsec_test_YOUR_ACTUAL_SIGNING_SECRET
```

**WARNING:**
- Never share these keys
- Never commit .env.local to git
- These are TEST mode keys (safe to lose, get new ones anytime)

---

## Step 4: Verify Setup

### Start Dev Server (if not already running)

```bash
cd /Users/shulanbaybotabek/Documents/VibeCoding/ZayroStudios
npm run dev
```

Server should show:
```
✓ Ready in XXXms
- Local: http://localhost:3000
```

### Test Database Connection

```bash
curl -s http://localhost:3000/api/services | jq .
```

Should return service list (or empty array if none seeded yet).

### Test Webhook Endpoint

```bash
curl -X POST http://localhost:3000/api/payment/webhook \
  -H "stripe-signature: invalid" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Should return: `HTTP 401 - Missing/Invalid signature`

---

## Step 5: Seed Test Services (If Needed)

If database is empty, seed with test services:

```sql
INSERT INTO services (name, description, base_price, duration_minutes, category, is_active)
VALUES
  ('Single Podcaster', 'Basic podcast recording', 170.00, 60, 'podcast', true),
  ('Podcast Pro', 'Professional podcast setup', 200.00, 60, 'podcast', true),
  ('Full Podcast Package', 'Recording + Editing', 450.00, 120, 'podcast', true);

INSERT INTO availability (day_of_week, start_time, end_time, is_available)
VALUES
  ('Monday', '09:00', '18:00', true),
  ('Tuesday', '09:00', '18:00', true),
  ('Wednesday', '09:00', '18:00', true),
  ('Thursday', '09:00', '18:00', true),
  ('Friday', '09:00', '18:00', true),
  ('Saturday', '10:00', '16:00', true),
  ('Sunday', '10:00', '16:00', true);

INSERT INTO business_settings (setting_key, setting_value)
VALUES
  ('tax_rate', '0.08625');
```

---

## Step 6: Test Payment Flow

### 1. Open Booking Page

```
http://localhost:3000/booking
```

### 2. Complete Flow

1. Select "Single Podcaster" ($170.00)
2. Select a future date (tomorrow or later)
3. Select available time (should show options)
4. Fill customer info:
   - First Name: Test
   - Last Name: User
   - Email: test@example.com
   - Phone: 555-0123
5. Review summary
6. Click "CONTINUE TO PAYMENT"

### 3. Stripe Test Checkout

- Should redirect to Stripe hosted checkout
- Use test card: `4242 4242 4242 4242`
- Expiry: Any future date (e.g., 12/25)
- CVC: Any 3 digits (e.g., 123)
- Click "Pay"

### 4. Verify Success Page

- Should show "✓ CONFIRMED"
- Displays booking ID, service, date, time, total
- Shows "ZAYRO Studios" address

---

## Step 7: Verify Database State

### Check Confirmed Booking

```sql
SELECT booking_id, status, payment_status, stripe_session_id 
FROM bookings 
WHERE status = 'confirmed' 
ORDER BY created_at DESC 
LIMIT 1;
```

### Check Payment

```sql
SELECT id, status, stripe_payment_id, amount
FROM payments 
WHERE status = 'succeeded' 
ORDER BY created_at DESC 
LIMIT 1;
```

### Check Converted Hold

```sql
SELECT id, status FROM temporary_holds 
WHERE status = 'converted_to_booking' 
ORDER BY created_at DESC 
LIMIT 1;
```

---

## Step 8: Test Webhook Reception

### Without Stripe CLI

Since Stripe CLI install failed, use curl to simulate webhook:

```bash
# Get a valid Stripe session from database
# Then simulate webhook completion...
# (See PHASE3_TESTING.md for detailed webhook simulation)
```

### With Stripe CLI (If Xcode issue resolved)

```bash
stripe listen --forward-to localhost:3000/api/payment/webhook

# Copy the signing secret from CLI output
# Update STRIPE_WEBHOOK_SECRET in .env.local
# Restart dev server (npm run dev)
```

---

## Step 9: Test Amount Validation

### Verify Server-Side Pricing

1. Use browser DevTools console
2. Try to modify sessionStorage prices
3. Complete Stripe checkout
4. Stripe should charge the **server-calculated amount**, not browser amount

Expected behavior:
- Service: $170.00
- Tax: $14.66 (8.625%)
- Total: $184.66

Stripe charges: $184.66 (server value, not browser value)

---

## Step 10: Test Security

### Verify Secrets Not in Code

```bash
cd /Users/shulanbaybotabek/Documents/VibeCoding/ZayroStudios

# Should return nothing (only .env.example with placeholders)
git grep "sk_test_" src/
git grep "sk_live_" src/
```

### Verify .env.local Not Tracked

```bash
git status

# Should NOT show .env.local in changes
# Should show "nothing to commit"
```

---

## Troubleshooting

### "Database connection refused"
- Start PostgreSQL: `brew services start postgresql`
- OR set up Neon connection

### "Services API returns error"
- Check database is running
- Check DATABASE_URL in .env.local is correct
- Restart dev server after changing env vars

### "Stripe checkout not loading"
- Verify NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is correct
- Check browser console for JavaScript errors

### "Webhook not received"
- Verify STRIPE_WEBHOOK_SECRET is correct in .env.local
- Check webhook logs in Stripe Dashboard
- Restart dev server after changing webhook secret

### "Payment processed but booking not created"
- Check database for payment_pending booking
- Check integration_logs for webhook errors
- Manually verify payment in Stripe Dashboard

---

## Test Mode Test Cards

| Card | Status | Use |
|------|--------|-----|
| 4242 4242 4242 4242 | Success | Normal payment |
| 4000 0000 0000 0002 | Declined | Decline testing |
| 5555 5555 5555 4444 | Success | Mastercard |
| 3782 822463 10005 | Success | Amex |

---

## Next Steps

Once database is configured:

1. ✅ Test payment flow end-to-end
2. ✅ Verify webhook processing
3. ✅ Test idempotency (duplicate webhooks)
4. ✅ Test declined payments
5. ✅ Verify security (no secret keys exposed)
6. ✅ Create STRIPE_TEST_MODE_REPORT.md

---

**Status:** Ready for database configuration

**When database is ready:** Reply with "DATABASE READY" to continue testing
