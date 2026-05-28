import { NextResponse, type NextRequest } from "next/server";

export type EnvelopeSuccess<T> = { success: true; data: T; duration: number };
export type EnvelopeFailure = { success: false; error: string; duration: number };
export type Envelope<T> = EnvelopeSuccess<T> | EnvelopeFailure;

/**
 * Bart's `clientError` ported to TS — an error whose message is safe to expose to clients.
 */
export class ClientError extends Error {
  readonly statusCode: number;
  readonly expose = true;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function clientError(message: string, statusCode = 400): ClientError {
  return new ClientError(message, statusCode);
}

/**
 * Wrap a Next.js route handler. Returns `{ success, data, duration }` envelope on success
 * and `{ success: false, error, duration }` on failure. Mirrors `bart-app/server/lib/route-helpers.js`.
 */
export function withHandler<T>(
  fn: (req: NextRequest) => Promise<T> | T,
): (req: NextRequest) => Promise<NextResponse<Envelope<T>>> {
  return async (req) => {
    const start = Date.now();
    try {
      const data = await fn(req);
      return NextResponse.json<EnvelopeSuccess<T>>({
        success: true,
        data,
        duration: Date.now() - start,
      });
    } catch (err) {
      const isClient = err instanceof ClientError;
      const statusCode = isClient ? err.statusCode : 500;
      const message = isClient ? err.message : "Internal server error";
      if (!isClient) {
        console.error("[api]", req.method, req.nextUrl.pathname, err);
      }
      return NextResponse.json<EnvelopeFailure>(
        { success: false, error: message, duration: Date.now() - start },
        { status: statusCode },
      );
    }
  };
}
