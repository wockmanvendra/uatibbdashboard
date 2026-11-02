/**
 * Typed fetch wrapper. (§8.2)
 *
 * Every request passes an AbortSignal: a user clicking through six months fires
 * six requests, and the five stale ones must be aborted rather than racing to
 * paint. TanStack supplies the signal; this file must forward it.
 */
import type {
  ApiError,
  FiltersResponse,
  LoginResponse,
  DetailListId,
  DetailListResponse,
  OtpRequestBody,
  OtpRequestResponse,
  OtpVerifyBody,
  TabResponse,
  VersionResponse,
} from '../types/api';
import type { Filters } from '../queries/keys';
import { useAuthStore } from '../auth/authStore';

const BASE = '/api';

export class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
    this.status = status;
  }
}

interface RequestOptions {
  signal?: AbortSignal;
  /** Sent as JSON with POST. */
  body?: object;
}

async function request<T>(path: string, { signal, body }: RequestOptions = {}): Promise<T> {
  const token = useAuthStore.getState().token;
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: body ? 'POST' : 'GET',
      signal: signal ?? null,
      headers,
      body: body ? JSON.stringify(body) : null,
    });
  } catch (err) {
    // An aborted request is not a failure — let TanStack discard it quietly.
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiRequestError(
      'NETWORK',
      'Could not reach the dashboard service. Check your connection and try again.',
      0,
    );
  }

  if (!res.ok) {
    let code = 'INTERNAL';
    let message = 'Something went wrong loading this dashboard. Try again in a moment.';
    try {
      const body = (await res.json()) as ApiError;
      if (body?.error?.code) code = body.error.code;
      if (body?.error?.message) message = body.error.message;
    } catch {
      // A non-JSON error body means a proxy or gateway answered, not the API.
    }
    // The session expired or was revoked: drop it so the app returns to sign-in.
    // Only if it is still the session this request carried — the user may
    // already have signed in again while it was in flight.
    if (res.status === 401 && token && useAuthStore.getState().token === token) {
      useAuthStore.getState().signOut();
    }
    throw new ApiRequestError(code, message, res.status);
  }

  return (await res.json()) as T;
}

/** Repeated params (?zone=A&zone=B) — sorted so the URL is stable per filter set. */
function toQuery(f: Filters): string {
  const p = new URLSearchParams();
  p.set('from', String(f.from));
  p.set('to', String(f.to));
  for (const key of ['division', 'brand', 'zone', 'region', 'hq'] as const) {
    for (const v of [...f[key]].sort()) p.append(key, v);
  }
  return p.toString();
}

export const fetchTab = (tab: string, filters: Filters, signal?: AbortSignal) =>
  request<TabResponse>(`/dashboard/${tab}?${toQuery(filters)}`, { signal });

export interface DetailQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  /** Chosen facet values by facet key ('all' for no filter). */
  facets?: Record<string, string>;
  /** The whole list (up to 50,000 rows), for the CSV export. */
  all?: boolean;
}

/** A detail list behind a clickable figure, for the dashboard's filters. */
export function fetchDetailList(list: DetailListId, filters: Filters, q: DetailQuery, signal?: AbortSignal) {
  const p = new URLSearchParams(toQuery(filters));
  if (q.all) p.set('all', 'true');
  else {
    p.set('page', String(q.page ?? 1));
    p.set('pageSize', String(q.pageSize ?? 100));
  }
  if (q.search?.trim()) p.set('search', q.search.trim());
  for (const [k, v] of Object.entries(q.facets ?? {})) if (v) p.set(k, v);
  return request<DetailListResponse>(`/details/${list}?${p.toString()}`, { signal });
}

export const fetchDataVersion = (signal?: AbortSignal) =>
  request<VersionResponse>('/meta/version', { signal });

export const requestOtp = (mobile: string) =>
  request<OtpRequestResponse>('/auth/otp/request', { body: { mobile } satisfies OtpRequestBody });

export const verifyOtp = (mobile: string, otp: string) =>
  request<LoginResponse>('/auth/otp/verify', { body: { mobile, otp } satisfies OtpVerifyBody });

export function fetchFilterOptions(
  sel: { division: string[]; zone: string[]; region: string[] },
  signal?: AbortSignal,
) {
  const p = new URLSearchParams();
  for (const key of ['division', 'zone', 'region'] as const) {
    for (const v of [...sel[key]].sort()) p.append(key, v);
  }
  const qs = p.toString();
  return request<FiltersResponse>(`/meta/filters${qs ? `?${qs}` : ''}`, { signal });
}
