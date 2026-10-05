'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CATEGORY_LABELS, bookingCategories, formatDuration, formatPrice, isBookable, servicesInCategory, type CatalogService } from '@/lib/catalog';
import { addDays, formatTimeLabel, todayInTz } from '@/lib/crm/time';
import { EDITING_CHOICES, EDITING_LABELS, MAX_GUESTS, MAX_PEOPLE, RECORDING_TYPES, intakeFields, parseIntake } from '@/lib/bookingOptions';

interface TimeSlot {
  start: string;
  end: string;
  available: boolean;
}

interface Service {
  id: number;
  name: string;
  description: string | null;
  base_price: string;
  duration_minutes: number;
  is_active: boolean;
  category: string;
  features?: string[] | null;
  badge?: string | null;
  display_order?: number;
  max_hours?: number;
}

interface Addon {
  id: number;
  name: string;
  description: string | null;
  price: string;
  unit: 'session' | 'hour';
  max_quantity: number;
}

interface Pricing {
  subtotal: string;
  taxAmount: string;
  total: string;
  lines?: { kind: 'service' | 'addon'; name: string; quantity: number; unit: string | null; unitPrice: string; total: string }[];
}

function asCatalog(list: Service[]): CatalogService[] {
  return list.map((s) => ({
    features: null,
    badge: null,
    display_order: 0,
    is_featured: false,
    session_count: null,
    validity_days: null,
    package_type: null,
    package_base_service_id: null,
    ...s,
  })) as CatalogService[];
}

// Steps: 1 Service  2 Date  3 Time  4 Details (reserves the slot)  5 Confirm / pay
interface BookingState {
  step: number;
  selectedService: Service | null;
  selectedDate: string | null;
  selectedSlot: { start: string; end: string } | null;
  /** Hours booked (services sold by the hour). */
  hours: number;
  /** Add-on id → quantity. */
  addons: Record<number, number>;
  intake: IntakeState;
  customerInfo: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    company: string;
    notes: string;
  };
  holdId: string | null;
  holdExpiresAt: string | null;
  pricing: Pricing | null;
  loading: boolean;
  error: string | null;
}

interface IntakeState {
  peopleRecording: string;
  peopleOnCamera: string;
  recordingType: string;
  editing: string;
  project: string;
  guests: string[];
}

const emptyIntake: IntakeState = { peopleRecording: '', peopleOnCamera: '', recordingType: '', editing: '', project: '', guests: [] };

const STORAGE_KEY = 'zayro-booking-state-v3';
const STEP_LABELS = ['Service', 'Date', 'Time', 'Extras', 'Details', 'Confirm'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function isValidPhone(phone: string): boolean {
  return /^[\d\s\-().+]+$/.test(phone) && phone.replace(/\D/g, '').length >= 10;
}

/** "Wednesday, October 14, 2026" for a YYYY-MM-DD studio date. */
function longDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function monthEnd(month: string): string {
  const d = new Date(`${month}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return d.toISOString().slice(0, 10);
}

function shiftMonth(month: string, delta: number): string {
  const d = new Date(`${month}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + delta, 1);
  return d.toISOString().slice(0, 10);
}

function money(value: string | number): string {
  const n = typeof value === 'number' ? value : parseFloat(value);
  return `$${n.toFixed(2)}`;
}

function loadPersistedState(): Partial<BookingState> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function persistState(state: BookingState) {
  try {
    const { loading, error, ...toStore } = state;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
  } catch {
    // sessionStorage unavailable (private mode etc.) — booking still works, just no reload recovery.
  }
}

function clearPersistedState() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Gives a hold back in the background (the customer changed their mind). */
function releaseHoldQuietly(holdId: string | null) {
  if (!holdId) return;
  fetch('/api/booking/release-hold', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hold_id: holdId }),
    keepalive: true,
  }).catch(() => undefined);
}

const initialState: BookingState = {
  step: 1,
  selectedService: null,
  selectedDate: null,
  selectedSlot: null,
  hours: 1,
  addons: {},
  intake: emptyIntake,
  customerInfo: { firstName: '', lastName: '', email: '', phone: '', company: '', notes: '' },
  holdId: null,
  holdExpiresAt: null,
  pricing: null,
  loading: false,
  error: null,
};

