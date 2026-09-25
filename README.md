# ZAYRO Studios

Premium podcast and video recording studio in Midtown Manhattan.

## Getting Started

### Prerequisites
- Node.js 18+
- npm or yarn
- PostgreSQL database

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install --legacy-peer-deps
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env.local
   ```

4. Update `.env.local` with your actual credentials

### Development

Run the development server:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Database

Schema changes are versioned SQL migrations in `drizzle/`. They are applied
automatically at the start of every Vercel **production** build
(`scripts/migrate.mjs`, which logs a counts-only before/after report); local
and preview builds skip that step. Every migration must be idempotent and
additive — see [docs/crm-migration-and-rollback.md](docs/crm-migration-and-rollback.md).
The CRM migrations (0005–0008) are hand-written; `drizzle/meta` snapshots stop
at 0004, so don't rely on `db:generate` to diff them — write new migrations by
hand in the same style.

Read-only production check (counts only): `DATABASE_URL=… node scripts/crm-dry-run.mjs`.

### Building for Production

```bash
npm run build
npm start
```

## Project Structure

- `/src/app` - Next.js app directory with pages and layouts
- `/src/components` - React components
- `/src/lib` - Utility functions and database setup
- `/src/types` - TypeScript type definitions
- `/public` - Static assets

## Database

This project uses PostgreSQL with Drizzle ORM for type-safe database operations.

## Admin CRM (`/admin`)

Dashboard, Calendar, Sessions, Customers, Purchases, Packages, Services,
Availability, Blocked Time, Integrations, Reports (CSV), Team & Roles, Audit
Log and Settings, on the same database as the website. Sign in with an email
magic link; roles and permissions are enforced on the server.

- Architecture: [docs/crm-architecture.md](docs/crm-architecture.md)
- Data model: [docs/database-schema.md](docs/database-schema.md)
- Security & permission matrix: [docs/crm-security.md](docs/crm-security.md)
- How to run the studio with it: [docs/crm-operations.md](docs/crm-operations.md)
- Roadmap & risks: [docs/crm-roadmap.md](docs/crm-roadmap.md)

## Main API routes

- `GET /api/booking/available-dates`, `GET /api/booking/available-times` - public availability (ET)
- `POST /api/booking/create-hold` - hold a slot (rate limited, studio-wide lock)
- `POST /api/booking/confirm-free` - confirm a $0 booking (studio tour)
- `POST /api/payment/create-checkout-session` - Stripe Checkout for a held slot
- `POST /api/payment/webhook` - Stripe webhook (signature-verified, idempotent)
- `/api/admin/*` - CRM (session + permission checked)

## Tests

`npm test` runs unit tests plus integration tests against a real in-process
Postgres (PGlite) with every migration applied — double booking, DST,
webhook idempotency, refunds, package credits, permissions, CSV safety.

## Environment Variables

See `.env.example` for the complete list of required environment variables.

## Google Calendar & Google Sheets

Confirmed bookings are mirrored to a Google Calendar and to the
"Paid Bookings" / "Studio Tours" tabs of a Google Sheet. Setup, the
organization-policy workaround for creating the service account key, and
troubleshooting are in [GOOGLE_INTEGRATION_SETUP.md](GOOGLE_INTEGRATION_SETUP.md).

## Deployment

Deploy to Vercel:
```bash
vercel
```

## License

Proprietary - ZAYRO Studios
