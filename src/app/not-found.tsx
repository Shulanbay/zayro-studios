import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-[70vh] flex items-center justify-center surface-soft">
      <div className="container max-w-xl text-center py-24">
        <p className="text-sm font-bold text-zayro-primary tracking-wide mb-4">404</p>
        <h1 className="text-4xl md:text-5xl font-black mb-4 text-zayro-dark">Page not found</h1>
        <p className="text-zayro-gray mb-10">
          The page you're looking for doesn't exist or may have moved.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link href="/" className="button button-primary">
            Back to Home
          </Link>
          <Link href="/booking" className="button button-secondary">
            Book a Session
          </Link>
        </div>
      </div>
    </div>
  );
}
