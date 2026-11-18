// The app log's error serializer. A failed database query (drizzle-orm's DrizzleQueryError) carries
// the values bound to it in its message, stack and `params`, and Postgres errors carry row values
// in `detail`: logged as they are, a wish, its context or a scroll could reach the log. This keeps
// the query text (placeholders only), the error codes and the stack frames, never a bound value.
import { DrizzleQueryError } from 'drizzle-orm';

const MAX_DEPTH = 3;

export interface SafeErr {
  type: string;
  message: string;
  stack: string;
  [key: string]: unknown;
}

/** The Postgres error code (SQLSTATE) of a driver error, if any. */
const codeOf = (e: unknown): string | null => {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === 'string' || typeof code === 'number' ? String(code) : null;
};

/** The stack's frames only (never the message lines above them, which may hold values). */
const framesOf = (e: Error) =>
  (e.stack ?? '')
    .split('\n')
    .filter((line) => /^\s+at /.test(line))
    .join('\n');

/** True when this error or one it wraps is a failed query. */
function wrapsQueryError(err: unknown): boolean {
  let e: unknown = err;
  for (let d = 0; e instanceof Error && d <= MAX_DEPTH + 1; d++) {
    if (e instanceof DrizzleQueryError) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

function serialize(err: unknown, depth: number): SafeErr {
  if (!(err instanceof Error)) return { type: typeof err, message: String(err), stack: '' };
  if (err instanceof DrizzleQueryError) {
    return {
      type: 'DrizzleQueryError',
      message: `Failed query: ${err.query}`,
      stack: `DrizzleQueryError: Failed query: ${err.query}\n${framesOf(err)}`,
      query: err.query,
      code: codeOf(err.cause),
      ...(err.cause ? { cause: { type: err.cause.name, code: codeOf(err.cause) } } : {}),
    };
  }
  const e = err as Error & Record<string, unknown>;
  const out: SafeErr = { type: e.name, message: e.message, stack: e.stack ?? '' };
  for (const key of ['code', 'statusCode', 'status', 'failure', 'requestId']) {
    const v = e[key];
    if (typeof v === 'string' || typeof v === 'number') out[key] = v;
  }
  if (e.cause !== undefined && depth < MAX_DEPTH) out.cause = serialize(e.cause, depth + 1);
  // Anything that wraps a failed query loses its own message too: it may repeat the query's.
  if (wrapsQueryError(e.cause)) {
    out.message = `${e.name} (a database query failed)`;
    out.stack = `${e.name}: (a database query failed)\n${framesOf(e)}`;
  }
  return out;
}

/** pino `err` serializer (Fastify's logger option `serializers.err`). */
export function safeErr(err: unknown): SafeErr {
  return serialize(err, 0);
}
