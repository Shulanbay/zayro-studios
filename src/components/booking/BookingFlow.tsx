'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { CATEGORY_LABELS, bookingCategories, formatDuration, formatPrice, isBookable, servicesInCategory, type CatalogService } from '@/lib/catalog';

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

// Steps:
// 1 Service  2 Date  3 Customer info  4 Time (creates hold)  5 Summary / payment
interface BookingState {
  step: number;
  selectedService: Service | null;
  selectedDate: string | null;
  selectedTime: string | null;
  duration: number;
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
  availableTimeSlots: TimeSlot[];
  totalAmount: number;
  taxAmount: number;
  loading: boolean;
  error: string | null;
}

const STORAGE_KEY = 'zayro-booking-state-v1';
const STEP_LABELS = ['Service', 'Date', 'Details', 'Time', 'Confirm'];

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPhone(phone: string): boolean {
  return /^[\d\s\-().+]+$/.test(phone) && phone.replace(/\D/g, '').length >= 10;
}

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

function maxDateISO(horizonDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + horizonDays);
  return d.toISOString().split('T')[0];
}

function loadPersistedState(): Partial<BookingState> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function persistState(state: BookingState) {
  if (typeof window === 'undefined') return;
  try {
    const { loading, error, ...toStore } = state;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
  } catch {
    // sessionStorage unavailable (private mode etc.) — booking still works, just no reload recovery.
  }
}

