import { Capacitor } from '@capacitor/core';
import type { ApiErrorBody } from '#shared';

/** True inside the Android/iOS app (Capacitor), false in a browser. */
export const isNative = Capacitor.isNativePlatform();

/**
 * Browsers talk to the same origin (the API serves the web app in production, and
 * Vite proxies /api in development) and authenticate with an httpOnly cookie.
 * The native app is built with VITE_API_URL pointing at the server and uses a
 * bearer token instead, since cookies don't cross from the app's own origin.
 */
const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';
const TOKEN_KEY = 'lore.token';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;

  constructor(status: number, body: ApiErrorBody | null) {
    super(body?.error.message ?? 'Something went wrong. Check your connection and try again.');
    this.status = status;
    this.code = body?.error.code ?? 'network';
    this.fields = body?.error.fields ?? {};
  }
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
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    h['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  try {
    return await fetch(`${BASE}/api${path}`, { method, headers: h, body: payload, credentials: 'include' });
  } catch {
    throw new ApiError(0, null);
  }
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
