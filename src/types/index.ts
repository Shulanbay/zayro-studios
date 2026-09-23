// Booking-related types
export interface BookingFormData {
  service_id: number;
  booking_date: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  customer_first_name: string;
  customer_last_name: string;
  customer_email: string;
  customer_phone: string;
  company_name?: string;
  notes?: string;
}

export interface BookingStep {
  step: number;
  title: string;
  completed: boolean;
}

export interface TimeSlot {
  start: string;
  end: string;
  available: boolean;
}

export interface AvailabilityResponse {
  time_slots: TimeSlot[];
  date: string;
}

export interface CheckAvailabilityResponse {
  available_dates: string[];
  min_date: string;
  max_date: string;
}

// Service types
export interface ServiceDetails {
  id: number;
  name: string;
  description: string | null;
  base_price: string;
  duration_minutes: number;
  category: 'podcast' | 'video' | 'livestream' | 'editing' | 'tour';
  features: string[];
  is_active: boolean;
}

// Stripe types
export interface StripeCheckoutResponse {
  booking_id: string;
  status: string;
  stripe_session_id: string;
  checkout_url: string;
}

export interface StripeWebhookPayload {
  type: string;
  data: {
    object: {
      id: string;
      [key: string]: any;
    };
  };
}

// API Response types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// Booking state
export interface BookingState {
  service_id: number | null;
  duration_minutes: number | null;
  booking_date: string | null;
  start_time: string | null;
  customer_first_name: string;
  customer_last_name: string;
  customer_email: string;
  customer_phone: string;
  company_name: string;
  notes: string;
  currentStep: number;
}
