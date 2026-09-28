import { vi } from 'vitest';

export type MockFetchCall = {
  url: string;
  method: string;
  headers: Headers;
  body: string | null;
};

export type MockFetchHandler = (
  url: string,
  init: RequestInit | undefined,
  call: MockFetchCall,
) => Response | Promise<Response>;

/**
 * Installs a fake fetch that records each call. Restore with the returned function
 * or rely on vi.unstubAllGlobals in afterEach.
 */
export function mockFetch(handler: MockFetchHandler): {
  calls: MockFetchCall[];
  restore: () => void;
} {
  const calls: MockFetchCall[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers);
    const rawBody = init?.body;
    let body: string | null = null;
    if (typeof rawBody === 'string') {
      body = rawBody;
    } else if (rawBody !== undefined && rawBody !== null) {
      body = '[non-string body]';
    }
    const call: MockFetchCall = { url, method, headers, body };
    calls.push(call);
    return handler(url, init, call);
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    calls,
    restore: () => {
      vi.unstubAllGlobals();
    },
  };
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function emptyResponse(status = 204): Response {
  return new Response(null, { status });
}

export function textResponse(body: string, status: number): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
