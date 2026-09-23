import { DEFAULT_PACKAGE_VALIDITY_DAYS, isPackageType, isServiceCategory, type ServiceCategory } from './catalog';

/**
 * Validates service fields coming from the admin panel. Returns the columns
 * to write, or a user-facing error. With `partial`, only the fields present
 * in the body are validated/returned (PATCH); otherwise name, price and
 * duration are required (POST).
 */

export interface ServiceValues {
  name?: string;
  description?: string | null;
  base_price?: string;
  duration_minutes?: number;
  category?: ServiceCategory;
  features?: string[];
  badge?: string | null;
  is_active?: boolean;
  is_featured?: boolean;
  display_order?: number;
  session_count?: number | null;
  validity_days?: number | null;
  package_type?: string | null;
  package_base_service_id?: number | null;
}

export type ParseResult = { ok: true; values: ServiceValues } | { ok: false; error: string };

const MAX_PRICE = 100000;

function has(body: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined;
}

function toInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return parseInt(value, 10);
  return null;
}

function blankToNull(value: unknown): unknown {
  return value === '' || value === null || value === undefined ? null : value;
}

export function parseServiceInput(
  body: Record<string, unknown>,
  options: { partial: boolean; existingCategory?: string }
): ParseResult {
  const { partial } = options;
  const values: ServiceValues = {};

  if (!partial || has(body, 'name')) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 255) return { ok: false, error: 'Name is required (max 255 characters)' };
    values.name = name;
  }

  if (has(body, 'description')) {
    const d = blankToNull(body.description);
    if (d !== null && (typeof d !== 'string' || d.length > 2000)) {
      return { ok: false, error: 'Description must be text (max 2000 characters)' };
    }
    values.description = d === null ? null : (d as string).trim() || null;
  }

  if (!partial || has(body, 'base_price')) {
    const price = typeof body.base_price === 'number' ? body.base_price : parseFloat(String(body.base_price ?? ''));
    if (!Number.isFinite(price) || price < 0 || price > MAX_PRICE) {
      return { ok: false, error: 'Price must be a number between 0 and 100000' };
    }
    values.base_price = price.toFixed(2);
  }

  if (!partial || has(body, 'duration_minutes')) {
    const duration = toInt(body.duration_minutes);
    if (duration === null || duration < 15 || duration > 720) {
      return { ok: false, error: 'Duration must be a whole number of minutes between 15 and 720' };
    }
    values.duration_minutes = duration;
  }

  if (has(body, 'category') || !partial) {
    const category = body.category ?? 'podcast';
    if (!isServiceCategory(category)) return { ok: false, error: 'Invalid category' };
    values.category = category;
  }

  if (has(body, 'features')) {
    let features = body.features;
    if (typeof features === 'string') {
      features = features
        .split('\n')
        .map((f) => f.trim())
        .filter(Boolean);
    }
    if (!Array.isArray(features) || features.some((f) => typeof f !== 'string')) {
      return { ok: false, error: 'Features must be a list of text lines' };
    }
    const cleaned = (features as string[]).map((f) => f.trim()).filter(Boolean);
    if (cleaned.length > 20 || cleaned.some((f) => f.length > 160)) {
      return { ok: false, error: 'Up to 20 features, each at most 160 characters' };
    }
    values.features = cleaned;
  }

  if (has(body, 'badge')) {
    const badge = blankToNull(typeof body.badge === 'string' ? body.badge.trim() : body.badge);
    if (badge !== null && (typeof badge !== 'string' || badge.length > 40)) {
      return { ok: false, error: 'Badge must be at most 40 characters' };
    }
    values.badge = badge as string | null;
  }

  for (const key of ['is_active', 'is_featured'] as const) {
    if (has(body, key)) {
      if (typeof body[key] !== 'boolean') return { ok: false, error: `${key} must be true or false` };
      values[key] = body[key] as boolean;
    }
  }

  if (has(body, 'display_order')) {
    const order = toInt(body.display_order);
    if (order === null || order < -1000 || order > 10000) return { ok: false, error: 'Display order must be a whole number' };
    values.display_order = order;
  }

  // Package fields: required for packages, cleared for everything else.
  const category = values.category ?? options.existingCategory;
  if (category === 'package') {
    const touchesPackage =
      !partial ||
      values.category !== undefined ||
      ['session_count', 'validity_days', 'package_type', 'package_base_service_id'].some((k) => has(body, k));
    if (touchesPackage) {
      if (!partial || values.category !== undefined || has(body, 'session_count')) {
        const sessions = toInt(body.session_count);
        if (sessions === null || sessions < 1 || sessions > 50) {
          return { ok: false, error: 'Packages need a session count between 1 and 50' };
        }
        values.session_count = sessions;
      }
      if (!partial || values.category !== undefined || has(body, 'validity_days')) {
        const raw = blankToNull(body.validity_days);
        const days = raw === null ? DEFAULT_PACKAGE_VALIDITY_DAYS : toInt(raw);
        if (days === null || days < 1 || days > 365) return { ok: false, error: 'Validity must be between 1 and 365 days' };
        values.validity_days = days;
      }
      if (!partial || values.category !== undefined || has(body, 'package_type')) {
        if (!isPackageType(body.package_type)) return { ok: false, error: 'Choose a package type' };
        values.package_type = body.package_type;
      }
      if (has(body, 'package_base_service_id')) {
        const raw = blankToNull(body.package_base_service_id);
        const id = raw === null ? null : toInt(raw);
        if (raw !== null && (id === null || id < 1)) return { ok: false, error: 'Invalid base service' };
        values.package_base_service_id = id;
      }
    }
  } else if (values.category !== undefined) {
    values.session_count = null;
    values.validity_days = null;
    values.package_type = null;
    values.package_base_service_id = null;
  }

  return { ok: true, values };
}
