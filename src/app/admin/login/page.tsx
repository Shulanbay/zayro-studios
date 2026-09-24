'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function LoginForm() {
  const searchParams = useSearchParams();
  const urlError = searchParams.get('error');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await fetch('/api/admin/request-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      setSent(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center surface-soft px-4">
      <div className="card max-w-md w-full">
        <h1 className="text-2xl font-black mb-1 text-zayro-dark">Admin Sign In</h1>
        <p className="text-zayro-gray mb-8 text-sm">ZAYRO Studios</p>

        {urlError && !sent && (
          <p className="field-error mb-6" role="alert">
            {urlError === 'invalid_or_expired'
              ? 'That sign-in link expired or is not valid. Request a new one below.'
              : urlError === 'already_used'
                ? 'That sign-in link was already used. Request a new one below.'
                : urlError === 'rate_limited'
                  ? 'Too many attempts. Wait a few minutes and try again.'
                  : 'Sign-in failed. Please try again.'}
          </p>
        )}

        {sent ? (
          <p className="text-zayro-gray" role="status">
            If that email is an admin account, a sign-in link was just sent. Check your inbox — the link expires in 15 minutes and can only be used once.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="admin-email" className="field-label">
                Email
              </label>
              <input
                id="admin-email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@zayro.studio"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <button type="submit" disabled={loading} className={`button button-primary w-full py-3 ${loading ? 'is-loading' : ''}`}>
              Send Sign-in Link
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
