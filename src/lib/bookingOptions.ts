/**
 * Booking options shared by the public flow, the API routes and the CRM:
 * session length in hours, add-on selection and the intake questions that
 * help the studio prepare. Pure — safe for client components and tests.
 * Prices are never decided here from client input; see lib/bookingQuote.ts.
 */

/** Longest session a customer can book online in one day. */
export const MAX_SESSION_HOURS = 9;

/** Categories sold by the hour: the customer picks how many hours. */
const HOURLY_CATEGORIES = ['podcast', 'video', 'livestream'];

/** How many units (hours) of this service one booking may contain. */
export function maxUnits(service: { category: string; duration_minutes: number }): number {
  if (!HOURLY_CATEGORIES.includes(service.category) || service.duration_minutes !== 60) return 1;
  return MAX_SESSION_HOURS;
}

export function normalizeUnits(value: unknown, service: { category: string; duration_minutes: number }): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? parseInt(value, 10) : value === undefined || value === null ? 1 : NaN;
  if (!Number.isInteger(n) || n < 1 || n > maxUnits(service)) return null;
  return n;
}

export interface AddonChoice {
  id: number;
  quantity: number;
}

export interface BookingSelection {
  units: number;
  addons: AddonChoice[];
  /** The studio setup the customer chose (podcast). */
  setupId?: number;
}

/** Cleans a client-sent add-on list: integer ids, quantity ≥ 1, no duplicates. */
export function normalizeAddonChoices(value: unknown): AddonChoice[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 30) return null;
  const byId = new Map<number, number>();
  for (const item of value) {
    const id = Number((item as { id?: unknown })?.id);
    const quantity = Number((item as { quantity?: unknown })?.quantity);
    if (!Number.isInteger(id) || id < 1 || !Number.isInteger(quantity) || quantity < 0 || quantity > 20) return null;
    if (quantity > 0) byId.set(id, quantity);
  }
  return Array.from(byId, ([id, quantity]) => ({ id, quantity })).sort((a, b) => a.id - b.id);
}

// ---------------------------------------------------------------------------
// Intake questions
// ---------------------------------------------------------------------------

export const RECORDING_TYPES = ['Podcast', 'Interview', 'YouTube Video', 'Online Course', 'Social Media Content', 'Other'] as const;
export const EDITING_CHOICES = ['yes', 'no', 'maybe'] as const;
export const EDITING_LABELS: Record<(typeof EDITING_CHOICES)[number], string> = { yes: 'Yes', no: 'No', maybe: 'Maybe' };
export const MAX_PEOPLE = 12;
export const MAX_GUESTS = 8;

export interface Intake {
  peopleRecording?: number;
  peopleOnCamera?: number;
  recordingType?: string;
  editing?: (typeof EDITING_CHOICES)[number];
  project?: string;
  guests?: string[];
  /** Guest names, in the same order as `guests` ('' when not given). */
  guestNames?: string[];
  /** Name of the chosen studio setup at booking time (set by the server). */
  setupName?: string;
}

export type IntakeField = 'peopleRecording' | 'peopleOnCamera' | 'recordingType' | 'editing' | 'project' | 'guests';

