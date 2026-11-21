import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  // Same JSX runtime as Next.js, so server pages can be rendered in tests.
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Test-only signing key for Manage Booking links (never a real secret; production uses its own Vercel variable).
    env: { BOOKING_MANAGE_SECRET: 'test-only-booking-manage-secret-not-for-production' },
  },
});
