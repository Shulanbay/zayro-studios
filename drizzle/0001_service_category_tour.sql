-- Studio tours get their own service category instead of being inferred
-- from a $0 price. Idempotent: safe to run against a database that already
-- has the value.
ALTER TYPE "service_category" ADD VALUE IF NOT EXISTS 'tour';
