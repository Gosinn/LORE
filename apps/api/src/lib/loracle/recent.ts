// The Loracle's last failures, for the owner's eyes only (GET /api/admin/loracle/failures, Moderation →
// "Loracle"). The production log says the same, but the owner can't always reach the host's logs; this
// shows why a road or an ask failed (the API's own words, or where in the code) without them.
//
// In memory only: emptied when the server restarts or sleeps. Never the wish, the Lorer or the road's
// text: the kind, the failure code, the HTTP status, the API's error type and message (which name
// parameters, not the request's content), the request id and the place in our code.
import { APIError } from '@anthropic-ai/sdk';

export interface LoracleFailureNote {
  at: string;
  kind: 'road' | 'ask';
  /** The job's failure code: error, timeout, overloaded, interrupted. */
  failure: string;
  attempt: number;
  ms: number;
  status: number | null;
  errorType: string | null;
  reason: string | null;
  /** Where in our code it was thrown (the first frames under src/), for errors that are not the API's. */
  where: string | null;
  requestId: string | null;
}

const MAX_NOTES = 30;
const notes: LoracleFailureNote[] = [];

export function noteFailure(note: LoracleFailureNote): void {
  notes.unshift(note);
  if (notes.length > MAX_NOTES) notes.length = MAX_NOTES;
}

export function recentFailures(): LoracleFailureNote[] {
  return notes.map((n) => ({ ...n }));
}

/** For tests. */
export function forgetFailures(): void {
  notes.length = 0;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * What a failure was, from the error the job caught: the mind's MindError carries the original error as
 * its cause (a CutOff carries the API's). The first APIError on the chain wins; otherwise the deepest error.
 */
export function describeFailure(err: unknown): Pick<LoracleFailureNote, 'status' | 'errorType' | 'reason' | 'where' | 'requestId'> {
  const chain: unknown[] = [];
  let e: unknown = err;
  for (let i = 0; i < 6 && e; i++) {
    chain.push(e);
    e = e instanceof Error ? (e as Error & { cause?: unknown }).cause : undefined;
  }
  const api = chain.find((x): x is APIError => x instanceof APIError);
  const requestId = (chain.find((x) => x && typeof x === 'object' && typeof (x as { requestId?: unknown }).requestId === 'string') as
    | { requestId: string }
    | undefined)?.requestId;
  if (api) {
    const body = (api as { error?: { error?: { type?: unknown; message?: unknown } } }).error?.error;
    return {
      status: typeof api.status === 'number' ? api.status : null,
      errorType: typeof body?.type === 'string' ? body.type : typeof api.type === 'string' ? api.type : null,
      reason: clip(typeof body?.message === 'string' ? body.message : api.message, 400),
      where: null,
      requestId: api.requestID ?? requestId ?? null,
    };
  }
  const deepest = [...chain].reverse().find((x): x is Error => x instanceof Error);
  if (!deepest) return { status: null, errorType: null, reason: null, where: null, requestId: requestId ?? null };
  const where =
    (deepest.stack ?? '')
      .split('\n')
      .filter((l) => /[\\/]src[\\/]/.test(l))
      .slice(0, 3)
      .map((l) => {
        const frame = l.trim().replace(/^at\s+/, '');
        const fn = /^(\S+)\s+\(/.exec(frame)?.[1];
        const path = frame.replace(/^.*[\\/]src[\\/]/, 'src/').replace(/\)$/, '');
        return fn ? `${fn} ${path}` : path;
      })
      .join(' ← ') || null;
  return {
    status: null,
    errorType: deepest.name,
    reason: clip(deepest.message, 200),
    where,
    requestId: requestId ?? null,
  };
}
