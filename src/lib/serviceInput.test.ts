import { describe, it, expect } from 'vitest';
import { parseServiceInput } from './serviceInput';

const valid = { name: 'Headshot Session', base_price: '250', duration_minutes: '45', category: 'photography' };

describe('parseServiceInput (create)', () => {
  it('accepts a photography service and normalises values', () => {
    const r = parseServiceInput({ ...valid, features: 'One look\n\n Online gallery ', badge: '' }, { partial: false });
    expect(r).toEqual({
      ok: true,
      values: expect.objectContaining({
        name: 'Headshot Session',
        base_price: '250.00',
        duration_minutes: 45,
        category: 'photography',
        features: ['One look', 'Online gallery'],
        badge: null,
        session_count: null,
        package_type: null,
      }),
    });
  });

  it.each([
    [{ ...valid, name: '' }, /Name/],
    [{ ...valid, base_price: '-1' }, /Price/],
    [{ ...valid, base_price: 'abc' }, /Price/],
    [{ ...valid, duration_minutes: '10' }, /Duration/],
    [{ ...valid, duration_minutes: '45.5' }, /Duration/],
    [{ ...valid, category: 'spa' }, /category/],
    [{ ...valid, badge: 'x'.repeat(41) }, /Badge/],
    [{ ...valid, is_active: 'yes' }, /is_active/],
  ])('rejects invalid input %#', (body, message) => {
    const r = parseServiceInput(body as any, { partial: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(message);
  });

  it('requires package fields for a package', () => {
    const base = { name: '4 Sessions per Month', base_price: '680', duration_minutes: 60, category: 'package' };
    expect(parseServiceInput(base, { partial: false })).toMatchObject({ ok: false, error: expect.stringMatching(/session count/) });
    expect(parseServiceInput({ ...base, session_count: 4 }, { partial: false })).toMatchObject({ ok: false, error: expect.stringMatching(/package type/) });
    const ok = parseServiceInput({ ...base, session_count: '4', package_type: 'studio_recording', validity_days: '', package_base_service_id: '2' }, { partial: false });
    expect(ok).toMatchObject({ ok: true, values: { session_count: 4, validity_days: 30, package_type: 'studio_recording', package_base_service_id: 2 } });
  });
});

describe('parseServiceInput (update)', () => {
  it('only returns the fields that were sent', () => {
    expect(parseServiceInput({ is_active: false }, { partial: true, existingCategory: 'podcast' })).toEqual({
      ok: true,
      values: { is_active: false },
    });
  });

  it('validates package fields against the existing category', () => {
    expect(parseServiceInput({ validity_days: 400 }, { partial: true, existingCategory: 'package' }).ok).toBe(false);
    expect(parseServiceInput({ validity_days: 45 }, { partial: true, existingCategory: 'package' })).toEqual({
      ok: true,
      values: { validity_days: 45 },
    });
  });

  it('clears package fields when a service stops being a package', () => {
    const r = parseServiceInput({ category: 'podcast' }, { partial: true, existingCategory: 'package' });
    expect(r).toEqual({
      ok: true,
      values: { category: 'podcast', session_count: null, validity_days: null, package_type: null, package_base_service_id: null },
    });
  });
});
