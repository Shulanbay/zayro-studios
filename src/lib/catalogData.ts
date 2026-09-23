import { eq } from 'drizzle-orm';
import { db } from './db';
import { services } from './db/schema';
import type { Service } from './db/schema';
import { sortServices } from './catalog';

/** Server-only: every active service, in display order. */
export async function getActiveServices(): Promise<Service[]> {
  const rows = await db.query.services.findMany({ where: eq(services.is_active, true) });
  // Filter again in JS so an inactive row can never leak even if the query changes.
  return sortServices(rows.filter((s) => s.is_active));
}

/**
 * Base services referenced by packages. A package may be priced from a
 * service that is currently inactive, so these are loaded by id regardless
 * of is_active.
 */
export async function getServicesById(ids: number[]): Promise<Map<number, Service>> {
  const unique = Array.from(new Set(ids.filter((id) => Number.isInteger(id))));
  const map = new Map<number, Service>();
  for (const id of unique) {
    const row = await db.query.services.findFirst({ where: eq(services.id, id) });
    if (row) map.set(id, row);
  }
  return map;
}

export type BookableLookup =
  | { ok: true; service: Service }
  | { ok: false; status: 400 | 404; error: string };

/**
 * Loads a service that a customer may book as a single time slot. Used by
 * every booking/payment route so packages and inactive services are
 * rejected server-side no matter what the client sends.
 */
export async function findBookableService(serviceId: unknown): Promise<BookableLookup> {
  const id = typeof serviceId === 'number' ? serviceId : parseInt(String(serviceId ?? ''), 10);
  if (!Number.isInteger(id) || id < 1) return { ok: false, status: 400, error: 'Invalid service' };
  const service = await db.query.services.findFirst({ where: eq(services.id, id) });
  if (!service || !service.is_active) return { ok: false, status: 404, error: 'Service not found' };
  return checkBookable(service);
}

export function checkBookable(service: Service): BookableLookup {
  if (!service.is_active) return { ok: false, status: 404, error: 'Service not found' };
  if (service.category === 'package') {
    return {
      ok: false,
      status: 400,
      error: 'Monthly packages are requested through the contact form, not booked as a time slot.',
    };
  }
  return { ok: true, service };
}
