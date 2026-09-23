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

Schema changes are versioned SQL migrations in `drizzle/` (generate with
`npm run db:generate`). They are applied automatically at the start of every
Vercel **production** build (`scripts/migrate.mjs`); local and preview builds
skip that step. Every migration must be idempotent.

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

## API Routes

- `POST /api/booking/create` - Create a new booking
- `GET /api/booking/check-availability` - Check available dates
- `GET /api/booking/get-availability` - Get available times for a date
- `POST /api/stripe/webhook` - Stripe webhook handler

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
