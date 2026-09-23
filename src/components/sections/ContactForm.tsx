'use client';

import { useEffect, useState } from 'react';

export default function ContactForm() {
  const [form, setForm] = useState({ name: '', email: '', message: '', topic: '' });

  // Prefill from ?topic= (set by "Request Monthly Package" / "Request
  // On-location Shoot" buttons on the pricing page).
  useEffect(() => {
    try {
      const topic = new URLSearchParams(window.location.search).get('topic')?.trim().slice(0, 200);
      if (topic) {
        setForm((f) => ({
          ...f,
          topic,
          message: f.message || `Hi, I'd like to request: ${topic}.\n\nPreferred start date:\n`,
        }));
      }
    } catch {
      // ignore malformed URLs
    }
  }, []);
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('sending');
    setError(null);

    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to send message');
      }

      setStatus('sent');
      setForm({ name: '', email: '', message: '', topic: '' });
    } catch (err: any) {
      setStatus('error');
      setError(err.message || 'Something went wrong. Please email us directly.');
    }
  };

  if (status === 'sent') {
    return (
      <div className="max-w-xl mx-auto text-center card">
        <h2 className="text-2xl font-bold mb-2 text-zayro-dark">Message sent</h2>
        <p className="text-zayro-gray">Thanks for reaching out — we'll get back to you soon.</p>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto card">
      <h2 className="text-2xl font-bold mb-6 text-center text-zayro-dark">Send us a Message</h2>

      <form className="space-y-5" onSubmit={handleSubmit}>
        {form.topic && (
          <div>
            <label htmlFor="contact-topic" className="field-label">Regarding</label>
            <input
              id="contact-topic"
              type="text"
              value={form.topic}
              onChange={(e) => setForm((f) => ({ ...f, topic: e.target.value.slice(0, 200) }))}
            />
          </div>
        )}

        <div>
          <label htmlFor="contact-name" className="field-label">Name</label>
          <input
            id="contact-name"
            type="text"
            autoComplete="name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            required
          />
        </div>

        <div>
          <label htmlFor="contact-email" className="field-label">Email</label>
          <input
            id="contact-email"
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            required
          />
        </div>

        <div>
          <label htmlFor="contact-message" className="field-label">Message</label>
          <textarea
            id="contact-message"
            rows={6}
            value={form.message}
            onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
            required
          />
        </div>

        {error && <p className="field-error" role="alert">{error}</p>}

        <button type="submit" disabled={status === 'sending'} className="button button-primary w-full disabled:opacity-50">
          {status === 'sending' ? 'Sending...' : 'Send Message'}
        </button>
      </form>
    </div>
  );
}
