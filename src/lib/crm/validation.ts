import { z } from 'zod';
import { isDateString, isTimeString } from './time';

export const dateStr = z.string().refine(isDateString, 'must be a date (YYYY-MM-DD)');
export const timeStr = z.string().refine(isTimeString, 'must be a time (HH:MM)');
export const uuid = z.string().uuid('must be an id');
const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();

export const manualBookingSchema = z
  .object({
    serviceId: z.coerce.number().int().positive(),
    date: dateStr,
    startTime: timeStr,
    customerId: uuid.optional().nullable(),
    email: z.string().trim().email().max(255).optional(),
    firstName: optionalText(100),
    lastName: optionalText(100),
    phone: optionalText(20),
    company: optionalText(255),
    notes: optionalText(2000),
    internalNotes: optionalText(5000),
    paymentMode: z.enum(['unpaid', 'comp', 'offline_paid', 'package']),
    paymentMethod: z.enum(['cash', 'card_terminal', 'bank_transfer', 'other']).optional(),
    customerPackageId: uuid.optional().nullable(),
    overrideHours: z.boolean().optional(),
    sendConfirmation: z.boolean().optional(),
  })
  .strict()
  .refine((v) => !!v.customerId || !!v.email, { message: 'Choose a customer or enter an email', path: ['email'] })
  .refine((v) => v.paymentMode !== 'package' || !!v.customerPackageId, { message: 'Choose a package', path: ['customerPackageId'] })
  .refine((v) => v.paymentMode !== 'offline_paid' || !!v.paymentMethod, { message: 'Choose how it was paid', path: ['paymentMethod'] });

export const rescheduleSchema = z
  .object({
    date: dateStr,
    startTime: timeStr,
    serviceId: z.coerce.number().int().positive().optional(),
    overrideHours: z.boolean().optional(),
    notifyCustomer: z.boolean().optional(),
    reason: optionalText(500),
  })
  .strict();

export const outcomeSchema = z.object({ outcome: z.enum(['completed', 'no_show', 'confirmed']) }).strict();
export const notesSchema = z.object({ internalNotes: z.string().max(5000) }).strict();
