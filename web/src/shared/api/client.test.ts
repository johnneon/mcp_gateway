import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest } from './client';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiRequest', () => {
  it('sets Content-Type application/json on POST', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/api/configurations', { method: 'POST', body: { name: 'Ops' } });

    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ name: 'Ops' }));
  });

  it('sets Content-Type application/json on PATCH', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'c1', enabled: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/api/configurations/c1', { method: 'PATCH', body: { enabled: false } });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
  });

  it('sets Content-Type application/json on DELETE without a body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/api/configurations/c1', { method: 'DELETE' });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
    expect(init.body).toBeUndefined();
  });

  it('does not force Content-Type on GET', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/api/configurations');

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).has('Content-Type')).toBe(false);
  });

  it('throws ApiError with English plain-text body', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('Not Found', { status: 404, statusText: 'Not Found' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiRequest('/api/configurations/missing')).rejects.toSatisfy((error: unknown) => {
      return error instanceof ApiError && error.status === 404 && error.message === 'Not Found';
    });
  });

  it('throws ApiError with a status-based English message when the body is empty', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiRequest('/api/configurations')).rejects.toSatisfy((error: unknown) => {
      return (
        error instanceof ApiError &&
        error.status === 500 &&
        error.message === 'Request failed with status 500'
      );
    });
  });
});
