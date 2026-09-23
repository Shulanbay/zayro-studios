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
    <div className="min-h-screen flex items-center justify-center bg-zayro-bg px-4">
      <div className="bg-white border border-zayro-bg p-8 md:p-12 max-w-md w-full">
        <h1 className="text-3xl font-black mb-2">ADMIN SIGN IN</h1>
        <p className="text-zayro-gray mb-8">ZAYRO Studios</p>

        {urlError && !sent && (
          <p className="text-red-600 text-sm mb-6">
            {urlError === 'invalid_or_expired' ? 'That sign-in link expired or was already used. Request a new one below.' : 'Sign-in failed. Please try again.'}
          </p>
        )}

        {sent ? (
          <p className="text-zayro-gray">
            If that email is an admin account, a sign-in link was just sent. Check your inbox — the link expires in 15 minutes.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="email"
              required
              placeholder="you@zayro.studio"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full p-4 border border-zayro-bg text-lg"
            />
            <button type="submit" disabled={loading} className="button button-primary w-full py-3 disabled:opacity-50">
              {loading ? 'Sending...' : 'Send sign-in link'}
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