function clearPersistedState() {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

const initialState: BookingState = {
  step: 1,
  selectedService: null,
  selectedDate: null,
  selectedTime: null,
  duration: 60,
  customerInfo: { firstName: '', lastName: '', email: '', phone: '', company: '', notes: '' },
  holdId: null,
  holdExpiresAt: null,
  availableTimeSlots: [],
  totalAmount: 0,
  taxAmount: 0,
  loading: false,
  error: null,
};

function ProgressBar({ step }: { step: number }) {
  return (
    <ol className="flex items-center gap-2 mb-10 md:mb-14" aria-label="Booking progress">
      {STEP_LABELS.map((label, idx) => {
        const stepNum = idx + 1;
        const isDone = stepNum < step;
        const isCurrent = stepNum === step;
        return (
          <li key={label} className="flex items-center gap-2 flex-1 last:flex-none">
            <span
              className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold flex-shrink-0 transition-colors ${
                isDone || isCurrent ? 'bg-gradient-cta text-white' : 'bg-white border border-zayro-border text-zayro-gray'
              }`}
              aria-current={isCurrent ? 'step' : undefined}
            >
              {isDone ? '✓' : stepNum}
            </span>
            <span className={`text-xs font-medium hidden sm:inline ${isCurrent ? 'text-zayro-dark' : 'text-zayro-gray'}`}>
              {label}
            </span>
            {stepNum < STEP_LABELS.length && <span className="flex-1 h-px bg-zayro-border" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}

export default function BookingFlow() {
  const [state, setState] = useState<BookingState>(initialState);
  const [hydrated, setHydrated] = useState(false);

  const [allServices, setAllServices] = useState<Service[]>([]);
  const [servicesError, setServicesError] = useState<string | null>(null);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const deepLinkHandled = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Hydrate from sessionStorage once, then re-validate anything time-sensitive.
  useEffect(() => {
    const persisted = loadPersistedState();
    if (!persisted || !persisted.selectedService) {
      setHydrated(true);
      return;
    }

    (async () => {
      // A persisted hold might have expired while the tab was reloaded —
      // confirm with the server before trusting it.
      if (persisted.holdId) {
        try {
          const res = await fetch('/api/booking/validate-hold', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hold_id: persisted.holdId }),
          });
          const data = await res.json();
          if (!data.valid) {
            // Drop back to time selection with everything else intact.
            setState((s) => ({
              ...s,
              ...persisted,
              step: persisted.selectedDate ? 4 : 2,
              holdId: null,
              holdExpiresAt: null,
              error: 'Your previous hold expired while you were away. Please pick a new time.',
            }));
            setHydrated(true);
            return;
          }
        } catch {
          // If we can't verify, don't trust the stale hold.
          setState((s) => ({ ...s, ...persisted, holdId: null, holdExpiresAt: null }));
          setHydrated(true);
          return;
        }
      }
      setState((s) => ({ ...s, ...persisted }));
      setHydrated(true);
    })();
  }, []);

  // Persist on every change, once hydration has settled.
  useEffect(() => {
    if (!hydrated) return;
    persistState(state);
  }, [state, hydrated]);

  useEffect(() => {
    const loadServices = async () => {
      try {
        const response = await fetch('/api/services');
        if (!response.ok) throw new Error('Failed to load services');
        const data = await response.json();
        setAllServices(Array.isArray(data) ? data : []);
        setServicesError(null);
      } catch (error) {
        console.error('Error loading services:', error);
        setServicesError('Unable to load services right now. Please refresh the page or try again shortly.');
      } finally {
        setServicesLoading(false);
      }
    };
    loadServices();
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
      if (state.selectedService?.id !== target.id || state.step === 1) {
        setState((s) => ({
          ...initialState,
          customerInfo: s.customerInfo,
          selectedService: target,
          duration: target.duration_minutes,
          totalAmount: parseFloat(target.base_price),
          step: 2,
        }));
      }
    } else if (categoryParam) {
      setCategory(categoryParam);
    }
    try {
      window.history.replaceState(null, '', window.location.pathname);
    } catch {
      // ignore
    }
  }, [hydrated, servicesLoading, allServices, state.selectedService, state.step]);

  // Hold countdown — ticks every second while a hold is active.
  useEffect(() => {
    if (!state.holdExpiresAt) {
      setSecondsRemaining(null);
      return;
    }
    const expiresAt = new Date(state.holdExpiresAt).getTime();
    const tick = () => {
      const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setSecondsRemaining(remaining);
      if (remaining <= 0 && pollRef.current) {
        clearInterval(pollRef.current);
      }
    };
    tick();
    pollRef.current = setInterval(tick, 1000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [state.holdExpiresAt]);

  const holdExpired = secondsRemaining !== null && secondsRemaining <= 0;

  const selectService = (service: Service) => {
    setState((s) => ({
      ...s,
      selectedService: service,
      duration: service.duration_minutes,
      totalAmount: parseFloat(service.base_price),
      step: 2,
      error: null,
    }));
  };

  const selectDate = (date: string) => {
    setState((s) => ({ ...s, selectedDate: date, step: 3, error: null }));
  };

  const validateCustomerInfo = (): string | null => {
    const { firstName, lastName, email, phone } = state.customerInfo;
    if (!firstName.trim() || !lastName.trim()) return 'Please enter your first and last name.';
    if (!isValidEmail(email)) return 'Please enter a valid email address.';
    if (!isValidPhone(phone)) return 'Please enter a valid phone number (at least 10 digits).';
    return null;
  };

  const proceedToTimeSelection = async () => {
    const validationError = validateCustomerInfo();
    if (validationError) {
      setState((s) => ({ ...s, error: validationError }));
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const response = await fetch(
        `/api/booking/available-times?service_id=${state.selectedService!.id}&date=${state.selectedDate}&duration_minutes=${state.duration}`
      );
      if (!response.ok) throw new Error('Failed to load available times');
      const data = await response.json();

      setState((s) => ({
        ...s,
        availableTimeSlots: data.time_slots || [],
        loading: false,
        step: 4,
      }));
    } catch (error) {
      setState((s) => ({
        ...s,
        loading: false,
        error: 'Failed to load available times. Please try again.',
      }));
    }
  };

  const refreshAvailableTimes = async () => {
    if (!state.selectedService || !state.selectedDate) return;
    try {
      const response = await fetch(
        `/api/booking/available-times?service_id=${state.selectedService.id}&date=${state.selectedDate}&duration_minutes=${state.duration}`
      );
      const data = await response.json();
      setState((s) => ({ ...s, availableTimeSlots: data.time_slots || [] }));
    } catch {
      // Non-fatal — the user can still retry manually.
    }
  };

  const selectTime = async (slot: TimeSlot) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const response = await fetch('/api/booking/create-hold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_email: state.customerInfo.email,
          service_id: state.selectedService!.id,
          booking_date: state.selectedDate,
          start_time: slot.start,
          end_time: slot.end,
          duration_minutes: state.duration,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        if (response.status === 409) {
          await refreshAvailableTimes();
          throw new Error('Sorry, that time slot was just taken. Please choose another time below.');
        }
        throw new Error(error.error || 'Failed to reserve time slot');
      }

      const holdData = await response.json();

      setState((s) => ({
        ...s,
        selectedTime: slot.start,
        holdId: holdData.hold_id,
        holdExpiresAt: holdData.hold_expires_at,
        loading: false,
        step: 5,
      }));
      setCheckoutUrl(null);
    } catch (error: any) {
      setState((s) => ({
        ...s,
        loading: false,
        error: error.message || 'Failed to reserve time slot',
      }));
    }
  };

  const updateCustomerInfo = (field: string, value: string) => {
    setState((s) => ({
      ...s,
      customerInfo: { ...s.customerInfo, [field]: value },
    }));
  };

  const startOver = () => {
    setState((s) => ({
      ...s,
      step: 4,
      holdId: null,
      holdExpiresAt: null,
      error: 'Your hold expired. Please choose a new time.',
    }));
    refreshAvailableTimes();
  };

  const proceedToPayment = async () => {
    if (holdExpired) {
      startOver();
      return;
    }

    setState((s) => ({ ...s, loading: true, error: null }));

    try {
      const validateResponse = await fetch('/api/booking/validate-hold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hold_id: state.holdId }),
      });
      const validation = await validateResponse.json();
      if (!validation.valid) {
        startOver();
        return;
      }

      const payload = {
        holdId: state.holdId,
        firstName: state.customerInfo.firstName,
        lastName: state.customerInfo.lastName,
        email: state.customerInfo.email,
        phone: state.customerInfo.phone,
        company: state.customerInfo.company,
        notes: state.customerInfo.notes,
      };

      // Try the free-confirmation path first only if our own displayed
      // total is zero; the server independently re-validates this either
      // way, so a tampered client total can't skip payment for a paid
      // service.
      if (state.totalAmount + state.taxAmount <= 0) {
        const freeResponse = await fetch('/api/booking/confirm-free', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const freeData = await freeResponse.json();

        if (freeResponse.ok) {
          clearPersistedState();
          window.location.href = `/booking/success?booking_id=${encodeURIComponent(freeData.bookingId)}`;
          return;
        }

        if (!freeData.requiresPayment) {
          throw new Error(freeData.error || 'Failed to confirm booking');
        }
        // Server says this isn't actually free after all — fall through to paid checkout.
      }

      const checkoutResponse = await fetch('/api/payment/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!checkoutResponse.ok) {
        const error = await checkoutResponse.json();
        throw new Error(error.error || 'Failed to create payment session');
      }

      const checkoutData = await checkoutResponse.json();

      setState((s) => ({
        ...s,
        totalAmount: parseFloat(checkoutData.pricing.subtotal),
        taxAmount: parseFloat(checkoutData.pricing.taxAmount),
        loading: false,
      }));
      setCheckoutUrl(checkoutData.checkoutUrl);
    } catch (error: any) {
      setState((s) => ({
        ...s,
        loading: false,
        error: error.message || 'Failed to proceed to payment',
      }));
    }
  };

  const proceedToStripe = () => {
    if (checkoutUrl) {
      // The Stripe session already carries everything needed to confirm the
      // booking server-side, so there's nothing left to recover locally.
      clearPersistedState();
      window.location.href = checkoutUrl;
    } else {
      setState((s) => ({ ...s, error: 'Payment session lost. Please try again.' }));
    }
  };

  if (!hydrated) {
    return (
      <div className="container py-16 md:py-32">
        <div className="skeleton h-12 w-2/3 mb-4" />
        <div className="skeleton h-6 w-1/3 mb-16" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="skeleton h-56" />
          <div className="skeleton h-56" />
        </div>
      </div>
    );
  }

  // ========================================
  // Step 1: Service Selection
  // ========================================
  if (state.step === 1) {
    const catalog = asCatalog(allServices);
    const categories = bookingCategories(catalog);
    const activeCategory =
      (category && categories.includes(category as any) && category) ||
      (state.selectedService && categories.includes(state.selectedService.category as any) && state.selectedService.category) ||
      categories[0] ||
      null;
    const visible = activeCategory ? servicesInCategory(catalog, activeCategory).filter(isBookable) : [];

    return (
      <div className="container py-12 md:py-20">
        <ProgressBar step={1} />
        <h1 className="text-5xl md:text-7xl font-black leading-tight mb-4 text-zayro-dark">
          SELECT A<br />SERVICE
        </h1>
        <p className="text-lg text-zayro-gray mb-10">Choose what you&apos;re booking, then pick the session that fits.</p>

        {servicesLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6" aria-busy="true" aria-label="Loading services">
            <div className="skeleton h-56" />
            <div className="skeleton h-56" />
          </div>
        )}
        {servicesError && <div className="form-error-banner mb-8">{servicesError}</div>}
        {!servicesLoading && !servicesError && categories.length === 0 && (
          <p className="text-zayro-gray">No services are available for booking right now. Please contact us directly.</p>
        )}

        {categories.length > 0 && (
          <div role="group" aria-label="Service category" className="flex flex-wrap gap-3 mb-10">
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
          {visible.map((service) => (
            <button
              key={service.id}
              type="button"
              onClick={() => selectService(allServices.find((s) => s.id === service.id)!)}
              className="card card-interactive text-left h-full flex flex-col items-stretch justify-start min-w-0"
            >
              {service.badge && (
                <span className="self-start mb-3 rounded-full bg-gradient-cta px-3 py-1 text-sm font-semibold text-white">
                  {service.badge}
                </span>
              )}
              <h3 className="text-2xl font-black mb-2 text-zayro-dark break-words">{service.name}</h3>
              {service.description && <p className="text-base text-zayro-gray mb-6">{service.description}</p>}
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mt-auto">
                <span className="text-4xl font-black text-zayro-dark">{formatPrice(service.base_price)}</span>
                <span className="text-base text-zayro-gray">{formatDuration(service.duration_minutes)}</span>
              </div>
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
      </div>
    );
  }

  // ========================================
  // Step 2: Date Selection
  // ========================================
  if (state.step === 2) {
    return (
      <div className="container py-12 md:py-20">
        <ProgressBar step={2} />
        <button
          onClick={() => setState((s) => ({ ...s, step: 1 }))}
          className="mb-6 text-zayro-primary hover:text-zayro-dark transition-colors text-sm font-medium"
        >
          ← Back
        </button>
        <h1 className="text-5xl md:text-7xl font-black leading-tight mb-4 text-zayro-dark">
          SELECT A<br />DATE
        </h1>
        <p className="text-lg text-zayro-gray mb-12">
          {state.selectedService?.name} · {formatDuration(state.duration)}
        </p>
        <div className="card max-w-md">
          <label htmlFor="booking-date" className="field-label">
            Session date
          </label>
          <input
            id="booking-date"
            type="date"
            min={todayISO()}
            max={maxDateISO(90)}
            defaultValue={state.selectedDate || ''}
            onChange={(e) => e.target.value && selectDate(e.target.value)}
            className="text-lg"
          />
          <p className="text-xs text-zayro-gray mt-3">Studio timezone: America/New_York (ET)</p>
        </div>
      </div>
    );
  }

  // ========================================
  // Step 3: Customer Information (collected before the hold is created)
  // ========================================
  if (state.step === 3) {
    return (
      <div className="container py-12 md:py-20">
        <ProgressBar step={3} />
        <button
          onClick={() => setState((s) => ({ ...s, step: 2, error: null }))}
          className="mb-6 text-zayro-primary hover:text-zayro-dark transition-colors text-sm font-medium"
        >
          ← Back
        </button>
        <h1 className="text-5xl md:text-7xl font-black leading-tight mb-4 text-zayro-dark">
          YOUR
          <br />
          INFORMATION
        </h1>
        <p className="text-lg text-zayro-gray mb-12">We need your details before reserving a time slot.</p>
        <form
          className="card max-w-2xl space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            proceedToTimeSelection();
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
              value={state.customerInfo.phone}
              onChange={(e) => updateCustomerInfo('phone', e.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="company" className="field-label">
              Company / Show name (optional)
            </label>
            <input
              id="company"
              type="text"
              value={state.customerInfo.company}
              onChange={(e) => updateCustomerInfo('company', e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="notes" className="field-label">
              Notes (optional)
            </label>
            <textarea
              id="notes"
              value={state.customerInfo.notes}
              onChange={(e) => updateCustomerInfo('notes', e.target.value)}
              className="h-28"
            />
          </div>
          {state.error && (
            <p className="field-error" role="alert">
              {state.error}
            </p>
          )}
          <button type="submit" disabled={state.loading} className={`button button-primary w-full text-base py-4 ${state.loading ? 'is-loading' : ''}`}>
            Continue
          </button>
        </form>
      </div>
    );
  }

  // ========================================
  // Step 4: Time Selection (creates the hold)
  // ========================================
  if (state.step === 4) {
    const hasAnySlot = state.availableTimeSlots.length > 0;
    const hasAvailableSlot = state.availableTimeSlots.some((s) => s.available);

    return (
      <div className="container py-12 md:py-20">
        <ProgressBar step={4} />
        <button
          onClick={() => setState((s) => ({ ...s, step: 3, error: null }))}
          className="mb-6 text-zayro-primary hover:text-zayro-dark transition-colors text-sm font-medium"
        >
          ← Back
        </button>
        <h1 className="text-5xl md:text-7xl font-black leading-tight mb-4 text-zayro-dark">
          SELECT A<br />TIME
        </h1>
        <p className="text-lg text-zayro-gray mb-10">{state.selectedDate}</p>
        {state.error && (
          <p className="field-error mb-8" role="alert">
            {state.error}
          </p>
        )}
        {state.loading && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3" aria-busy="true" aria-label="Loading available times">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="skeleton h-16" />
            ))}
          </div>
        )}
        {!state.loading && hasAnySlot && !hasAvailableSlot && (
          <p className="text-zayro-gray mb-8">No available times on this date. Please go back and choose another date.</p>
        )}
        {!state.loading && !hasAnySlot && (
          <p className="text-zayro-gray mb-8">The studio is closed on this date. Please choose another date.</p>
        )}
        {!state.loading && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {state.availableTimeSlots.map((slot) => (
              <button
                key={`${slot.start}-${slot.end}`}
                onClick={() => selectTime(slot)}
                disabled={!slot.available || state.loading}
                aria-label={`${slot.start} to ${slot.end}${slot.available ? '' : ', unavailable'}`}
                className={`p-3 rounded-md-plus border-2 transition-all text-center ${
                  slot.available
                    ? 'border-zayro-border bg-white hover:border-zayro-primary hover:shadow-soft cursor-pointer'
                    : 'border-zayro-border bg-zayro-bg text-zayro-gray/50 cursor-not-allowed'
                }`}
              >
                <div className="font-bold text-sm md:text-base">{slot.start}</div>
                <div className="text-xs text-zayro-gray">to {slot.end}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ========================================
  // Step 5: Summary / Payment
  // ========================================
  if (state.step === 5) {
    const total = state.totalAmount + state.taxAmount;
    const isFree = total <= 0;

    return (
      <div className="container py-12 md:py-20">
        <ProgressBar step={5} />
        <button
          onClick={() => setState((s) => ({ ...s, step: 4, error: null }))}
          className="mb-6 text-zayro-primary hover:text-zayro-dark transition-colors text-sm font-medium"
        >
          ← Back
        </button>
        <h1 className="text-5xl md:text-7xl font-black leading-tight mb-4 text-zayro-dark">
          BOOKING
          <br />
          SUMMARY
        </h1>

        {secondsRemaining !== null && !holdExpired && !checkoutUrl && (
          <p className="chip mb-10" role="status">
            <span className="chip-dot" aria-hidden="true" />
            Time slot held for {Math.floor(secondsRemaining / 60)}:{String(secondsRemaining % 60).padStart(2, '0')}
          </p>
        )}
        {holdExpired && (
          <div className="form-error-banner mb-10">
            Your hold expired.{' '}
            <button className="underline font-bold" onClick={startOver}>
              Choose a new time
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
          <div className="md:col-span-2 space-y-8">
            <div className="card">
              <h3 className="text-xs font-bold text-zayro-gray uppercase tracking-wide mb-2">Service</h3>
              <p className="text-2xl font-black text-zayro-dark">{state.selectedService?.name}</p>
            </div>

            <div className="card">
              <h3 className="text-xs font-bold text-zayro-gray uppercase tracking-wide mb-2">Date & time</h3>
              <p className="text-xl font-black text-zayro-dark">
                {new Date(state.selectedDate + 'T00:00:00').toLocaleDateString('en-US', {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </p>
              <p className="text-lg font-bold mt-1 text-zayro-primary">
                {state.selectedTime} ET · {formatDuration(state.duration)}
              </p>
            </div>

            <div className="card">
              <h3 className="text-xs font-bold text-zayro-gray uppercase tracking-wide mb-2">Customer information</h3>
              <p className="text-lg font-bold text-zayro-dark">
                {state.customerInfo.firstName} {state.customerInfo.lastName}
              </p>
              <p className="text-zayro-gray">{state.customerInfo.email}</p>
              <p className="text-zayro-gray">{state.customerInfo.phone}</p>
              {state.customerInfo.company && <p className="text-zayro-gray">{state.customerInfo.company}</p>}
            </div>
          </div>

          <div className="card h-fit">
            <h3 className="text-xs font-bold text-zayro-gray uppercase tracking-wide mb-6">Pricing</h3>
            <div className="space-y-3 border-b border-zayro-border pb-6 mb-6">
              <div className="flex justify-between text-sm">
                <span className="text-zayro-gray">Subtotal</span>
                <span className="font-semibold text-zayro-dark">${state.totalAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-zayro-gray">Tax</span>
                <span className="font-semibold text-zayro-dark">${state.taxAmount.toFixed(2)}</span>
              </div>
            </div>
            <div className="flex justify-between text-2xl font-black mb-6">
              <span className="text-zayro-dark">Total</span>
              <span className="text-zayro-primary">${total.toFixed(2)}</span>
            </div>

            {!checkoutUrl ? (
              <button
                onClick={proceedToPayment}
                disabled={state.loading || holdExpired}
                className={`button button-primary w-full py-4 text-base ${state.loading ? 'is-loading' : ''}`}
              >
                {isFree ? 'Confirm Booking' : 'Continue to Payment'}
              </button>
            ) : (
              <button
                onClick={proceedToStripe}
                disabled={state.loading}
                className={`button button-primary w-full py-4 text-base ${state.loading ? 'is-loading' : ''}`}
              >
                Secure Checkout
              </button>
            )}

            {state.error && (
              <p className="field-error mt-4" role="alert">
                {state.error}
              </p>
            )}
          </div>
        </div>

        {!isFree && (
          <div className="max-w-3xl mb-16">
            <div className="card bg-zayro-bg text-sm">
              <p className="font-bold mb-1 text-zayro-dark">Secure payment</p>
              <p className="text-zayro-gray">Payment is processed securely by Stripe. Your booking total is confirmed before you're charged.</p>
            </div>
          </div>
        )}

        <p className="text-sm text-zayro-gray">Studio address: 40 W 37th St, Suite 603, New York, NY 10018</p>
      </div>
    );
  }

  return null;
}
