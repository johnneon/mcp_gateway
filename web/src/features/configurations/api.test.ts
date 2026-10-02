import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, mockFetch } from '@/test/mockFetch';
import {
  createConfiguration,
  getDisabledTools,
  listConfigurations,
  rotateConfiguration,
  setConfigurationAccounts,
  setConfigurationEnabled,
  setDisabledTools,
} from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('configurations api accountIds', () => {
  it('listConfigurations returns accountIds from GET', async () => {
    const rows = [{ id: 'c1', name: 'Ops', enabled: true, accountIds: ['a1'] }];
    const { calls } = mockFetch((url, _init, call) => {
      if (call.method === 'GET' && url === '/api/configurations') {
        return jsonResponse(rows);
      }
      throw new Error(`unexpected ${call.method} ${url}`);
    });

    await expect(listConfigurations()).resolves.toEqual(rows);
    expect(calls[0]?.url).toBe('/api/configurations');
  });

  it('createConfiguration response type includes accountIds', async () => {
    const created = {
      id: 'c1',
      name: 'Ops',
      enabled: true,
      accountIds: [] as string[],
      token: 'tok-once',
    };
    mockFetch((url, _init, call) => {
      if (call.method === 'POST' && url === '/api/configurations') {
        return jsonResponse(created, 201);
      }
      throw new Error(`unexpected ${call.method} ${url}`);
    });

    await expect(createConfiguration('Ops')).resolves.toEqual(created);
  });

  it('setConfigurationEnabled response includes accountIds', async () => {
    const updated = { id: 'c1', name: 'Ops', enabled: false, accountIds: ['a1'] };
    const { calls } = mockFetch((url, _init, call) => {
      if (call.method === 'PATCH' && url === '/api/configurations/c1') {
        return jsonResponse(updated);
      }
      throw new Error(`unexpected ${call.method} ${url}`);
    });

    await expect(setConfigurationEnabled('c1', false)).resolves.toEqual(updated);
    expect(calls[0]?.headers.get('Content-Type')).toBe('application/json');
    expect(calls[0]?.body).toBe(JSON.stringify({ enabled: false }));
  });

  it('rotateConfiguration response includes accountIds', async () => {
    const rotated = {
      id: 'c1',
      name: 'Ops',
      enabled: true,
      accountIds: ['a1'],
      token: 'tok-rotated',
    };
    mockFetch((url, _init, call) => {
      if (call.method === 'POST' && url === '/api/configurations/c1/rotate') {
        return jsonResponse(rotated);
      }
      throw new Error(`unexpected ${call.method} ${url}`);
    });

    await expect(rotateConfiguration('c1')).resolves.toEqual(rotated);
  });

  it('setConfigurationAccounts PUTs full accountIds list', async () => {
    const updated = { id: 'c1', name: 'Ops', enabled: true, accountIds: ['a2', 'a1'] };
    const { calls } = mockFetch((url, _init, call) => {
      if (call.method === 'PUT' && url === '/api/configurations/c1/accounts') {
        return jsonResponse(updated);
      }
      throw new Error(`unexpected ${call.method} ${url}`);
    });

    await expect(setConfigurationAccounts('c1', ['a2', 'a1'])).resolves.toEqual(updated);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('PUT');
    expect(calls[0]?.url).toBe('/api/configurations/c1/accounts');
    expect(calls[0]?.headers.get('Content-Type')).toBe('application/json');
    expect(calls[0]?.body).toBe(JSON.stringify({ accountIds: ['a2', 'a1'] }));
  });

  it('setDisabledTools PUTs the full toolNames replacement', async () => {
    const { calls } = mockFetch((url, _init, call) => {
      if (call.method === 'PUT' && url === '/api/configurations/c1/accounts/a1/disabled-tools') {
        return jsonResponse({ toolNames: ['fake_drop'] });
      }
      throw new Error(`unexpected ${call.method} ${url}`);
    });

    await expect(setDisabledTools('c1', 'a1', ['fake_drop'])).resolves.toEqual({
      toolNames: ['fake_drop'],
    });
    expect(calls[0]?.headers.get('Content-Type')).toBe('application/json');
    expect(calls[0]?.body).toBe(JSON.stringify({ toolNames: ['fake_drop'] }));
  });

  it('getDisabledTools reads the stored names', async () => {
    mockFetch((url, _init, call) => {
      if (call.method === 'GET' && url === '/api/configurations/c1/accounts/a1/disabled-tools') {
        return jsonResponse({ toolNames: [] });
      }
      throw new Error(`unexpected ${call.method} ${url}`);
    });

    await expect(getDisabledTools('c1', 'a1')).resolves.toEqual({ toolNames: [] });
  });
});
