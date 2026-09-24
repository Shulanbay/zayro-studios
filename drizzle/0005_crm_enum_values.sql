-- CRM, step 1 of 4: new values for existing enums. Postgres can't use a
-- value added with ALTER TYPE ... ADD VALUE in the same transaction, so
-- these commit on their own before 0006-0008 use them. Idempotent.
ALTER TYPE "booking_status" ADD VALUE IF NOT EXISTS 'no_show';--> statement-breakpoint
ALTER TYPE "payment_status" ADD VALUE IF NOT EXISTS 'partially_refunded';
