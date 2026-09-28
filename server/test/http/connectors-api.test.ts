import type { Express } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { ConnectorModule } from '../../src/connectors/contract.js';
import { buildConnectorRegistry } from '../../src/connectors/registry.js';
import { createAdminApp } from '../../src/http/createAdminApp.js';
import type { JsonObject } from '../../src/store/codec.js';
import type { EncryptedStore } from '../../src/store/store.js';

const CORS_HEADERS = [
  'access-control-allow-origin',
  'access-control-allow-methods',
  'access-control-allow-headers',
  'access-control-allow-credentials',
] as const;

function createMemoryStore(initial: JsonObject = {}): EncryptedStore {
  let document: JsonObject = structuredClone(initial);
  return {
    read(): JsonObject {
      return structuredClone(document);
    },
    replace(next: JsonObject): Promise<void> {
      document = structuredClone(next);
      return Promise.resolve();
    },
  };
}

function assertNoCors(headers: Record<string, unknown>): void {
  for (const name of CORS_HEADERS) {
    expect(headers[name]).toBeUndefined();
  }
}

function createFakeNative(): ConnectorModule {
  return {
    id: 'fake',
    name: 'Fake',
    kind: 'native',
    fields: [
      { name: 'user', label: 'User', type: 'text', required: true },
      { name: 'token', label: 'Token', type: 'secret', required: true },
      { name: 'mailhost', label: 'Mail host', type: 'host', required: true },
    ],
    allowedDestinations: [
      { host: 'imap.example.test', port: 993 },
      { field: 'mailhost', port: 993 },
    ],
    checkConnection: () => undefined,
  };
}

function createAppWithEmptyRegistry(): Express {
  return createAdminApp({
    store: createMemoryStore({}),
    connectorRegistry: buildConnectorRegistry([]),
  });
}

describe('connectors-api: List connectors public description', () => {
  it('Empty registry lists as empty array', async () => {
    const app = createAppWithEmptyRegistry();
    const res = await request(app).get('/api/connectors');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('Fake connector is listed without internals', async () => {
    const fake = createFakeNative();
    const app = createAdminApp({
      store: createMemoryStore({}),
      connectorRegistry: buildConnectorRegistry([fake]),
    });

    const res = await request(app).get('/api/connectors');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: 'fake',
        name: 'Fake',
        kind: 'native',
        fields: [
          { name: 'user', label: 'User', type: 'text', required: true },
          { name: 'token', label: 'Token', type: 'secret', required: true },
          { name: 'mailhost', label: 'Mail host', type: 'host', required: true },
        ],
      },
    ]);

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('imap.example.test');
    expect(serialized).not.toMatch(/:993\b/);
    expect(serialized).not.toContain('993');
    expect(serialized).not.toContain('allowedDestinations');
    expect(serialized).not.toContain('checkConnection');
    expect(serialized).not.toContain('secret-value');
    expect(serialized).not.toMatch(/"token"\s*:\s*"/);
  });
});

describe('connectors-api: GET connectors needs no JSON Content-Type', () => {
  it('GET without Content-Type returns 200', async () => {
    const app = createAppWithEmptyRegistry();
    const res = await request(app).get('/api/connectors');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('connectors-api: No CORS headers on connectors API responses', () => {
  it('Successful connectors list has no CORS headers', async () => {
    const app = createAppWithEmptyRegistry();
    const res = await request(app).get('/api/connectors');
    expect(res.status).toBe(200);
    assertNoCors(res.headers);
  });
});
