'use client';

export default function CrmError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="card max-w-lg">
      <h1 className="text-lg font-semibold text-zayro-dark">This page couldn&apos;t load</h1>
      <p className="text-sm text-zayro-gray mt-1">Nothing was changed. Try again; if it keeps happening, check Integrations for errors.</p>
      <button type="button" className="crm-btn crm-btn-primary mt-4" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