function ProgressBar({ step, labels }: { step: number; labels: { step: number; label: string }[] }) {
  return (
    <ol className="flex items-center gap-2 mb-8 md:mb-12" aria-label="Booking progress">
      {labels.map(({ step: stepNum, label }, idx) => {
        const isDone = stepNum < step;
        const isCurrent = stepNum === step;
        return (
          <li key={label} className="flex items-center gap-2 flex-1 last:flex-none min-w-0">
            <span
              className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold flex-shrink-0 transition-colors ${
                isDone || isCurrent ? 'bg-gradient-cta text-white' : 'bg-white border border-zayro-border text-zayro-gray'
              }`}
              aria-current={isCurrent ? 'step' : undefined}
            >
              {isDone ? <span aria-hidden="true">✓</span> : idx + 1}
              <span className="sr-only">
                {isDone ? `${label}, done` : isCurrent ? `${label}, current step` : label}
              </span>
            </span>
            <span className={`text-xs font-medium hidden sm:inline ${isCurrent ? 'text-zayro-dark' : 'text-zayro-gray'}`} aria-hidden="true">
              {label}
            </span>
            {idx < labels.length - 1 && <span className="flex-1 h-px bg-zayro-border min-w-[0.5rem]" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}

function StepHeader({
  step,
  labels,
  title,
  subtitle,
  onBack,
}: {
  step: number;
  labels: { step: number; label: string }[];
  title: string;
  subtitle?: string;
  onBack?: () => void;
}) {
  return (
    <>
      <ProgressBar step={step} labels={labels} />
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="mb-6 -ml-1 px-1 py-2 rounded-md text-zayro-primary hover:text-zayro-dark transition-colors text-sm font-semibold"
        >
          <span aria-hidden="true">←</span> Back
        </button>
      )}
      <h1 tabIndex={-1} className="text-4xl md:text-6xl font-black leading-tight tracking-tight mb-3 text-zayro-dark focus:outline-none">
        {title}
      </h1>
      {subtitle && <p className="text-lg text-zayro-gray mb-10">{subtitle}</p>}
    </>
  );
}

export default function BookingFlow() {
  const [state, setState] = useState<BookingState>(initialState);
  const [hydrated, setHydrated] = useState(false);

  const [allServices, setAllServices] = useState<Service[]>([]);
  const [servicesError, setServicesError] = useState<string | null>(null);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [category, setCategory] = useState<string | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);

  const [month, setMonth] = useState<string>(() => monthStart(todayInTz()));
  const [dates, setDates] = useState<{ month: string; available: Set<string>; min: string; max: string } | null>(null);
  const [datesLoading, setDatesLoading] = useState(false);
  const [datesError, setDatesError] = useState<string | null>(null);

  const [addons, setAddons] = useState<Addon[]>([]);
  const [slots, setSlots] = useState<TimeSlot[] | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);

  const deepLinkHandled = useRef(false);
  const headingRef = useRef<HTMLDivElement>(null);

  // Hydrate from sessionStorage once, then re-validate anything time-sensitive.
  useEffect(() => {
    const persisted = loadPersistedState();
    if (!persisted || !persisted.selectedService) {
      setHydrated(true);
      return;
    }
    (async () => {
      let next: Partial<BookingState> = { ...persisted };
      if (persisted.holdId) {
        try {
          const res = await fetch('/api/booking/validate-hold', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hold_id: persisted.holdId }),
          });
          const data = await res.json();
          if (!data.valid) {
            next = {
              ...next,
              step: persisted.selectedDate ? 3 : 2,
              selectedSlot: null,
              holdId: null,
              holdExpiresAt: null,
              pricing: null,
              error: 'Your reserved time ran out while you were away. Please pick a time again.',
            };
          } else if (data.hold_expires_at) {
            next.holdExpiresAt = data.hold_expires_at;
          }
        } catch {
          next = { ...next, step: persisted.selectedDate ? 3 : 2, selectedSlot: null, holdId: null, holdExpiresAt: null, pricing: null };
        }
      }
      if (next.selectedDate) setMonth(monthStart(next.selectedDate));
      setState((s) => ({ ...s, ...next, loading: false }));
      setHydrated(true);
    })();
  }, []);

  // Persist on every change, once hydration has settled.
  useEffect(() => {
    if (hydrated) persistState(state);
  }, [state, hydrated]);

  // Returning with the browser's back button from Stripe restores this page
  // from the back/forward cache with the spinner still on.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setState((s) => ({ ...s, loading: false }));
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch('/api/services');
        if (!response.ok) throw new Error('Failed to load services');
        const data = await response.json();
        setAllServices(Array.isArray(data) ? data : []);
        setServicesError(null);
      } catch {
        setServicesError('Unable to load services right now. Please refresh the page or try again shortly.');
      } finally {
        setServicesLoading(false);
      }
    })();
  }, []);

  // Move keyboard/screen-reader focus to the new step's heading (not on the
  // first render, so opening the page doesn't jump).
  const shownStep = useRef<number | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    if (shownStep.current !== null && shownStep.current !== state.step) {
      headingRef.current?.querySelector('h1')?.focus({ preventScroll: true });
      window.scrollTo({ top: 0 });
    }
    shownStep.current = state.step;
  }, [state.step, hydrated]);

  const selectService = useCallback((service: Service) => {
    setState((s) => {
      releaseHoldQuietly(s.holdId);
      return {
        ...initialState,
        customerInfo: s.customerInfo,
        // Answers carry over when switching between services; extras and hours start fresh.
        intake: s.intake,
        selectedService: service,
        step: 2,
      };
    });
    setSlots(null);
    setDates(null);
  }, []);

  // Deep links from the pricing page: /booking?service=ID preselects that
  // service (and jumps to the date step); /booking?category=photography
  // opens that category tab. Applied once, after hydration and services load.
  useEffect(() => {
    if (!hydrated || servicesLoading || deepLinkHandled.current) return;
    deepLinkHandled.current = true;
    let params: URLSearchParams;
    try {
      params = new URLSearchParams(window.location.search);
    } catch {
      return;
    }
    const serviceParam = params.get('service');
    const categoryParam = params.get('category');
    if (!serviceParam && !categoryParam) return;

    const target = serviceParam ? allServices.find((s) => String(s.id) === serviceParam) : undefined;
    if (target && isBookable(target)) {
      setCategory(target.category);
      if (state.selectedService?.id !== target.id || state.step === 1) selectService(target);
    } else if (categoryParam) {
      setCategory(categoryParam);
    }
    try {
      window.history.replaceState(null, '', window.location.pathname);
    } catch {
      // ignore
    }
  }, [hydrated, servicesLoading, allServices, state.selectedService, state.step, selectService]);

  // Dates with free time in the visible month (studio time, ET).
  const serviceId = state.selectedService?.id;
  const maxHours = Math.max(1, state.selectedService?.max_hours ?? 1);
  const hours = Math.min(Math.max(1, state.hours || 1), maxHours);
  const totalMinutes = (state.selectedService?.duration_minutes ?? 0) * hours;
  const sessionLength = formatDuration(totalMinutes);
  const hasExtras = addons.length > 0;
  const labels = STEP_LABELS.map((label, i) => ({ step: i + 1, label })).filter((l) => l.label !== 'Extras' || hasExtras);

  // Extras offered with the chosen service (current prices from the server).
  useEffect(() => {
    if (!serviceId) {
      setAddons([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/booking/addons?service_id=${serviceId}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (!cancelled) setAddons(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setAddons([]);
      });
    return () => {
      cancelled = true;
    };
  }, [serviceId]);

  useEffect(() => {
    if (state.step !== 2 || !serviceId) return;
    let cancelled = false;
    const today = todayInTz();
    const from = month < monthStart(today) ? today : month > today ? month : today;
    const to = monthEnd(month);
    setDatesLoading(true);
    setDatesError(null);
    fetch(`/api/booking/available-dates?service_id=${serviceId}&from_date=${from}&to_date=${to}&hours=${hours}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not load dates');
        if (!cancelled) setDates({ month, available: new Set(data.available_dates), min: data.min_date, max: data.max_date });
      })
      .catch((err: Error) => {
        if (!cancelled) setDatesError(err.message || 'Could not load available dates. Please try again.');
      })
      .finally(() => {
        if (!cancelled) setDatesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [state.step, serviceId, month, hours]);

  const loadSlots = useCallback(async (service: Service, date: string, hrs: number) => {
    setSlotsLoading(true);
    setSlotsError(null);
    try {
      const res = await fetch(`/api/booking/available-times?service_id=${service.id}&date=${date}&hours=${hrs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load times');
      setSlots((data.time_slots as TimeSlot[]).filter((s) => s.available));
    } catch (err) {
      setSlots(null);
      setSlotsError((err as Error).message || 'Could not load available times. Please try again.');
    } finally {
      setSlotsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (state.step === 3 && state.selectedService && state.selectedDate) loadSlots(state.selectedService, state.selectedDate, hours);
  }, [state.step, state.selectedService, state.selectedDate, hours, loadSlots]);

  // Hold countdown — ticks every second while a hold is active.
  useEffect(() => {
    if (!state.holdExpiresAt) {
      setSecondsRemaining(null);
      return;
    }
    const expiresAt = new Date(state.holdExpiresAt).getTime();
    const tick = () => setSecondsRemaining(Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [state.holdExpiresAt]);

  const holdExpired = secondsRemaining !== null && secondsRemaining <= 0;

  const goTo = (step: number, extra: Partial<BookingState> = {}) => setState((s) => ({ ...s, step, error: null, ...extra }));

  const selectDate = (date: string) => goTo(3, { selectedDate: date, selectedSlot: null });

  const selectSlot = (slot: TimeSlot) => goTo(hasExtras ? 4 : 5, { selectedSlot: { start: slot.start, end: slot.end } });

  const updateCustomerInfo = (field: keyof BookingState['customerInfo'], value: string) => {
    setState((s) => ({ ...s, customerInfo: { ...s.customerInfo, [field]: value } }));
  };

  const validateCustomerInfo = (): string | null => {
    const { firstName, lastName, email, phone } = state.customerInfo;
    if (!firstName.trim() || !lastName.trim()) return 'Please enter your first and last name.';
    if (!isValidEmail(email)) return 'Please enter a valid email address.';
    if (!isValidPhone(phone)) return 'Please enter a valid phone number (at least 10 digits).';
    const answers = parseIntake(intakePayload(), state.selectedService?.category ?? '', email);
    if (!answers.ok) return answers.error;
    return null;
  };

  const intakePayload = () => ({
    peopleRecording: state.intake.peopleRecording,
    peopleOnCamera: state.intake.peopleOnCamera,
    recordingType: state.intake.recordingType,
    editing: state.intake.editing,
    project: state.intake.project,
    guests: state.intake.guests.map((g) => g.trim()).filter(Boolean),
  });

  const updateIntake = <K extends keyof IntakeState>(field: K, value: IntakeState[K]) => {
    setState((s) => ({ ...s, intake: { ...s.intake, [field]: value } }));
  };

  const setAddonQuantity = (id: number, quantity: number) => {
    setState((s) => {
      const next = { ...s.addons };
      if (quantity > 0) next[id] = quantity;
      else delete next[id];
      return { ...s, addons: next };
    });
  };

  const chosenAddons = addons.filter((a) => (state.addons[a.id] ?? 0) > 0).map((a) => ({ id: a.id, quantity: Math.min(state.addons[a.id], a.max_quantity) }));

  /** Details submitted: reserve the slot for this customer, then show the summary. */
  const reserveSlot = async () => {
    const validationError = validateCustomerInfo();
    if (validationError) {
      setState((s) => ({ ...s, error: validationError }));
      return;
    }
    const service = state.selectedService!;
    const slot = state.selectedSlot!;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const response = await fetch('/api/booking/create-hold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_email: state.customerInfo.email.trim(),
          service_id: service.id,
          booking_date: state.selectedDate,
          start_time: slot.start,
          end_time: slot.end,
          duration_minutes: service.duration_minutes * hours,
          hours,
          addons: chosenAddons,
          previous_hold_id: state.holdId,
          website: (document.getElementById('website') as HTMLInputElement | null)?.value || undefined,
        }),
      });
      const data = await response.json();
      if (response.status === 409) {
        setState((s) => ({
          ...s,
          loading: false,
          step: 3,
          selectedSlot: null,
          holdId: null,
          holdExpiresAt: null,
          error: 'Sorry, that time was just taken. Please choose another time.',
        }));
        return;
      }
      if (!response.ok) throw new Error(data.error || 'We could not reserve that time. Please try again.');
      setState((s) => ({
        ...s,
        loading: false,
        step: 6,
        holdId: data.hold_id,
        holdExpiresAt: data.hold_expires_at,
        pricing: data.pricing,
      }));
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: (err as Error).message }));
    }
  };

  /** From the summary back to details: the reserved slot is given back. */
  const backFromSummary = () => {
    releaseHoldQuietly(state.holdId);
    goTo(5, { holdId: null, holdExpiresAt: null, pricing: null });
  };

  const holdRanOut = () => {
    releaseHoldQuietly(state.holdId);
    goTo(3, { selectedSlot: null, holdId: null, holdExpiresAt: null, pricing: null, error: 'Your reserved time ran out. Please pick a time again.' });
  };

  const confirmOrPay = async () => {
    if (holdExpired) return holdRanOut();
    setState((s) => ({ ...s, loading: true, error: null }));
    const payload = {
      holdId: state.holdId,
      firstName: state.customerInfo.firstName.trim(),
      lastName: state.customerInfo.lastName.trim(),
      email: state.customerInfo.email.trim(),
      phone: state.customerInfo.phone.trim(),
      company: state.customerInfo.company.trim(),
      notes: state.customerInfo.notes.trim(),
      intake: intakePayload(),
    };
    try {
      // The server decides whether this is free (its own price, never ours).
      if (state.pricing && parseFloat(state.pricing.total) <= 0) {
        const res = await fetch('/api/booking/confirm-free', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (res.ok && data.bookingId) {
          clearPersistedState();
          window.location.assign(`/booking/success?booking_id=${encodeURIComponent(data.bookingId)}`);
          return;
        }
        if (res.status === 410 || res.status === 409) return holdRanOut();
        if (!data.requiresPayment) throw new Error(data.error || 'We could not confirm your booking. Please try again.');
      }

      const res = await fetch('/api/payment/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.status === 410) return holdRanOut();
      if (data.alreadyPaid && data.sessionId) {
        clearPersistedState();
        window.location.assign(`/booking/success?session_id=${encodeURIComponent(data.sessionId)}`);
        return;
      }
      if (!res.ok || !data.checkoutUrl) throw new Error(data.error || 'We could not start the payment. Please try again.');
      // Stripe Checkout carries everything the webhook needs to confirm the
      // booking on the server; keep the local state so "back" still works.
      window.location.assign(data.checkoutUrl);
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: (err as Error).message }));
    }
  };

  if (!hydrated) {
    return (
      <div className="container py-16 md:py-24" aria-busy="true">
        <div className="skeleton h-12 w-2/3 mb-4" />
        <div className="skeleton h-6 w-1/3 mb-16" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="skeleton h-56" />
          <div className="skeleton h-56" />
        </div>
      </div>
    );
  }

  const service = state.selectedService;
  const summaryLine = service
    ? [service.name, sessionLength, state.selectedDate && longDate(state.selectedDate), state.selectedSlot && `${formatTimeLabel(state.selectedSlot.start)} ET`]
        .filter(Boolean)
        .join(' · ')
    : '';

  let content: React.ReactNode = null;

  // ------------------------------------------------------------------ 1
  if (state.step === 1) {
    const catalog = asCatalog(allServices);
    const categories = bookingCategories(catalog);
    const activeCategory =
      (category && categories.includes(category as any) && category) ||
      (state.selectedService && categories.includes(state.selectedService.category as any) && state.selectedService.category) ||
      categories[0] ||
      null;
    const visible = activeCategory ? servicesInCategory(catalog, activeCategory).filter(isBookable) : [];

    content = (
      <>
        <StepHeader step={1} labels={labels} title="Book the studio" subtitle="Choose what you're booking, then pick the session that fits." />

        {servicesLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6" aria-busy="true" aria-label="Loading services">
            <div className="skeleton h-56" />
            <div className="skeleton h-56" />
          </div>
        )}
        {servicesError && (
          <div className="form-error-banner mb-8" role="alert">
            {servicesError}
          </div>
        )}
        {!servicesLoading && !servicesError && categories.length === 0 && (
          <p className="text-zayro-gray">No services are available for booking right now. Please contact us directly.</p>
        )}

        {categories.length > 1 && (
          <div role="group" aria-label="Service category" className="flex flex-wrap gap-3 mb-8">
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                aria-pressed={c === activeCategory}
                className={`button text-base py-2.5 px-5 ${c === activeCategory ? 'button-primary' : 'button-secondary'}`}
              >
                {CATEGORY_LABELS[c]}
              </button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {visible.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => selectService(allServices.find((x) => x.id === s.id)!)}
              className="card card-interactive text-left h-full flex flex-col items-stretch justify-start min-w-0"
            >
              {s.badge && (
                <span className="self-start mb-3 rounded-full bg-gradient-cta px-3 py-1 text-sm font-semibold text-white">{s.badge}</span>
              )}
              <span className="block text-2xl font-black mb-2 text-zayro-dark break-words">{s.name}</span>
              {s.description && <span className="block text-base text-zayro-gray mb-4">{s.description}</span>}
              {s.features && s.features.length > 0 && (
                <span className="block mb-6">
                  {s.features.slice(0, 4).map((f) => (
                    <span key={f} className="flex gap-2 text-sm text-zayro-gray min-w-0">
                      <span className="text-zayro-primary flex-shrink-0" aria-hidden="true">
                        ✓
                      </span>
                      <span className="min-w-0 break-words">{f}</span>
                    </span>
                  ))}
                </span>
              )}
              <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mt-auto">
                <span className="text-4xl font-black text-zayro-dark">{formatPrice(s.base_price)}</span>
                <span className="text-base text-zayro-gray">{formatDuration(s.duration_minutes)}</span>
              </span>
            </button>
          ))}
        </div>

        <p className="text-base text-zayro-gray mt-10">
          Looking for monthly podcast packages? They&apos;re prepaid and arranged by request —{' '}
          <Link href="/pricing#monthly" className="text-zayro-primary font-semibold hover:underline">
            see Monthly Packages
          </Link>
          .
        </p>
      </>
    );
  }

  // ------------------------------------------------------------------ 2
  if (state.step === 2 && service) {
    const today = todayInTz();
    const first = new Date(`${month}T12:00:00Z`);
    const leading = first.getUTCDay();
    const last = monthEnd(month);
    const days: string[] = [];
    for (let d = month; d <= last; d = addDays(d, 1)) days.push(d);
    const loaded = dates?.month === month ? dates : null;
    const maxDate = loaded?.max ?? addDays(today, 90);
    const canPrev = month > monthStart(today);
    const canNext = monthEnd(month) < maxDate;
    const monthLabel = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const noneThisMonth = loaded && !datesLoading && loaded.available.size === 0;

    content = (
      <>
        <StepHeader step={2} labels={labels} title={maxHours > 1 ? 'Session length and date' : 'Pick a date'} subtitle={`${service.name} · ${sessionLength}`} onBack={() => goTo(1)} />
        {maxHours > 1 && (
          <fieldset className="mb-8 max-w-xl">
            <legend className="field-label mb-3">Session duration</legend>
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: maxHours }, (_, i) => i + 1).map((h) => (
                <button
                  key={h}
                  type="button"
                  aria-pressed={state.hours === h}
                  onClick={() => setState((st) => ({ ...st, hours: h, selectedSlot: null }))}
                  className={`min-w-[3.25rem] rounded-full border-2 border-solid px-4 py-2 text-sm font-semibold transition-colors ${
                    state.hours === h ? 'border-zayro-primary bg-zayro-primary text-white' : 'border-zayro-border bg-white text-zayro-dark hover:border-zayro-primary'
                  }`}
                >
                  {h} h
                </button>
              ))}
            </div>
            <p className="text-sm text-zayro-gray mt-3">
              {formatPrice(service.base_price)} per hour · {state.hours} hour{state.hours === 1 ? '' : 's'} ={' '}
              <span className="font-semibold text-zayro-dark">{money(parseFloat(service.base_price) * state.hours)}</span>
              {' '}before extras
            </p>
          </fieldset>
        )}
        <div className="card max-w-xl !p-5 md:!p-8">
          <div className="flex items-center justify-between gap-3 mb-5">
            <button
              type="button"
              onClick={() => setMonth(shiftMonth(month, -1))}
              disabled={!canPrev}
              className="button button-secondary !px-4 !py-2 disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Previous month"
            >
              <span aria-hidden="true">←</span>
            </button>
            <h2 className="text-lg font-bold text-zayro-dark" aria-live="polite">
              {monthLabel}
            </h2>
            <button
              type="button"
              onClick={() => setMonth(shiftMonth(month, 1))}
              disabled={!canNext}
              className="button button-secondary !px-4 !py-2 disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Next month"
            >
              <span aria-hidden="true">→</span>
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-zayro-gray mb-2" aria-hidden="true">
            {WEEKDAYS.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1" aria-busy={datesLoading} aria-label={`Available dates in ${monthLabel}`} role="group">
            {Array.from({ length: leading }).map((_, i) => (
              <span key={`pad-${i}`} aria-hidden="true" />
            ))}
            {days.map((d) => {
              const open = !!loaded?.available.has(d);
              const selected = d === state.selectedDate;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => selectDate(d)}
                  disabled={!open}
                  aria-pressed={selected}
                  aria-label={`${longDate(d)}${open ? '' : ', unavailable'}`}
                  className={`aspect-square min-h-[2.5rem] p-0 rounded-xl text-sm md:text-base font-semibold transition-colors ${
                    selected
                      ? 'bg-gradient-cta text-white shadow-glow'
                      : open
                        ? 'bg-zayro-bg text-zayro-dark hover:bg-white hover:ring-2 hover:ring-zayro-primary'
                        : 'text-zayro-gray/40 cursor-not-allowed'
                  } ${d === today && !selected ? 'ring-1 ring-zayro-border' : ''}`}
                >
                  {Number(d.slice(8))}
                </button>
              );
            })}
          </div>

          {datesLoading && (
            <p className="text-sm text-zayro-gray mt-4" role="status">
              Checking availability…
            </p>
          )}
          {datesError && (
            <p className="field-error mt-4" role="alert">
              {datesError}
            </p>
          )}
          {noneThisMonth && (
            <p className="text-sm text-zayro-gray mt-4" role="status">
              No open dates left this month{canNext ? ' — try the next month.' : '.'}
            </p>
          )}
          <p className="text-xs text-zayro-gray mt-5">All times are New York time (ET).</p>
        </div>
      </>
    );
  }

  // ------------------------------------------------------------------ 3
  if (state.step === 3 && service && state.selectedDate) {
    content = (
      <>
        <StepHeader step={3} labels={labels} title="Pick a time" subtitle={`${service.name} · ${sessionLength} · ${longDate(state.selectedDate)}`} onBack={() => goTo(2)} />
        {state.error && (
          <p className="form-error-banner mb-8" role="alert">
            {state.error}
          </p>
        )}
        {slotsLoading && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3" aria-busy="true" aria-label="Loading available times">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="skeleton h-16" />
            ))}
          </div>
        )}
        {slotsError && (
          <div className="form-error-banner mb-6" role="alert">
            {slotsError}{' '}
            <button type="button" className="p-0 underline font-semibold" onClick={() => loadSlots(service, state.selectedDate!, hours)}>
              Try again
            </button>
          </div>
        )}
        {!slotsLoading && slots && slots.length === 0 && (
          <p className="text-zayro-gray mb-8">
            Every time on this date has just been taken.{' '}
            <button type="button" className="p-0 text-zayro-primary font-semibold underline" onClick={() => goTo(2)}>
              Choose another date
            </button>
          </p>
        )}
        {!slotsLoading && slots && slots.length > 0 && (
          <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3" aria-label="Available start times">
            {slots.map((slot) => (
              <li key={slot.start}>
                <button
                  type="button"
                  onClick={() => selectSlot(slot)}
                  aria-label={`${formatTimeLabel(slot.start)} to ${formatTimeLabel(slot.end)} Eastern Time`}
                  className={`w-full p-3 rounded-md-plus border-2 border-solid transition-all text-center bg-white hover:border-zayro-primary hover:shadow-soft ${
                    state.selectedSlot?.start === slot.start ? 'border-zayro-primary' : 'border-zayro-border'
                  }`}
                >
                  <span className="block font-bold text-base text-zayro-dark">{formatTimeLabel(slot.start)}</span>
                  <span className="block text-xs text-zayro-gray">until {formatTimeLabel(slot.end)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-zayro-gray mt-6">Times are New York time (ET).</p>
      </>
    );
  }

  // ------------------------------------------------------------------ 4
  if (state.step === 4 && service && state.selectedSlot) {
    const hourCount = Math.max(1, Math.ceil(totalMinutes / 60));
    const extrasTotal = addons.reduce((sum, a) => {
      const q = state.addons[a.id] ?? 0;
      return sum + parseFloat(a.price) * q * (a.unit === 'hour' ? hourCount : 1);
    }, 0);
    content = (
      <>
        <StepHeader step={4} labels={labels} title="Add extras" subtitle={summaryLine} onBack={() => goTo(3)} />
        <p className="text-zayro-gray mb-6 max-w-2xl">Optional. Add anything you need for your session — you can also continue without extras.</p>
        <ul className="grid grid-cols-1 lg:grid-cols-2 gap-3 max-w-4xl mb-8">
          {addons.map((a) => {
            const q = state.addons[a.id] ?? 0;
            return (
              <li
                key={a.id}
                className={`flex items-center justify-between gap-4 rounded-md-plus border-2 bg-white px-4 py-4 transition-colors ${
                  q > 0 ? 'border-zayro-primary' : 'border-zayro-border'
                }`}
              >
                <div className="min-w-0">
                  <p className="font-bold text-zayro-dark break-words">{a.name}</p>
                  {a.description && <p className="text-sm text-zayro-gray">{a.description}</p>}
                  <p className="text-sm font-semibold text-zayro-dark mt-1">
                    {money(a.price)} <span className="font-normal text-zayro-gray">/ {a.unit === 'hour' ? 'hour' : 'session'}</span>
                  </p>
                </div>
                {a.max_quantity > 1 ? (
                  <div className="flex items-center gap-2 flex-shrink-0" role="group" aria-label={`${a.name} quantity`}>
                    <button
                      type="button"
                      className="w-10 h-10 p-0 rounded-full border border-solid border-zayro-border bg-white text-lg font-bold text-zayro-dark disabled:opacity-40"
                      onClick={() => setAddonQuantity(a.id, q - 1)}
                      disabled={q === 0}
                      aria-label={`Remove one ${a.name}`}
                    >
                      −
                    </button>
                    <span className="w-6 text-center font-bold text-zayro-dark" aria-live="polite">
                      {q}
                    </span>
                    <button
                      type="button"
                      className="w-10 h-10 p-0 rounded-full border border-solid border-zayro-border bg-white text-lg font-bold text-zayro-dark disabled:opacity-40"
                      onClick={() => setAddonQuantity(a.id, q + 1)}
                      disabled={q >= a.max_quantity}
                      aria-label={`Add one ${a.name}`}
                    >
                      +
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    aria-pressed={q > 0}
                    onClick={() => setAddonQuantity(a.id, q > 0 ? 0 : 1)}
                    className={`flex-shrink-0 rounded-full border-2 border-solid px-4 py-2 text-sm font-semibold transition-colors ${
                      q > 0 ? 'border-zayro-primary bg-zayro-primary text-white' : 'border-zayro-border bg-white text-zayro-dark hover:border-zayro-primary'
                    }`}
                  >
                    {q > 0 ? 'Added' : 'Add'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 max-w-4xl">
          <button type="button" className="button button-primary text-base px-8 py-4" onClick={() => goTo(5)}>
            {extrasTotal > 0 ? 'Continue' : 'Continue without extras'}
          </button>
          <p className="text-sm text-zayro-gray" aria-live="polite">
            Session {money(parseFloat(service.base_price) * hours)}
            {extrasTotal > 0 ? ` + extras ${money(extrasTotal)}` : ''}. Tax, if any, is added on the next step.
          </p>
        </div>
      </>
    );
  }

  // ------------------------------------------------------------------ 5 (details)
  if (state.step === 5 && service && state.selectedSlot) {
    const { ask, required } = intakeFields(service.category);
    content = (
      <>
        <StepHeader step={5} labels={labels} title="Your details" subtitle={summaryLine} onBack={() => goTo(hasExtras ? 4 : 3)} />
        <form
          className="card max-w-2xl space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            reserveSlot();
          }}
          noValidate
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="firstName" className="field-label">
                First name
              </label>
              <input
                id="firstName"
                type="text"
                autoComplete="given-name"
                maxLength={100}
                value={state.customerInfo.firstName}
                onChange={(e) => updateCustomerInfo('firstName', e.target.value)}
                required
              />
            </div>
            <div>
              <label htmlFor="lastName" className="field-label">
                Last name
              </label>
              <input
                id="lastName"
                type="text"
                autoComplete="family-name"
                maxLength={100}
                value={state.customerInfo.lastName}
                onChange={(e) => updateCustomerInfo('lastName', e.target.value)}
                required
              />
            </div>
          </div>
          <div>
            <label htmlFor="email" className="field-label">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              maxLength={255}
              value={state.customerInfo.email}
              onChange={(e) => updateCustomerInfo('email', e.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="phone" className="field-label">
              Phone
            </label>
            <input
              id="phone"
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              maxLength={20}
              value={state.customerInfo.phone}
              onChange={(e) => updateCustomerInfo('phone', e.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="company" className="field-label">
              Company / show name (optional)
            </label>
            <input
              id="company"
              type="text"
              autoComplete="organization"
              maxLength={255}
              value={state.customerInfo.company}
              onChange={(e) => updateCustomerInfo('company', e.target.value)}
            />
          </div>
          {ask.includes('peopleRecording') && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label htmlFor="peopleRecording" className="field-label">
                  {service.category === 'photography'
                    ? 'How many people are in the shoot?'
                    : service.category === 'tour'
                      ? 'How many people are visiting?'
                      : 'How many people will be recording?'}
                  {required.includes('peopleRecording') ? ' *' : ' (optional)'}
                </label>
                <select
                  id="peopleRecording"
                  value={state.intake.peopleRecording}
                  onChange={(e) => updateIntake('peopleRecording', e.target.value)}
                  required={required.includes('peopleRecording')}
                >
                  <option value="">Select…</option>
                  {Array.from({ length: MAX_PEOPLE }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              {ask.includes('peopleOnCamera') && (
                <div>
                  <label htmlFor="peopleOnCamera" className="field-label">
                    How many people will be on camera?{required.includes('peopleOnCamera') ? ' *' : ''}
                  </label>
                  <select
                    id="peopleOnCamera"
                    value={state.intake.peopleOnCamera}
                    onChange={(e) => updateIntake('peopleOnCamera', e.target.value)}
                    required={required.includes('peopleOnCamera')}
                  >
                    <option value="">Select…</option>
                    {Array.from({ length: MAX_PEOPLE + 1 }, (_, i) => i).map((n) => (
                      <option key={n} value={n}>
                        {n === 0 ? '0 (audio only)' : n}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {ask.includes('recordingType') && (
            <fieldset>
              <legend className="field-label">What are you recording?{required.includes('recordingType') ? ' *' : ''}</legend>
              <div className="flex flex-wrap gap-2 mt-2">
                {RECORDING_TYPES.map((t) => (
                  <label
                    key={t}
                    className={`cursor-pointer rounded-full border-2 border-solid px-4 py-2 text-sm font-semibold transition-colors focus-within:ring-2 focus-within:ring-zayro-primary ${
                      state.intake.recordingType === t ? 'border-zayro-primary bg-zayro-primary text-white' : 'border-zayro-border bg-white text-zayro-dark'
                    }`}
                  >
                    <input
                      type="radio"
                      name="recordingType"
                      value={t}
                      checked={state.intake.recordingType === t}
                      onChange={() => updateIntake('recordingType', t)}
                      className="sr-only"
                    />
                    {t}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {ask.includes('editing') && (
            <fieldset>
              <legend className="field-label">Do you need editing services?{required.includes('editing') ? ' *' : ''}</legend>
              <div className="flex flex-wrap gap-2 mt-2">
                {EDITING_CHOICES.map((c) => (
                  <label
                    key={c}
                    className={`cursor-pointer rounded-full border-2 border-solid px-5 py-2 text-sm font-semibold transition-colors focus-within:ring-2 focus-within:ring-zayro-primary ${
                      state.intake.editing === c ? 'border-zayro-primary bg-zayro-primary text-white' : 'border-zayro-border bg-white text-zayro-dark'
                    }`}
                  >
                    <input
                      type="radio"
                      name="editing"
                      value={c}
                      checked={state.intake.editing === c}
                      onChange={() => updateIntake('editing', c)}
                      className="sr-only"
                    />
                    {EDITING_LABELS[c]}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {ask.includes('project') ? (
            <div>
              <label htmlFor="project" className="field-label">
                Tell us about your project (optional)
              </label>
              <textarea
                id="project"
                maxLength={2000}
                value={state.intake.project}
                onChange={(e) => updateIntake('project', e.target.value)}
                className="h-28"
              />
            </div>
          ) : (
            <div>
              <label htmlFor="notes" className="field-label">
                Notes for the studio (optional)
              </label>
              <textarea
                id="notes"
                maxLength={2000}
                value={state.customerInfo.notes}
                onChange={(e) => updateCustomerInfo('notes', e.target.value)}
                className="h-28"
              />
            </div>
          )}

          {ask.includes('guests') && (
            <fieldset>
              <legend className="field-label">Guests (optional)</legend>
              <p className="text-sm text-zayro-gray mb-3">
                Add your guests&apos; emails and we&apos;ll send them the date, time, address and a calendar file once your booking is confirmed.
              </p>
              <div className="space-y-2">
                {state.intake.guests.map((g, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      type="email"
                      inputMode="email"
                      autoComplete="off"
                      maxLength={255}
                      aria-label={`Guest ${i + 1} email`}
                      placeholder="guest@example.com"
                      value={g}
                      onChange={(e) => updateIntake('guests', state.intake.guests.map((x, j) => (j === i ? e.target.value : x)))}
                    />
                    <button
                      type="button"
                      className="flex-shrink-0 w-11 h-11 p-0 rounded-full border border-solid border-zayro-border bg-white text-zayro-dark"
                      aria-label={`Remove guest ${i + 1}`}
                      onClick={() => updateIntake('guests', state.intake.guests.filter((_, j) => j !== i))}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              {state.intake.guests.length < MAX_GUESTS && (
                <button
                  type="button"
                  className="mt-3 rounded-full border-2 border-solid border-zayro-border bg-white px-4 py-2 text-sm font-semibold text-zayro-dark hover:border-zayro-primary"
                  onClick={() => updateIntake('guests', [...state.intake.guests, ''])}
                >
                  + Add guest
                </button>
              )}
            </fieldset>
          )}
          {/* Honeypot: hidden from people, filled in by bots. */}
          <div className="hidden" aria-hidden="true">
            <label htmlFor="website">Website</label>
            <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
          </div>
          {state.error && (
            <p className="field-error" role="alert">
              {state.error}
            </p>
          )}
          <button
            type="submit"
            disabled={state.loading}
            className={`button button-primary w-full text-base py-4 ${state.loading ? 'is-loading' : ''}`}
          >
            Continue
          </button>
          <p className="text-xs text-zayro-gray">Your time is reserved for you once you continue.</p>
        </form>
      </>
    );
  }

  // ------------------------------------------------------------------ 5
  if (state.step === 6 && service && state.selectedSlot && state.selectedDate) {
    const pricing = state.pricing;
    const isFree = !!pricing && parseFloat(pricing.total) <= 0;
    const hasTax = !!pricing && parseFloat(pricing.taxAmount) > 0;

    content = (
      <>
        <StepHeader step={6} labels={labels} title={isFree ? 'Confirm your booking' : 'Review and pay'} onBack={backFromSummary} />

        {secondsRemaining !== null && !holdExpired && (
          <p className="chip mb-8" role="status" aria-live="off">
            <span className="chip-dot" aria-hidden="true" />
            Time reserved for {Math.floor(secondsRemaining / 60)}:{String(secondsRemaining % 60).padStart(2, '0')}
          </p>
        )}
        {holdExpired && (
          <div className="form-error-banner mb-8" role="alert">
            Your reserved time ran out.{' '}
            <button type="button" className="p-0 underline font-bold" onClick={holdRanOut}>
              Choose a time again
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8 mb-12">
          <dl className="card lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="sm:col-span-2">
              <dt className="text-xs font-bold text-zayro-gray uppercase tracking-wide mb-1">Service</dt>
              <dd className="text-2xl font-black text-zayro-dark">{service.name}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold text-zayro-gray uppercase tracking-wide mb-1">Date</dt>
              <dd className="text-lg font-bold text-zayro-dark">{longDate(state.selectedDate)}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold text-zayro-gray uppercase tracking-wide mb-1">Time (ET)</dt>
              <dd className="text-lg font-bold text-zayro-dark">
                {formatTimeLabel(state.selectedSlot.start)} – {formatTimeLabel(state.selectedSlot.end)}
                <span className="block text-sm font-normal text-zayro-gray">{sessionLength}</span>
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs font-bold text-zayro-gray uppercase tracking-wide mb-1">Contact</dt>
              <dd className="text-zayro-dark break-words">
                <span className="block font-bold">
                  {state.customerInfo.firstName} {state.customerInfo.lastName}
                </span>
                <span className="block text-zayro-gray">{state.customerInfo.email}</span>
                <span className="block text-zayro-gray">{state.customerInfo.phone}</span>
                {state.customerInfo.company && <span className="block text-zayro-gray">{state.customerInfo.company}</span>}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs font-bold text-zayro-gray uppercase tracking-wide mb-1">Location</dt>
              <dd className="text-zayro-dark">40 W 37th St, Suite 603, New York, NY 10018</dd>
            </div>
          </dl>

          <div className="card h-fit">
            <h2 className="text-xs font-bold text-zayro-gray uppercase tracking-wide mb-5">{isFree ? 'Price' : 'Payment'}</h2>
            {pricing && !isFree && (
              <dl className="space-y-3 border-b border-zayro-border pb-5 mb-5 text-sm">
                {(pricing.lines ?? []).length > 1 &&
                  pricing.lines!.map((l, i) => (
                    <div key={i} className="flex justify-between gap-3">
                      <dt className="text-zayro-gray min-w-0 break-words">
                        {l.name}
                        {l.quantity > 1 ? ` × ${l.quantity}` : ''}
                      </dt>
                      <dd className="font-semibold text-zayro-dark flex-shrink-0">{money(l.total)}</dd>
                    </div>
                  ))}
                <div className="flex justify-between">
                  <dt className="text-zayro-gray">Subtotal</dt>
                  <dd className="font-semibold text-zayro-dark">{money(pricing.subtotal)}</dd>
                </div>
                {hasTax && (
                  <div className="flex justify-between">
                    <dt className="text-zayro-gray">Sales tax</dt>
                    <dd className="font-semibold text-zayro-dark">{money(pricing.taxAmount)}</dd>
                  </div>
                )}
              </dl>
            )}
            <div className="flex justify-between items-baseline text-2xl font-black mb-6">
              <span className="text-zayro-dark">Total</span>
              <span className="text-zayro-primary">{isFree ? 'Free' : pricing ? money(pricing.total) : '—'}</span>
            </div>

            <button
              type="button"
              onClick={confirmOrPay}
              disabled={state.loading || holdExpired || !pricing}
              className={`button button-primary w-full py-4 text-base ${state.loading ? 'is-loading' : ''}`}
            >
              {isFree ? 'Confirm booking' : `Pay ${pricing ? money(pricing.total) : ''} securely`}
            </button>

            {state.error && (
              <p className="field-error mt-4" role="alert">
                {state.error}
              </p>
            )}
            <p className="text-xs text-zayro-gray mt-4">
              {isFree
                ? 'No payment needed. You’ll get a confirmation email right away.'
                : 'You’ll pay on Stripe’s secure checkout page. Your booking is confirmed as soon as the payment goes through.'}
            </p>
          </div>
        </div>
      </>
    );
  }

  if (!content) {
    // A step whose inputs are missing (e.g. after a partial restore): start over.
    content = (
      <div className="card max-w-xl">
        <p className="text-zayro-gray mb-6">Something in this booking is missing. Let&apos;s start again.</p>
        <button
          type="button"
          className="button button-primary"
          onClick={() => {
            releaseHoldQuietly(state.holdId);
            clearPersistedState();
            setState(initialState);
          }}
        >
          Start over
        </button>
      </div>
    );
  }

  return (
    <div className="container py-10 md:py-16" ref={headingRef}>
      {content}
    </div>
  );
}
