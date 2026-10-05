import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from './db';
import { serviceAddons, setups } from './db/schema';
import type { Service, ServiceAddon, Setup } from './db/schema';
import type { Executor } from './db/types';
import { getTaxRate } from './pricing';
import { computeQuote, normalizeAddonChoices, normalizeUnits, type AddonChoice, type BookingSelection, type Quote } from './bookingOptions';
import type { NewLineItem } from './crm/purchases';

/** Add-ons a customer can buy with a service of this category, in display order. */
export async function listAddonsForCategory(category: string, exec: Executor = db): Promise<ServiceAddon[]> {
  const rows = await exec.query.serviceAddons.findMany({
    where: eq(serviceAddons.active, true),
    orderBy: [asc(serviceAddons.sort_order), asc(serviceAddons.id)],
  });
  return rows.filter((a) => Array.isArray(a.categories) && a.categories.includes(category));
}

export type QuoteResult = { ok: true; quote: Quote; selection: BookingSelection } | { ok: false; error: string };

/**
 * The authoritative price of a booking: the service's current price × hours
 * plus the chosen add-ons at their current prices, with tax. Every add-on is
 * re-read from the database; unknown, inactive or wrong-category add-ons
 * and quantities above the add-on's limit are refused.
 */
export async function quoteBooking(service: Service, units: number, choices: AddonChoice[], exec: Executor = db): Promise<QuoteResult> {
  let picked: { addon: ServiceAddon; quantity: number }[] = [];
  if (choices.length > 0 && !(parseFloat(service.base_price) > 0)) {
    return { ok: false, error: 'Extras cannot be added to a free booking.' };
  }
  if (choices.length > 0) {
    const rows = await exec.query.serviceAddons.findMany({
      where: and(
        inArray(
          serviceAddons.id,
          choices.map((c) => c.id)
        ),
        eq(serviceAddons.active, true)
      ),
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const choice of choices) {
      const addon = byId.get(choice.id);
      if (!addon || !Array.isArray(addon.categories) || !addon.categories.includes(service.category)) {
        return { ok: false, error: 'One of the selected extras is no longer available. Please review your extras.' };
      }
      if (choice.quantity > addon.max_quantity) {
        return { ok: false, error: `You can add at most ${addon.max_quantity} × ${addon.name}.` };
      }
      picked.push({ addon, quantity: choice.quantity });
    }
    picked = picked.sort((a, b) => a.addon.sort_order - b.addon.sort_order || a.addon.id - b.addon.id);
  }
  const taxRate = await getTaxRate(exec);
  const quote = computeQuote({ service, units, addons: picked, taxRate });
  return { ok: true, quote, selection: { units, addons: choices } };
}

export function quoteForClient(quote: Quote) {
  const money = (cents: number) => (cents / 100).toFixed(2);
  return {
    subtotal: money(quote.subtotal),
    taxAmount: money(quote.taxAmount),
    total: money(quote.total),
    taxRate: quote.taxRate,
    currency: quote.currency,
    units: quote.units,
    durationMinutes: quote.durationMinutes,
    lines: quote.lines.map((l) => ({ kind: l.kind, name: l.unit === 'hour' ? `${l.name} (per hour)` : l.kind === 'service' && quote.units > 1 ? `${l.name} (hours)` : l.name, quantity: l.quantity, unit: l.unit ?? null, unitPrice: money(l.unitPriceCents), total: money(l.totalCents) })),
  };
}

/** The quote a hold was created for, recomputed at today's prices from the hold's stored selection. */
export async function quoteForHold(
  service: Service,
  hold: { selection?: unknown; duration_minutes: number },
  exec: Executor = db
): Promise<QuoteResult> {
  const selection = (hold.selection && typeof hold.selection === 'object' ? hold.selection : {}) as Partial<BookingSelection>;
  // Holds created before add-ons existed have no selection: derive hours from the held duration.
  const fallbackUnits = service.duration_minutes > 0 ? hold.duration_minutes / service.duration_minutes : 1;
  const units = normalizeUnits(selection.units ?? fallbackUnits, service);
  const choices = normalizeAddonChoices(selection.addons);
  if (units === null || choices === null || service.duration_minutes * units !== hold.duration_minutes) {
    return { ok: false, error: 'This reservation is no longer valid. Please choose a time again.' };
  }
  return quoteBooking(service, units, choices, exec);
}

/** Immutable purchase line items for a quote: the service (× hours) and each add-on. */
export function purchaseItemsFromQuote(
  quote: Quote,
  ctx: { bookingId: string; category: string; date: string; start: string; end: string }
): NewLineItem[] {
  return quote.lines.map((line) =>
    line.kind === 'service'
      ? {
          itemType: 'service' as const,
          referenceId: line.referenceId,
          description: `${line.name} — ${ctx.date} ${ctx.start}–${ctx.end} ET`,
          quantity: line.quantity,
          unitPriceCents: line.unitPriceCents,
          metadata: { bookingId: ctx.bookingId, category: ctx.category, durationMinutes: quote.durationMinutes, taxRate: quote.taxRate },
        }
      : {
          itemType: 'addon' as const,
          referenceId: line.referenceId,
          description: `Add-on: ${line.name}${line.unit === 'hour' ? ' (per hour)' : ''}`,
          quantity: line.quantity,
          unitPriceCents: line.unitPriceCents,
          metadata: { bookingId: ctx.bookingId, unit: line.unit ?? 'session' },
        }
  );
}

/** Studio setups a customer can choose for a service of this category (active, in display order). */
export async function listSetupsForCategory(category: string, exec: Executor = db): Promise<Setup[]> {
  const rows = await exec.query.setups.findMany({ where: eq(setups.active, true), orderBy: [asc(setups.sort_order), asc(setups.id)] });
  return rows.filter((s) => {
    const categories = (s.metadata as { categories?: unknown })?.categories;
    return Array.isArray(categories) && categories.includes(category);
  });
}

/**
 * Checks the chosen setup. A category with more than one setup needs a
 * choice; a category with exactly one gets it automatically.
 */
export async function resolveSetup(
  category: string,
  setupId: unknown,
  exec: Executor = db
): Promise<{ ok: true; setupId: number | null } | { ok: false; error: string }> {
  const options = await listSetupsForCategory(category, exec);
  if (options.length === 0) return { ok: true, setupId: null };
  if (setupId === undefined || setupId === null || setupId === '') {
    return options.length === 1 ? { ok: true, setupId: options[0].id } : { ok: false, error: 'Please choose a studio setup.' };
  }
  const id = Number(setupId);
  const match = options.find((s) => s.id === id);
  return match ? { ok: true, setupId: match.id } : { ok: false, error: 'That studio setup is not available. Please choose another.' };
}

/** Booking columns for the setup a hold was created with: the id plus a name snapshot for staff. */
export async function setupForHold(hold: { selection?: unknown }, exec: Executor = db): Promise<{ setupId: number | null; setupName: string | null }> {
  const id = Number((hold.selection as { setupId?: unknown } | null)?.setupId);
  if (!Number.isInteger(id) || id < 1) return { setupId: null, setupName: null };
  const row = await exec.query.setups.findFirst({ where: eq(setups.id, id) });
  return row ? { setupId: row.id, setupName: row.name } : { setupId: null, setupName: null };
}
