-- Admin actions (e.g. cancelling a booking) are recorded in integration_logs
-- as an audit trail. Idempotent: safe to re-run.
ALTER TYPE "integration_type" ADD VALUE IF NOT EXISTS 'admin';
