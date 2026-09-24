export const dynamic = 'force-dynamic';

export const metadata = { title: 'Confirm sign-in | ZAYRO Studios Admin', robots: { index: false, follow: false } };

export default function ConfirmSignInPage({ searchParams }: { searchParams: { token?: string } }) {
  const token = typeof searchParams.token === 'string' ? searchParams.token : '';
  return (
    <div className="min-h-screen flex items-center justify-center surface-soft px-4">
      <div className="card max-w-md w-full">
        <h1 className="text-2xl font-black mb-1 text-zayro-dark">Sign in to Admin</h1>
        <p className="text-zayro-gray mb-8 text-sm">ZAYRO Studios</p>
        {token ? (
          <form method="post" action="/api/admin/verify">
            <input type="hidden" name="token" value={token} />
            <button type="submit" className="button button-primary w-full py-3">
              Continue to Admin
            </button>
            <p className="text-xs text-zayro-gray mt-4">This link works once and expires 15 minutes after it was sent.</p>
          </form>
        ) : (
          <p className="field-error" role="alert">
            This sign-in link is incomplete. <a href="/admin/login">Request a new one.</a>
          </p>
        )}
      </div>
    </div>
  );
}
