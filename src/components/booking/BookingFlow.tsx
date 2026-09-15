'use client';

import { useState, useEffect } from 'react';

interface TimeSlot {
  start: string;
  end: string;
  available: boolean;
}

interface BookingState {
  step: number;
  selectedService: any | null;
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
  availableDates: string[];
  availableTimeSlots: TimeSlot[];
  totalAmount: number;
  taxAmount: number;
  loading: boolean;
  error: string | null;
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
    availableDates: [],
    availableTimeSlots: [],
    totalAmount: 0,
    taxAmount: 0,
    loading: false,
    error: null,
  });

  const [allServices, setAllServices] = useState<any[]>([]);

  useEffect(() => {
    // Load services from API with demo fallback
    const loadServices = async () => {
      try {
        const response = await fetch('/api/services');
        if (!response.ok) throw new Error('Failed to load services');
        const data = await response.json();
        setAllServices(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error('Error loading services, using demo data:', error);
        // Demo data for testing
        setAllServices([
          {
            id: 1,
            name: 'Single Hour',
            description: '1 hour professional studio session',
            base_price: '200.00',
            duration_minutes: 60,
            is_active: true,
          },
          {
            id: 2,
            name: 'Half Day',
            description: '4 hours professional studio session',
            base_price: '700.00',
            duration_minutes: 240,
            is_active: true,
          },
          {
            id: 3,
            name: 'Full Day',
            description: '8 hours professional studio session',
            base_price: '1200.00',
            duration_minutes: 480,
            is_active: true,
          },
        ]);
      }
    };
    loadServices();
  }, []);

  const selectService = (service: any) => {
    setState((s) => ({
      ...s,
      selectedService: service,
      duration: service.duration_minutes,
      totalAmount: parseFloat(service.base_price),
      step: 2,
      error: null,
    }));
  };

  const selectDate = async (date: string) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const response = await fetch(
        `/api/booking/available-times?service_id=${state.selectedService.id}&date=${date}&duration_minutes=${state.duration}`
      );
      const data = await response.json();

      setState((s) => ({
        ...s,
        selectedDate: date,
        availableTimeSlots: data.time_slots,
        loading: false,
        step: 3,
      }));
    } catch (error) {
      setState((s) => ({
        ...s,
        loading: false,
        error: 'Failed to load available times',
      }));
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
          service_id: state.selectedService.id,
          booking_date: state.selectedDate,
          start_time: slot.start,
          end_time: slot.end,
          duration_minutes: state.duration,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create hold');
      }

      const holdData = await response.json();

      setState((s) => ({
        ...s,
        selectedTime: slot.start,
        holdId: holdData.hold_id,
        loading: false,
        step: 4,
      }));
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
      customerInfo: {
        ...s.customerInfo,
        [field]: value,
      },
    }));
  };

  const proceedToPayment = async () => {
    // Validate hold is still valid
    const validateResponse = await fetch('/api/booking/validate-hold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hold_id: state.holdId }),
    });

    const validation = await validateResponse.json();
    if (!validation.valid) {
      setState((s) => ({
        ...s,
        error: 'Your booking hold has expired. Please select a new time slot.',
        step: 3,
      }));
      return;
    }

    // Store booking data and proceed to payment
    sessionStorage.setItem('bookingData', JSON.stringify({
      holdId: state.holdId,
      serviceId: state.selectedService.id,
      bookingDate: state.selectedDate,
      startTime: state.selectedTime,
      duration: state.duration,
      customerInfo: state.customerInfo,
      totalAmount: state.totalAmount,
      taxAmount: state.taxAmount,
    }));

    // In Phase 3, this will redirect to Stripe checkout
    // For now, just proceed to summary
    setState((s) => ({ ...s, step: 7 }));
  };

  // Step 1: Service Selection
  if (state.step === 1) {
    return (
      <div className="container py-16 md:py-32">
        <h1 className="text-6xl md:text-8xl font-black leading-tight mb-12">
          SELECT A<br />SERVICE
        </h1>
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
                <span className="text-5xl md:text-6xl font-black">${service.base_price}</span>
                <span className="text-sm text-zayro-gray">{service.duration_minutes} minutes</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Step 2: Date Selection
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
            onChange={(e) => selectDate(e.target.value)}
            className="w-full p-4 border border-zayro-bg text-lg"
          />
        </div>
      </div>
    );
  }

  // Step 3: Time Selection
  if (state.step === 3) {
    return (
      <div className="container py-16 md:py-32">
        <button
          onClick={() => setState((s) => ({ ...s, step: 2 }))}
          className="mb-8 text-zayro-primary hover:text-zayro-dark transition-colors text-sm font-medium"
        >
          ← Back
        </button>
        <h1 className="text-6xl md:text-8xl font-black leading-tight mb-4">
          SELECT A<br />TIME
        </h1>
        <p className="text-lg text-zayro-gray mb-12">
          {state.selectedDate}
        </p>
        {state.loading && <p>Loading available times...</p>}
        {state.error && <p className="text-red-600 mb-8">{state.error}</p>}
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

  // Step 4: Customer Information
  if (state.step === 4) {
    return (
      <div className="container py-16 md:py-32">
        <button
          onClick={() => setState((s) => ({ ...s, step: 3 }))}
          className="mb-8 text-zayro-primary hover:text-zayro-dark transition-colors text-sm font-medium"
        >
          ← Back
        </button>
        <h1 className="text-6xl md:text-8xl font-black leading-tight mb-4">
          YOUR<br />INFORMATION
        </h1>
        <form className="max-w-2xl space-y-8">
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
          <button
            type="button"
            onClick={() => setState((s) => ({ ...s, step: 5 }))}
            className="button button-primary w-full text-lg py-4"
          >
            CONTINUE
          </button>
        </form>
      </div>
    );
  }

  // Step 5-6: Summary / Step 7: Payment Handoff
  if (state.step === 5 || state.step === 6 || state.step === 7) {
    return (
      <div className="container py-16 md:py-32">
        <button
          onClick={() => setState((s) => ({ ...s, step: 4 }))}
          className="mb-8 text-zayro-primary hover:text-zayro-dark transition-colors text-sm font-medium"
        >
          ← Back
        </button>
        <h1 className="text-6xl md:text-8xl font-black leading-tight mb-12">
          BOOKING<br />SUMMARY
        </h1>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 mb-16">
          {/* Details */}
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
              <p className="text-2xl font-black mt-2 text-zayro-primary">
                {state.selectedTime} ET
              </p>
            </div>

            <div className="border-b border-zayro-bg pb-8">
              <h3 className="text-sm font-bold text-zayro-gray uppercase mb-4">Duration</h3>
              <p className="text-2xl font-black">{state.duration} minutes</p>
            </div>

            <div className="pb-8">
              <h3 className="text-sm font-bold text-zayro-gray uppercase mb-4">Customer Information</h3>
              <p className="text-lg font-bold">{state.customerInfo.firstName} {state.customerInfo.lastName}</p>
              <p className="text-lg">{state.customerInfo.email}</p>
              <p className="text-lg">{state.customerInfo.phone}</p>
              {state.customerInfo.company && <p className="text-lg">{state.customerInfo.company}</p>}
            </div>
          </div>

          {/* Pricing */}
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
              <span className="text-zayro-primary">${(state.totalAmount + state.taxAmount).toFixed(2)}</span>
            </div>
            <button
              onClick={proceedToPayment}
              className="button button-primary w-full py-4 text-lg"
            >
              CONTINUE TO PAYMENT →
            </button>
          </div>
        </div>

        <p className="text-sm text-zayro-gray">
          Studio Address: 40 W 37th St, Suite 603, New York, NY 10018
        </p>
      </div>
    );
  }

  return null;
}
