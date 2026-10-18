import type { ApiErrorBody } from '#shared';

/**
 * Same-origin by default (the API serves the web app in production, and Vite
 * proxies /api in development). Native shells set VITE_API_URL and use a bearer
 * token instead of the cookie.
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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const bearer = token();
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, { method, headers, body: payload, credentials: 'include' });
  } catch {
    throw new ApiError(0, null);
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data as ApiErrorBody | null);
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, file: Blob, filename: string) => {
    const form = new FormData();
    form.append('file', file, filename);
    return request<T>('POST', path, form);
  },
};

export const qs = (params: Record<string, string | number | undefined | null>) => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return entries.length ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)]))}` : '';
};

export function mediaSrc(url: string | null | undefined): string | undefined {
  return url ? `${BASE}${url}` : undefined;
}
