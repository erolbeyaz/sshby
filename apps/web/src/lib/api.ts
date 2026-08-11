import type { ApiError } from '@sshby/shared';

/**
 * Tek origin varsayımı: üretimde nginx `/api`yi api servisine proxy'ler,
 * geliştirmede Vite aynısını yapar. Bu yüzden mutlak URL kurmuyoruz.
 */
const BASE = '/api';

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let accessToken: string | null = null;

/** Access token yalnızca bellekte tutulur; refresh token httpOnly cookie'de. */
export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/**
 * Access token süresi dolduğunda çağrılacak yenileme işlevi. Auth store bunu
 * kaydeder; burada doğrudan store'u import etmek dairesel bağımlılık yaratırdı.
 */
type RefreshFn = () => Promise<boolean>;
let refreshHandler: RefreshFn | null = null;
let inFlightRefresh: Promise<boolean> | null = null;

export function setRefreshHandler(fn: RefreshFn | null): void {
  refreshHandler = fn;
}

/** Aynı anda düşen birden çok 401'in tek bir yenileme isteği tetiklemesi için. */
async function refreshOnce(): Promise<boolean> {
  if (!refreshHandler) return false;
  inFlightRefresh ??= refreshHandler().finally(() => {
    inFlightRefresh = null;
  });
  return inFlightRefresh;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  try {
    return await rawFetch<T>(path, init);
  } catch (err) {
    // Access token süresi dolmuşsa bir kez yenileyip isteği tekrarla.
    const expired = err instanceof ApiRequestError && err.status === 401 && !path.startsWith('/auth/');
    if (!expired) throw err;

    const refreshed = await refreshOnce();
    if (!refreshed) throw err;
    return rawFetch<T>(path, init);
  }
}

async function rawFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const body: unknown = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const err = body as Partial<ApiError>;
    throw new ApiRequestError(
      response.status,
      err.error?.code ?? 'unknown',
      err.error?.message ?? `İstek başarısız (HTTP ${response.status})`,
      err.error?.details,
    );
  }

  return body as T;
}
