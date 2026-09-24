import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

/** An expected, user-facing failure of a CRM operation. */
export class CrmError extends Error {
  constructor(
    message: string,
    public status: number = 400,
    public code?: string
  ) {
    super(message);
    this.name = 'CrmError';
  }
}

export const conflict = (message: string) => new CrmError(message, 409, 'conflict');
export const notFound = (what: string) => new CrmError(`${what} not found`, 404, 'not_found');

/** Maps an error from a CRM operation to a JSON response without leaking internals. */
export function errorResponse(error: unknown, context: string): NextResponse {
  if (error instanceof CrmError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof ZodError) {
    const first = error.issues[0];
    return NextResponse.json({ error: `${first.path.join('.') || 'input'}: ${first.message}` }, { status: 400 });
  }
  console.error(`[crm] ${context} failed:`, (error as Error)?.message || error);
  return NextResponse.json({ error: 'Something went wrong. Nothing was changed if the action did not complete — reload and check.' }, { status: 500 });
}
