import { Capacitor } from '@capacitor/core';
import type { ApiErrorBody } from '#shared';
import { copy } from '#shared/copy';
import { serverCopy, stripMarkers } from './copy/runtime.ts';

/** True inside the Android/iOS app (Capacitor), false in a browser. */
export const isNative = Capacitor.isNativePlatform();

/**
 * Browsers talk to the same origin (the API serves the web app in production, and
 * Vite proxies /api in development) and authenticate with an httpOnly cookie.
 * The native app talks to the server over HTTPS with a bearer token, since cookies
 * don't cross from the app's own origin. Where that server is comes from the build
 * (VITE_API_URL, for the copy inside the APK) or from a meta tag the server fills in
 * when it packages a live update.
 */
const BASE = (
  (import.meta.env.VITE_API_URL as string | undefined) ||
  document.querySelector<HTMLMetaElement>('meta[name="lore-api-base"]')?.content ||
  ''
).replace(/\/$/, '');
const TOKEN_KEY = 'lore.token';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;

  constructor(status: number, body: ApiErrorBody | null) {
    // Static server messages can be reworded live by the owner (lib/copy, "srv#" keys).
    super(body?.error.message ? serverCopy(body.error.message) : copy('Something went wrong. Check your connection and try again.'));
    this.status = status;
    this.code = body?.error.code ?? 'network';
    // Field messages may be reworded; ids (`{ chapterId: <uuid> }` on a 409) are data and stay exactly as sent.
    this.fields = Object.fromEntries(Object.entries(body?.error.fields ?? {}).map(([k, m]) => [k, UUID.test(m) ? m : serverCopy(m)]));
  }
}

/**
 * Live text (lib/copy/sync.ts): every API response says which version of LORE's words is published, in
 * the `x-lore-copy` header. Sync compares it with what it shows and fetches the new words when it differs.
 */
let copyVersionListener: ((version: string) => void) | null = null;
export function onCopyVersion(listener: ((version: string) => void) | null) {
  copyVersionListener = listener;
}

/**
 * Edit markers (invisible characters the owner's edit mode adds to texts) never leave the device: they are
 * stripped from every JSON string and form field, always, since a draft started in edit mode can outlive it.
 */
function cleanJson(body: unknown): string {
  return JSON.stringify(body, (_key, value: unknown) => (typeof value === 'string' ? stripMarkers(value) : value));
}

function cleanForm(form: FormData): FormData {
  let marked = false;
  for (const [, value] of form) if (typeof value === 'string' && stripMarkers(value) !== value) marked = true;
  if (!marked) return form;
  const out = new FormData();
  for (const [name, value] of form) out.append(name, typeof value === 'string' ? stripMarkers(value) : value);
  return out;
}

function token(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setNativeToken(value: string | null) {
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage unavailable: cookie auth still works on the web.
  }
}

function headers(): Record<string, string> {
  const h: Record<string, string> = {};
  const bearer = token();
  if (bearer) h.authorization = `Bearer ${bearer}`;
  if (isNative) h['x-lore-client'] = 'native';
  return h;
}

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  const h = headers();
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = cleanForm(body);
  else if (body !== undefined) {
    h['content-type'] = 'application/json';
    payload = cleanJson(body);
  }
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, { method, headers: h, body: payload, credentials: 'include' });
  } catch {
    throw new ApiError(0, null);
  }
  const copyVersion = res.headers.get('x-lore-copy');
  if (copyVersion !== null) copyVersionListener?.(copyVersion);
  return res;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await send(method, path, body);
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data as ApiErrorBody | null);
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
  upload: <T>(path: string, file: Blob, filename: string) => {
    const form = new FormData();
    form.append('file', file, filename);
    return request<T>('POST', path, form);
  },
  /** Fetches a file with the user's credentials and hands it to the browser to save. */
  download: async (path: string, filename: string) => {
    const res = await send('GET', path);
    if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => null)) as ApiErrorBody | null);
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  },
};

export const qs = (params: Record<string, string | number | undefined | null>) => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return entries.length ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)]))}` : '';
};

/** Photo URLs from the API are signed paths; native apps need the server in front. */
export function mediaSrc(url: string | null | undefined): string | undefined {
  return url ? `${BASE}${url}` : undefined;
}
