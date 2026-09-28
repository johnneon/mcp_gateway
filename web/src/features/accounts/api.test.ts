import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyResponse, jsonResponse, mockFetch } from '@/test/mockFetch';
import { checkAccount, createAccount, deleteAccount, listAccounts, patchAccount } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('accounts api', () => {
  it('listAccounts GETs /api/accounts', async () => {
    const rows = [
      {
        id: 'a1',
        connector: 'fake',
        label: 'Box',
        enabled: true,
        values: { user: 'alice' },
      },
    ];
    const { calls } = mockFetch((url, _init, call) => {
      if (call.method === 'GET' && url === '/api/accounts') {
        return jsonResponse(rows);
      }
      throw new Error(`unexpected ${call.method} ${url}`);
    });

    await expect(listAccounts()).resolves.toEqual(rows);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.url).toBe('/api/accounts');
    expect(calls[0]?.headers.has('Content-Type')).toBe(false);
  });

  it('createAccount POSTs JSON body with Content-Type', async () => {
    const created = {
      id: 'a1',
      connector: 'fake',
      label: 'Box',
      enabled: true,
      values: { user: 'alice' },
    };
    const { calls } = mockFetch((url, _init, call) => {
      if (call.method === 'POST' && url === '/api/accounts') {
        return jsonResponse(created, 201);
      }
      throw new Error(`unexpected ${call.method} ${url}`);
    });

    const input = {
      connector: 'fake',
      label: 'Box',
      values: { user: 'alice', token: 'secret' },
    };
    await expect(createAccount(input)).resolves.toEqual(created);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('/api/accounts');
    expect(calls[0]?.headers.get('Content-Type')).toBe('application/json');
    expect(calls[0]?.body).toBe(JSON.stringify(input));
  });

  it('patchAccount PATCHes /api/accounts/:id with JSON body', async () => {
    const updated = {
      id: 'a1',
      connector: 'fake',
      label: 'Box',
      enabled: false,
      values: { user: 'alice' },
    };
    const { calls } = mockFetch((url, _init, call) => {
      if (call.method === 'PATCH' && url === '/api/accounts/a1') {
        return jsonResponse(updated);
      }
      throw new Error(`unexpected ${call.method} ${url}`);
    });

    await expect(patchAccount('a1', { enabled: false })).resolves.toEqual(updated);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('PATCH');
    expect(calls[0]?.url).toBe('/api/accounts/a1');
    expect(calls[0]?.headers.get('Content-Type')).toBe('application/json');
    expect(calls[0]?.body).toBe(JSON.stringify({ enabled: false }));
  });

  it('checkAccount POSTs /api/accounts/:id/check with Content-Type', async () => {
    const { calls } = mockFetch((url, _init, call) => {
      if (call.method === 'POST' && url === '/api/accounts/a1/check') {
        return emptyResponse(200);
      }
      throw new Error(`unexpected ${call.method} ${url}`);
    });

    await expect(checkAccount('a1')).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('/api/accounts/a1/check');
    expect(calls[0]?.headers.get('Content-Type')).toBe('application/json');
  });

  it('deleteAccount DELETEs /api/accounts/:id with Content-Type', async () => {
    const { calls } = mockFetch((url, _init, call) => {
      if (call.method === 'DELETE' && url === '/api/accounts/a1') {
        return emptyResponse(204);
      }
      throw new Error(`unexpected ${call.method} ${url}`);
    });

    await expect(deleteAccount('a1')).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('DELETE');
    expect(calls[0]?.url).toBe('/api/accounts/a1');
    expect(calls[0]?.headers.get('Content-Type')).toBe('application/json');
  });
});
