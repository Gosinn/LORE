export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string> | undefined;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export const badRequest = (message: string, fields?: Record<string, string>) =>
  new HttpError(400, 'bad_request', message, fields);
export const unauthorized = (message = 'Sign in to continue.') => new HttpError(401, 'unauthorized', message);
export const forbidden = (message = "You can't do that here.") => new HttpError(403, 'forbidden', message);
/** Also used when something exists but the viewer may not know that it does. */
export const notFound = (what = 'That') => new HttpError(404, 'not_found', `${what} could not be found.`);
export const conflict = (message: string, fields?: Record<string, string>) =>
  new HttpError(409, 'conflict', message, fields);

/** Postgres unique_violation, whether raised by pg, PGlite, or wrapped by Drizzle. */
export function isUniqueViolation(err: unknown): boolean {
  for (let e = err as { code?: string; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
    if (e.code === '23505') return true;
  }
  return false;
}
