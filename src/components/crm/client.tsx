'use client';

/**
 * Interactive building blocks for the admin CRM: toasts, a confirm dialog
 * built on the native <dialog> element (focus is trapped and restored by
 * the browser, Esc closes), and buttons/forms that call an admin API route
 * and refresh the server-rendered page.
 */
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

type Toast = { id: number; tone: 'success' | 'error'; message: string };
const ToastContext = createContext<(tone: Toast['tone'], message: string) => void>(() => undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast['tone'], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, tone, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 9000 : 5000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 left-4 sm:left-auto z-[60] flex flex-col gap-2 items-stretch sm:items-end" aria-live="polite" role="status">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`rounded-xl px-4 py-3 text-sm shadow-lift border max-w-md ${
              t.tone === 'success' ? 'bg-white border-emerald-200 text-emerald-900' : 'bg-white border-red-200 text-red-900'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

// ---------------------------------------------------------------------------
// API helper
// ---------------------------------------------------------------------------

export async function callApi<T = any>(url: string, method: string, body?: unknown): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: 'Network error — check your connection and try again.' } as T & { error?: string } };
  }
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} aria-labelledby={titleId} onClose={onClose} onCancel={onClose}>
      {open && (
        <div className="flex flex-col max-h-[85vh]">
          <div className="px-5 pt-5 pb-3 border-b border-zayro-border">
            <h2 id={titleId} className="text-lg font-semibold text-zayro-dark">
              {title}
            </h2>
          </div>
          <div className="px-5 py-4 overflow-y-auto text-sm">{children}</div>
          {footer && <div className="px-5 py-4 border-t border-zayro-border flex flex-wrap justify-end gap-2">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

// ---------------------------------------------------------------------------
// ActionButton: POST/PATCH/DELETE with optional confirmation
// ---------------------------------------------------------------------------

export function ActionButton({
  url,
  method = 'POST',
  body,
  label,
  className = 'crm-btn',
  confirm,
  successMessage,
  redirectTo,
  disabled,
}: {
  url: string;
  method?: 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  label: React.ReactNode;
  className?: string;
  confirm?: { title: string; body: React.ReactNode; confirmLabel: string; danger?: boolean };
  successMessage?: string;
  redirectTo?: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const run = async () => {
    setBusy(true);
    const res = await callApi(url, method, body);
    setBusy(false);
    setOpen(false);
    if (!res.ok) {
      toast('error', res.data?.error || `Request failed (${res.status})`);
      return;
    }
    toast('success', successMessage || res.data?.message || 'Done');
    if (redirectTo) router.push(redirectTo);
    else router.refresh();
  };

  return (
    <>
      <button type="button" className={className} disabled={busy || disabled} onClick={() => (confirm ? setOpen(true) : run())} aria-busy={busy}>
        {busy ? 'Working…' : label}
      </button>
      {confirm && (
        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          title={confirm.title}
          footer={
            <>
              <button type="button" className="crm-btn" onClick={() => setOpen(false)} disabled={busy}>
                Keep as is
              </button>
              <button type="button" className={confirm.danger ? 'crm-btn crm-btn-danger' : 'crm-btn crm-btn-primary'} onClick={run} disabled={busy}>
                {busy ? 'Working…' : confirm.confirmLabel}
              </button>
            </>
          }
        >
          {confirm.body}
        </Dialog>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Form helpers
// ---------------------------------------------------------------------------

/** Submits the form's fields as JSON; `transform` can shape the payload. */
export function useJsonSubmit(opts: {
  url: string;
  method?: 'POST' | 'PATCH' | 'DELETE';
  successMessage?: string;
  onSuccess?: (data: any) => void;
  refresh?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (payload: unknown) => {
    setBusy(true);
    setError(null);
    const res = await callApi(opts.url, opts.method ?? 'POST', payload);
    setBusy(false);
    if (!res.ok) {
      const message = res.data?.error || `Request failed (${res.status})`;
      setError(message);
      toast('error', message);
      return null;
    }
    if (opts.successMessage) toast('success', opts.successMessage);
    opts.onSuccess?.(res.data);
    if (opts.refresh !== false) router.refresh();
    return res.data;
  };
  return { submit, busy, error, setError };
}

export function FormError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="form-error-banner" role="alert">
      {error}
    </p>
  );
}

export function formToObject(form: HTMLFormElement): Record<string, string> {
  const data = new FormData(form);
  const out: Record<string, string> = {};
  data.forEach((value, key) => {
    if (typeof value === 'string') out[key] = value;
  });
  return out;
}