/** Which questions a service category asks, and which must be answered. */
export function intakeFields(category: string): { ask: IntakeField[]; required: IntakeField[] } {
  if (HOURLY_CATEGORIES.includes(category)) {
    return {
      ask: ['peopleRecording', 'peopleOnCamera', 'recordingType', 'editing', 'project', 'guests'],
      required: ['peopleRecording', 'peopleOnCamera', 'recordingType', 'editing'],
    };
  }
  if (category === 'photography') return { ask: ['peopleRecording', 'project', 'guests'], required: ['peopleRecording'] };
  if (category === 'tour') return { ask: ['peopleRecording'], required: [] };
  return { ask: ['peopleRecording', 'project'], required: [] };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type IntakeResult = { ok: true; intake: Intake } | { ok: false; error: string };

/** Validates the answers for a category; unknown keys are dropped. */
export function parseIntake(raw: unknown, category: string, customerEmail?: string): IntakeResult {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const { ask, required } = intakeFields(category);
  const intake: Intake = {};
  const missing = (field: IntakeField) => required.includes(field);

  const count = (field: 'peopleRecording' | 'peopleOnCamera', label: string): string | null => {
    if (!ask.includes(field)) return null;
    const v = input[field];
    if (v === undefined || v === null || v === '') return missing(field) ? `Please tell us ${label}.` : null;
    const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? parseInt(v, 10) : NaN;
    if (!Number.isInteger(n) || n < (field === 'peopleOnCamera' ? 0 : 1) || n > MAX_PEOPLE) {
      return `${label[0].toUpperCase()}${label.slice(1)} must be a number up to ${MAX_PEOPLE}.`;
    }
    intake[field] = n;
    return null;
  };

  const peopleLabel = category === 'photography' ? 'how many people are in the shoot' : category === 'tour' ? 'how many people are visiting' : 'how many people will be recording';
  const e1 = count('peopleRecording', peopleLabel);
  if (e1) return { ok: false, error: e1 };
  const e2 = count('peopleOnCamera', 'how many people will be on camera');
  if (e2) return { ok: false, error: e2 };
  if (intake.peopleOnCamera !== undefined && intake.peopleRecording !== undefined && intake.peopleOnCamera > intake.peopleRecording) {
    return { ok: false, error: 'People on camera cannot be more than the people recording.' };
  }

  if (ask.includes('recordingType')) {
    const v = typeof input.recordingType === 'string' ? input.recordingType.trim() : '';
    if (!v) {
      if (missing('recordingType')) return { ok: false, error: 'Please tell us what you are recording.' };
    } else if (!(RECORDING_TYPES as readonly string[]).includes(v)) {
      return { ok: false, error: 'Please choose what you are recording from the list.' };
    } else intake.recordingType = v;
  }

  if (ask.includes('editing')) {
    const v = typeof input.editing === 'string' ? input.editing.trim().toLowerCase() : '';
    if (!v) {
      if (missing('editing')) return { ok: false, error: 'Please tell us whether you need editing.' };
    } else if (!(EDITING_CHOICES as readonly string[]).includes(v)) {
      return { ok: false, error: 'Please answer the editing question with Yes, No or Maybe.' };
    } else intake.editing = v as Intake['editing'];
  }

  if (ask.includes('project') && input.project !== undefined && input.project !== null) {
    if (typeof input.project !== 'string' || input.project.length > 2000) return { ok: false, error: 'The project description is too long.' };
    const v = input.project.trim();
    if (v) intake.project = v;
  }

  if (ask.includes('guests') && input.guests !== undefined && input.guests !== null) {
    if (!Array.isArray(input.guests) || input.guests.length > MAX_GUESTS) return { ok: false, error: `You can add up to ${MAX_GUESTS} guests.` };
    // Each guest is an email, or { email, name }.
    const seen = new Map<string, string>();
    const own = customerEmail?.trim().toLowerCase();
    for (const g of input.guests) {
      const rawEmail = typeof g === 'string' ? g : (g as { email?: unknown } | null)?.email;
      const rawName = typeof g === 'string' ? '' : (g as { name?: unknown } | null)?.name;
      if (typeof rawEmail !== 'string' || (rawName !== undefined && rawName !== null && typeof rawName !== 'string')) {
        return { ok: false, error: 'Guest emails must be email addresses.' };
      }
      const email = rawEmail.trim().toLowerCase();
      const name = typeof rawName === 'string' ? rawName.trim().slice(0, 100) : '';
      if (!email) {
        if (name) return { ok: false, error: `Please add an email for guest "${name.slice(0, 60)}".` };
        continue;
      }
      if (email.length > 255 || !EMAIL_RE.test(email)) return { ok: false, error: `"${rawEmail.trim().slice(0, 60)}" is not a valid guest email.` };
      if (email !== own && !seen.has(email)) seen.set(email, name);
    }
    if (seen.size) {
      intake.guests = Array.from(seen.keys());
      if (Array.from(seen.values()).some(Boolean)) intake.guestNames = Array.from(seen.values());
    }
  }

  return { ok: true, intake };
}

/** Human-readable lines for staff (owner email, calendar event, CRM). Never includes guest emails. */
export function intakeSummary(intake: unknown): [string, string][] {
  const i = (intake && typeof intake === 'object' ? intake : {}) as Intake;
  const rows: [string, string][] = [];
  if (i.setupName) rows.push(['Setup', i.setupName]);
  if (i.recordingType) rows.push(['Recording', i.recordingType]);
  if (typeof i.peopleRecording === 'number') rows.push(['People', String(i.peopleRecording)]);
  if (typeof i.peopleOnCamera === 'number') rows.push(['On camera', String(i.peopleOnCamera)]);
  if (i.editing) rows.push(['Editing needed', EDITING_LABELS[i.editing] ?? i.editing]);
  if (Array.isArray(i.guests) && i.guests.length) rows.push(['Guests invited', String(i.guests.length)]);
  if (i.project) rows.push(['Project', i.project]);
  return rows;
}

// ---------------------------------------------------------------------------
// Quote maths (integer cents)
// ---------------------------------------------------------------------------

export interface QuoteLine {
  kind: 'service' | 'addon';
  referenceId: number;
  name: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  /** For add-ons: 'session' or 'hour'. */
  unit?: 'session' | 'hour';
}

export interface Quote {
  lines: QuoteLine[];
  units: number;
  durationMinutes: number;
  subtotal: number;
  taxAmount: number;
  total: number;
  taxRate: number;
  currency: 'USD';
}

export interface AddonPrice {
  id: number;
  name: string;
  price_cents: number;
  unit: 'session' | 'hour';
}

/**
 * Service × hours plus add-ons. Per-hour add-ons are charged for every
 * booked hour (rounded up), per-session add-ons once per quantity.
 */
export function computeQuote(args: {
  service: { id: number; name: string; base_price: string; duration_minutes: number };
  units: number;
  addons: { addon: AddonPrice; quantity: number }[];
  taxRate: number;
}): Quote {
  const base = Math.round(parseFloat(args.service.base_price) * 100);
  const durationMinutes = args.service.duration_minutes * args.units;
  const hours = Math.max(1, Math.ceil(durationMinutes / 60));
  const lines: QuoteLine[] = [
    { kind: 'service', referenceId: args.service.id, name: args.service.name, quantity: args.units, unitPriceCents: base, totalCents: base * args.units },
  ];
  for (const { addon, quantity } of args.addons) {
    const multiplier = addon.unit === 'hour' ? quantity * hours : quantity;
    lines.push({
      kind: 'addon',
      referenceId: addon.id,
      name: addon.name,
      quantity: multiplier,
      unitPriceCents: addon.price_cents,
      totalCents: addon.price_cents * multiplier,
      unit: addon.unit,
    });
  }
  const subtotal = lines.reduce((sum, l) => sum + l.totalCents, 0);
  const taxAmount = Math.round(subtotal * args.taxRate);
  return { lines, units: args.units, durationMinutes, subtotal, taxAmount, total: subtotal + taxAmount, taxRate: args.taxRate, currency: 'USD' };
}

/** Guests as { email, name } pairs (name may be empty). */
export function guestList(intake: unknown): { email: string; name: string }[] {
  const i = (intake && typeof intake === 'object' ? intake : {}) as Intake;
  if (!Array.isArray(i.guests)) return [];
  return i.guests.filter((e) => typeof e === 'string').map((email, idx) => ({ email, name: (Array.isArray(i.guestNames) && typeof i.guestNames[idx] === 'string' ? i.guestNames[idx] : '') || '' }));
}
