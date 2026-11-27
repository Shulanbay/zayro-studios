/** Shared zod schemas for the marketing admin APIs. */
import { z } from 'zod';
import { LEAD_CONTACT_METHODS, LEAD_STATUSES } from '@/lib/db/schema';

const opt = (max: number) => z.string().trim().max(max).nullable().optional();
const money = z.number().min(0).max(10_000_000).transform((v) => Math.round(v * 100));

export const leadCreateSchema = z.object({
  name: opt(200),
  phone: opt(40),
  email: z.string().trim().max(255).email().nullable().optional().or(z.literal('')),
  message: opt(3000),
  contact_method: z.enum(LEAD_CONTACT_METHODS).default('other'),
  status: z.enum(LEAD_STATUSES).optional(),
  revenue: money.optional(),
  notes: opt(5000),
  utm_source: opt(150),
  utm_medium: opt(150),
  utm_campaign: opt(150),
  landing_page_slug: opt(80),
});

export const leadPatchSchema = z.object({
  name: opt(200),
  phone: opt(40),
  email: z.string().trim().max(255).email().nullable().optional().or(z.literal('')),
  status: z.enum(LEAD_STATUSES).optional(),
  revenue: money.optional(),
  ad_spend_attributed: money.optional(),
  notes: opt(5000),
  lost_reason: opt(200),
  assigned_to: opt(255),
  contact_method: z.enum(LEAD_CONTACT_METHODS).optional(),
});
