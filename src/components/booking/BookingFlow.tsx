'use client';

import { useState, useEffect, useRef } from 'react';

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

export default function BookingFlow() {
  const [state, setState] = useState<BookingState>({
    step: 1,
    selectedService: null,
    selectedDate: null,
    selectedTime: null,
    duration: 60,
    customerInfo: {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      company: '',
      notes: '',
    },
    holdId: null,
    holdExpiresAt: null,
    availableTimeSlots: [],
    totalAmount: 0,
    taxAmount: 0,
    loading: false,
    error: null,
  });

  const [allServices, setAllServices] = useState<Service[]>([]);
  const [servicesError, setServicesError] = useState<string | null>(null);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    if (!isValidPhone(phone)) return 'Please enter a valid phone number.';
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
      window.location.href = checkoutUrl;
    } else {
      setState((s) => ({ ...s, error: 'Payment session lost. Please try again.' }));
    }
  };

  // ========================================
  // Step 1: Service Selection
  // ========================================
  if (state.step === 1) {
    return (
      <div className="container py-16 md:py-32">
        <h1 className="text-6xl md:text-8xl font-black leading-tight mb-12">
          SELECT A<br />SERVICE
        </h1>
        {servicesLoading && <p className="text-lg text-zayro-gray">Loading services...</p>}
        {servicesError && (
          <div className="bg-red-50 border border-red-200 p-6 text-red-800 mb-8">{servicesError}</div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12">
          {allServices.map((service) => (
            <div
              key={service.id}
              onClick={() => selectService(service)}
              className="p-8 md:p-12 border-2 border-zayro-bg cursor-pointer hover:border-zayro-primary transition-all group"
            >
              <h3 className="text-3xl md:text-4xl font-black mb-4 group-hover:text-zayro-primary transition-colors">
                {service.name}
              </h3>
              <p className="text-lg text-zayro-gray mb-6">{service.description}</p>
              <div className="flex items-baseline gap-4">
                <span className="text-5xl md:text-6xl font-black">
                  {parseFloat(service.base_price) > 0 ? `$${service.base_price}` : 'Free'}
                </span>
                <span className="text-sm text-zayro-gray">{service.duration_minutes} minutes</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ========================================
  // Step 2: Date Selection
  // ========================================
  if (state.step === 2) {
    return (
      <div className="container py-16 md:py-32">
        <button
          onClick={() => setState((s) => ({ ...s, step: 1 }))}
          className="mb-8 text-zayro-primary hover:text-zayro-dark transition-colors text-sm font-medium"
        >
          ← Back
        </button>
        <h1 className="text-6xl md:text-8xl font-black leading-tight mb-4">
          SELECT A<br />DATE
        </h1>
        <p className="text-lg text-zayro-gray mb-12">
          {state.selectedService?.name} • {state.duration} minutes
        </p>
        <div className="bg-white p-8 md:p-12 border border-zayro-bg">
          <input
            type="date"
            min={todayISO()}
            max={maxDateISO(90)}
            defaultValue={state.selectedDate || ''}
            onChange={(e) => e.target.value && selectDate(e.target.value)}
            className="w-full p-4 border border-zayro-bg text-lg"
          />
        </div>
      </div>
    );
  }

  // ========================================
  // Step 3: Customer Information (collected before the hold is created)
  // ========================================
  if (state.step === 3) {
    return (
      <div className="container py-16 md:py-32">
        <button
          onClick={() => setState((s) => ({ ...s, step: 2, error: null }))}
          className="mb-8 text-zayro-primary hover:text-zayro-dark transition-colors text-sm font-medium"
        >
          ← Back
        </button>
        <h1 className="text-6xl md:text-8xl font-black leading-tight mb-4">
          YOUR<br />INFORMATION
        </h1>
        <p className="text-lg text-zayro-gray mb-12">
          We need your details before reserving a time slot.
        </p>
        <form
          className="max-w-2xl space-y-8"
          onSubmit={(e) => {
            e.preventDefault();
            proceedToTimeSelection();
          }}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <input
              type="text"
              placeholder="First Name"
              value={state.customerInfo.firstName}
              onChange={(e) => updateCustomerInfo('firstName', e.target.value)}
              className="p-4 border border-zayro-bg text-lg"
              required
            />
            <input
              type="text"
              placeholder="Last Name"
              value={state.customerInfo.lastName}
              onChange={(e) => updateCustomerInfo('lastName', e.target.value)}
              className="p-4 border border-zayro-bg text-lg"
              required
            />
          </div>
          <input
            type="email"
            placeholder="Email"
            value={state.customerInfo.email}
            onChange={(e) => updateCustomerInfo('email', e.target.value)}
            className="w-full p-4 border border-zayro-bg text-lg"
            required
          />
          <input
            type="tel"
            placeholder="Phone"
            value={state.customerInfo.phone}
            onChange={(e) => updateCustomerInfo('phone', e.target.value)}
            className="w-full p-4 border border-zayro-bg text-lg"
            required
          />
          <input
            type="text"
            placeholder="Company / Show Name (optional)"
            value={state.customerInfo.company}
            onChange={(e) => updateCustomerInfo('company', e.target.value)}
            className="w-full p-4 border border-zayro-bg text-lg"
          />
          <textarea
            placeholder="Notes (optional)"
            value={state.customerInfo.notes}
            onChange={(e) => updateCustomerInfo('notes', e.target.value)}
            className="w-full p-4 border border-zayro-bg text-lg h-32"
          />
          {state.error && <p className="text-red-600">{state.error}</p>}
          <button type="submit" disabled={state.loading} className="button button-primary w-full text-lg py-4 disabled:opacity-50">
            {state.loading ? 'Loading times...' : 'CONTINUE'}
          </button>
        </form>
      </div>
    );
  }

  // ========================================
  // Step 4: Time Selection (creates the hold)
  // ========================================
  if (state.step === 4) {
    return (
      <div className="container py-16 md:py-32">
        <button
          onClick={() => setState((s) => ({ ...s, step: 3, error: null }))}
          className="mb-8 text-zayro-primary hover:text-zayro-dark transition-colors text-sm font-medium"
        >
          ← Back
        </button>
        <h1 className="text-6xl md:text-8xl font-black leading-tight mb-4">
          SELECT A<br />TIME
        </h1>
        <p className="text-lg text-zayro-gray mb-12">{state.selectedDate}</p>
        {state.loading && <p>Loading available times...</p>}
        {state.error && <p className="text-red-600 mb-8">{state.error}</p>}
        {!state.loading && state.availableTimeSlots.every((s) => !s.available) && (
          <p className="text-zayro-gray mb-8">
            No available times on this date. Please go back and choose another date.
          </p>
        )}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {state.availableTimeSlots.map((slot) => (
            <button
              key={`${slot.start}-${slot.end}`}
              onClick={() => selectTime(slot)}
              disabled={!slot.available || state.loading}
              className={`p-4 border-2 transition-all ${
                slot.available
                  ? 'border-zayro-bg hover:border-zayro-primary cursor-pointer'
                  : 'border-gray-300 text-gray-400 cursor-not-allowed'
              }`}
            >
              <div className="font-bold text-sm md:text-base">{slot.start}</div>
              <div className="text-xs text-zayro-gray">to {slot.end}</div>
            </button>
          ))}
        </div>
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
      <div className="container py-16 md:py-32">
        <button
          onClick={() => setState((s) => ({ ...s, step: 4, error: null }))}
          className="mb-8 text-zayro-primary hover:text-zayro-dark transition-colors text-sm font-medium"
        >
          ← Back
        </button>
        <h1 className="text-6xl md:text-8xl font-black leading-tight mb-4">
          BOOKING<br />SUMMARY
        </h1>

        {secondsRemaining !== null && !holdExpired && !checkoutUrl && (
          <p className="text-sm text-zayro-primary font-bold mb-12">
            Time slot held for {Math.floor(secondsRemaining / 60)}:{String(secondsRemaining % 60).padStart(2, '0')}
          </p>
        )}
        {holdExpired && (
          <div className="bg-red-50 border border-red-200 p-6 text-red-800 mb-12">
            Your hold expired.{' '}
            <button className="underline font-bold" onClick={startOver}>
              Choose a new time
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 mb-16">
          <div className="md:col-span-2 space-y-12">
            <div className="border-b border-zayro-bg pb-8">
              <h3 className="text-sm font-bold text-zayro-gray uppercase mb-4">Service</h3>
              <p className="text-4xl font-black">{state.selectedService?.name}</p>
            </div>

            <div className="border-b border-zayro-bg pb-8">
              <h3 className="text-sm font-bold text-zayro-gray uppercase mb-4">Date & Time</h3>
              <p className="text-3xl font-black">
                {new Date(state.selectedDate + 'T00:00:00').toLocaleDateString('en-US', {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </p>
              <p className="text-2xl font-black mt-2 text-zayro-primary">{state.selectedTime} ET</p>
            </div>

            <div className="border-b border-zayro-bg pb-8">
              <h3 className="text-sm font-bold text-zayro-gray uppercase mb-4">Duration</h3>
              <p className="text-2xl font-black">{state.duration} minutes</p>
            </div>

            <div className="pb-8">
              <h3 className="text-sm font-bold text-zayro-gray uppercase mb-4">Customer Information</h3>
              <p className="text-lg font-bold">
                {state.customerInfo.firstName} {state.customerInfo.lastName}
              </p>
              <p className="text-lg">{state.customerInfo.email}</p>
              <p className="text-lg">{state.customerInfo.phone}</p>
              {state.customerInfo.company && <p className="text-lg">{state.customerInfo.company}</p>}
            </div>
          </div>

          <div className="bg-white p-8 md:p-12 border border-zayro-bg h-fit">
            <h3 className="text-sm font-bold text-zayro-gray uppercase mb-8">Pricing</h3>
            <div className="space-y-4 border-b border-zayro-bg pb-8 mb-8">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span className="font-bold">${state.totalAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span>Tax</span>
                <span className="font-bold">${state.taxAmount.toFixed(2)}</span>
              </div>
            </div>
            <div className="flex justify-between text-2xl font-black mb-8">
              <span>Total</span>
              <span className="text-zayro-primary">${total.toFixed(2)}</span>
            </div>

            {!checkoutUrl ? (
              <button
                onClick={proceedToPayment}
                disabled={state.loading || holdExpired}
                className="button button-primary w-full py-4 text-lg disabled:opacity-50"
              >
                {state.loading ? 'Processing...' : isFree ? 'CONFIRM BOOKING →' : 'CONTINUE TO PAYMENT →'}
              </button>
            ) : (
              <button
                onClick={proceedToStripe}
                disabled={state.loading}
                className="button button-primary w-full py-4 text-lg disabled:opacity-50"
              >
                {state.loading ? 'Processing...' : 'SECURE CHECKOUT →'}
              </button>
            )}

            {state.error && <p className="text-red-600 text-sm mt-4">{state.error}</p>}
          </div>
        </div>

        {!isFree && (
          <div className="max-w-3xl mb-16">
            <div className="bg-blue-50 border border-blue-200 p-6 text-sm text-blue-900">
              <p className="font-bold mb-2">🔒 Secure Payment</p>
              <p>Payment is processed securely by Stripe. Your booking total will be confirmed before you're charged.</p>
            </div>
          </div>
        )}

        <p className="text-sm text-zayro-gray">Studio Address: 40 W 37th St, Suite 603, New York, NY 10018</p>
      </div>
    );
  }

  return null;
}
