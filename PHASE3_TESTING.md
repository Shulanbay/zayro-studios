# Phase 3 Testing Guide

This guide covers testing for Stripe payments + webhook + confirmed booking functionality.

## Environment Setup

### 1. Stripe Test Mode Account

1. Go to [Stripe Dashboard](https://dashboard.stripe.com)
2. Switch to **Test mode** (toggle in top right)
3. Navigate to **Developers** > **API keys**
4. Copy your **Publishable key** (starts with `pk_test_`)
5. Copy your **Secret key** (starts with `sk_test_`)

### 2. Webhook Setup

1. Go to **Developers** > **Webhooks**
2. Click **Add endpoint**
3. For **Endpoint URL**, use: `http://localhost:3000/api/payment/webhook` (local) or your Vercel deployment URL
4. Click **Select events**
5. Subscribe to:
   - `checkout.session.completed`
   - `charge.succeeded`
6. Copy the **Signing secret** (starts with `whsec_test_`)

### 3. Local Environment Variables

Create or update `.env.local`:

```env
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_YOUR_KEY_HERE
STRIPE_SECRET_KEY=sk_test_YOUR_KEY_HERE
STRIPE_WEBHOOK_SECRET=whsec_test_YOUR_KEY_HERE
NEXTAUTH_URL=http://localhost:3000
```

### 4. Local Webhook Testing (Optional)

For local development without exposing your app, use Stripe CLI:

```bash
# Install Stripe CLI: https://stripe.com/docs/stripe-cli
brew install stripe/stripe-cli/stripe

# Authenticate
stripe login

# Forward webhooks to your local endpoint
stripe listen --forward-to localhost:3000/api/payment/webhook

# Copy the signing secret from the CLI output
# Update STRIPE_WEBHOOK_SECRET in .env.local
```

## Test Scenarios

### 1. Valid Hold → Stripe Checkout Flow

**Steps:**
1. Start at `/booking`
2. Select a service (e.g., "Single Hour")
3. Select a date at least 24 hours in advance
4. Select an available time
5. Complete customer info form
6. Review booking summary
7. Click "CONTINUE TO PAYMENT"
   - Verify: Server recalculates pricing
   - Verify: Button changes to "SECURE CHECKOUT"
8. Click "SECURE CHECKOUT"
   - Browser redirects to Stripe checkout

**Expected Outcome:** Stripe Checkout page loads with correct service name, date/time, and pricing

---

### 2. Browser-Manipulated Price Is Ignored

**Setup:**
1. Open browser DevTools
2. Go to `/booking` and select service → date → time → customer info
3. Before clicking "CONTINUE TO PAYMENT", in Console run:
   ```javascript
   sessionStorage.setItem('bookingData', JSON.stringify({
     totalAmount: 1.00,  // Try to set to $1
     taxAmount: 0
   }));
   ```

**Steps:**
1. Click "CONTINUE TO PAYMENT"
2. Server creates Stripe session
3. Button changes to "SECURE CHECKOUT"

**Expected Outcome:** 
- Stripe session shows actual service price (e.g., $200.00), NOT $1.00
- Pricing displays correctly in summary

---

### 3. Expired Hold Cannot Start Payment

**Setup:**
1. Create a hold and wait for it to expire (15 minutes)

**Steps:**
1. Try to click "CONTINUE TO PAYMENT" with expired hold
2. Or manually call API:
   ```bash
   curl -X POST http://localhost:3000/api/payment/create-checkout-session \
     -H "Content-Type: application/json" \
     -d '{"holdId":"expired-hold-id","firstName":"Test",...}'
   ```

**Expected Outcome:** 
- Error message: "Booking hold has expired. Please select a new time slot."
- User redirected to step 3 (time selection)

---

### 4. Invalid Hold Cannot Start Payment

**Steps:**
1. Manually call API with non-existent holdId:
   ```bash
   curl -X POST http://localhost:3000/api/payment/create-checkout-session \
     -H "Content-Type: application/json" \
     -d '{"holdId":"00000000-0000-0000-0000-000000000000","firstName":"Test",...}'
   ```

**Expected Outcome:** 
- HTTP 404 response: "Booking hold not found"
- No Stripe session created

---

### 5. Successful Stripe Test Payment

**Steps:**
1. Complete the booking flow through step 7 (summary)
2. Click "SECURE CHECKOUT" → Stripe Checkout
3. Fill in test card details:
   - Email: any email
   - Card: `4242 4242 4242 4242`
   - Expiry: Any future date (e.g., 12/25)
   - CVC: Any 3 digits (e.g., 123)
4. Click "Pay"

**Expected Outcome:**
- Stripe redirects to `/booking/success?session_id=...`
- Page loads "✓ CONFIRMED"
- Displays booking ID, service, date, time, total
- Database has:
  - New confirmed booking
  - Updated hold status to `converted_to_booking`
  - Payment record with status `succeeded`

---

### 6. Verified Webhook Creates Confirmed Booking

**Database Check:**
```sql
-- Check that webhook processed correctly
SELECT id, booking_id, status, payment_status, stripe_session_id 
FROM bookings 
WHERE status = 'confirmed' 
ORDER BY created_at DESC 
LIMIT 1;

-- Check hold was converted
SELECT id, status FROM temporary_holds 
WHERE status = 'converted_to_booking' 
ORDER BY created_at DESC 
LIMIT 1;

-- Check payment
SELECT id, status, stripe_payment_id 
FROM payments 
WHERE status = 'succeeded' 
ORDER BY created_at DESC 
LIMIT 1;
```

**Expected Outcome:**
- One confirmed booking exists
- Hold status = `converted_to_booking`
- Payment status = `succeeded`

---

### 7. Successful Browser Redirect Alone Does NOT Create Booking

**Steps:**
1. Complete booking flow through summary
2. Get a valid Stripe session ID (from Network tab or server logs)
3. Manually navigate to: `/booking/success?session_id=FAKE_SESSION_ID`

**Expected Outcome:**
- Page shows "Booking Not Found" or "Payment Issue"
- No booking is created in database
- No hold is converted

---

### 8. Fake Webhook Without Valid Signature Is Rejected

**Steps:**
1. Test the webhook endpoint without signature:
   ```bash
   curl -X POST http://localhost:3000/api/payment/webhook \
     -H "Content-Type: application/json" \
     -d '{"type":"checkout.session.completed","data":{"object":{}}}'
   ```

**Expected Outcome:**
- HTTP 401 response: "Missing stripe-signature header"
- No booking created
- Error logged

---

### 9. Duplicate Webhook Does NOT Create Duplicate Booking

**Stripe Admin Simulation:**
1. Complete a successful payment
2. Check database for the created booking (note the ID)
3. Use Stripe CLI to resend the webhook:
   ```bash
   # Find event ID from logs
   stripe events list
   
   # Resend event
   stripe events resend evt_XXXXX
   ```

**Expected Outcome:**
- Second webhook processed
- Idempotency check returns existing booking
- Only ONE confirmed booking exists in database
- No duplicate entries

---

### 10. Five Duplicate Webhook Deliveries → Still One Booking

**Steps:**
1. Simulate multiple webhook deliveries for same session
2. Query database

**Expected Outcome:**
- Only 1 confirmed booking
- Only 1 payment record
- Only 1 converted hold

---

### 11. Payment Amount Mismatch Is Rejected

**Database Manipulation (Test Only):**
1. Create a hold
2. Start checkout (server calculates $200 for 1-hour service)
3. Before webhook, artificially change the service price in database:
   ```sql
   UPDATE services SET base_price = 50.00 WHERE id = 1;
   ```
4. Webhook tries to process with amount_total = 200*100

**Expected Outcome:**
- Webhook validation fails: "Payment amount mismatch"
- No booking created
- Payment record remains `pending`
- Error logged

---

### 12. Wrong Currency Is Rejected

**Setup:**
- Manually craft a Stripe session with currency: "EUR" instead of "USD"

**Expected Outcome:**
- Webhook validation fails: "Currency mismatch"
- No booking created

---

### 13. Failed Payment Creates No Booking

**Steps:**
1. Go through booking flow
2. At Stripe Checkout, use a test card that declines:
   - Card: `4000 0000 0000 0002` (always declines)
3. Stripe shows decline message
4. No webhook event sent (payment never succeeded)

**Expected Outcome:**
- `/booking/cancel?hold_id=...` shows cancellation page
- No confirmed booking created
- Hold remains `active` (can retry)
- Payment remains `pending`

---

### 14. Cancelled Checkout Creates No Booking

**Steps:**
1. Go through booking flow to Stripe Checkout
2. Click browser back button
3. Or close the checkout window
4. Return to app

**Expected Outcome:**
- Redirected to `/booking/cancel?hold_id=...`
- No webhook event sent
- No booking created
- Hold remains `active`

---

### 15. Back Button Behavior

**Steps:**
1. Start booking flow
2. Get to summary step
3. Click back button at various stages
4. After payment, try back button

**Expected Outcome:**
- Back buttons work correctly
- Data is preserved in state
- No corruption

---

### 16. Refresh During Booking

**Steps:**
1. Get to summary step
2. Refresh page (Cmd+R / Ctrl+R)

**Expected Outcome:**
- Booking state lost (fresh start)
- Must restart booking flow
- Hold still exists in database (valid for 15 more minutes)

---

### 17. Refresh During Hold

**Steps:**
1. Create hold
2. Refresh page
3. Try to use the same hold ID

**Expected Outcome:**
- Can create new session with same hold ID
- System prevents double-booking

---

### 18. Manually Open /booking/success

**Steps:**
1. Manually navigate to: `/booking/success?session_id=invalid`

**Expected Outcome:**
- Page shows "Booking Not Found"
- No booking created

---

### 19. Open /booking/success in Another Browser

**Steps:**
1. Complete booking on Browser A
2. Copy success URL
3. Open in Browser B
4. Should still show confirmation (server-verified)

**Expected Outcome:**
- Browser B shows same confirmation
- Data retrieved from server, not localStorage
- No issues

---

### 20. Two Users Attempting Same Slot

**Setup:**
- Configure 2 parallel browser windows

**Steps:**
1. User A: Select service → date → time (creates hold)
2. User B: Select same service → date → time (should see as unavailable due to active hold)
3. User A: Complete checkout
4. User B: Should not be able to book that slot

**Expected Outcome:**
- User B's time slot shows as unavailable after User A's hold is created
- User B cannot create conflicting hold

---

### 21. Hold Expiration During Payment Edge Case

**Setup:**
- Create hold (15 min expiration)
- Start payment immediately
- Wait for hold to expire while on Stripe checkout

**Steps:**
1. Create hold (expires in 15 min)
2. Click "CONTINUE TO PAYMENT"
3. Wait 16 minutes
4. Try to complete Stripe payment
5. Or complete payment and check webhook

**Expected Outcome:**
- If before expiration: Booking created successfully
- If after expiration: Webhook validation fails (hold no longer active)
- Edge cases handled gracefully

---

### 22. Mobile Checkout Flow

**Steps:**
1. Use mobile device or emulate mobile in DevTools
2. Complete full booking flow
3. Proceed through Stripe checkout

**Expected Outcome:**
- Responsive design works
- Stripe checkout responsive on mobile
- Payment processes correctly
- Success page displays correctly

---

### 23. Production Build

**Steps:**
```bash
npm run build
npm start
```

1. Complete full booking flow in production build
2. Verify no TypeScript errors

**Expected Outcome:**
- Build succeeds with zero errors
- Production app works correctly

---

### 24. TypeScript Checks

**Steps:**
```bash
npx tsc --noEmit
```

**Expected Outcome:**
- Zero TypeScript errors

---

### 25. No Secrets Committed

**Steps:**
```bash
# Check for hardcoded secrets
grep -r "sk_test_" src/
grep -r "pk_test_" src/
grep -r "whsec_test_" src/
```

**Expected Outcome:**
- No output (no secrets in code)
- All secrets in `.env.local` only

---

## Test Data Setup

### Services Database

```sql
INSERT INTO services (name, description, base_price, duration_minutes, category, is_active)
VALUES
  ('Single Hour', '1 hour professional studio session', 200.00, 60, 'podcast', true),
  ('Half Day', '4 hours professional studio session', 700.00, 240, 'video', true),
  ('Full Day', '8 hours professional studio session', 1200.00, 480, 'livestream', true);
```

### Business Settings

```sql
INSERT INTO business_settings (setting_key, setting_value)
VALUES
  ('tax_rate', '0.08625'),  -- 8.625% (NYC tax)
  ('buffer_before_booking', '15'),
  ('buffer_after_booking', '15'),
  ('booking_increment_minutes', '30'),
  ('min_advance_notice_hours', '24'),
  ('max_booking_horizon_days', '90');
```

### Availability (Business Hours)

```sql
INSERT INTO availability (day_of_week, start_time, end_time, is_available)
VALUES
  ('Monday', '09:00', '18:00', true),
  ('Tuesday', '09:00', '18:00', true),
  ('Wednesday', '09:00', '18:00', true),
  ('Thursday', '09:00', '18:00', true),
  ('Friday', '09:00', '18:00', true),
  ('Saturday', '10:00', '16:00', true),
  ('Sunday', '10:00', '16:00', true);
```

---

## Monitoring & Debugging

### Server Logs

Watch server logs in terminal where `npm run dev` is running:

```
API POST /api/payment/create-checkout-session
Error creating checkout session: ...
```

### Database Inspection

Use Drizzle Studio:
```bash
npx drizzle-kit studio
```

Check:
- `temporary_holds` - verify holds exist and expire correctly
- `bookings` - verify confirmed bookings are created
- `payments` - verify payment records exist
- `integration_logs` - verify stripe events are logged

### Stripe Dashboard

1. Go to [Stripe Dashboard](https://dashboard.stripe.com)
2. **Payments** → View recent charges
3. **Events** → View webhook events
4. **Logs** → View API activity

### Integration Logs

```sql
SELECT * FROM integration_logs 
WHERE integration_type = 'stripe' 
ORDER BY created_at DESC 
LIMIT 20;
```

---

## Known Limitations

- [ ] Google Calendar integration deferred to Phase 4
- [ ] Email notifications deferred to Phase 4
- [ ] Google Sheets logging deferred to Phase 4
- [ ] Admin dashboard deferred to Phase 4
- [ ] Refund handling deferred to Phase 4

---

## Success Criteria

All 25 test scenarios must pass before Phase 3 is considered complete.

After completion:
1. ✅ Run full test suite
2. ✅ Check TypeScript
3. ✅ Run production build
4. ✅ Verify no secrets in code
5. ✅ Create PHASE3_COMPLETION_REPORT.md
