import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createMcpApp } from '../../src/http/createMcpApp.js';
import type { JsonObject } from '../../src/store/codec.js';
import type { EncryptedStore } from '../../src/store/store.js';
import { hashToken } from '../../src/token/token.js';

const ENABLED_NAME = 'Enabled Ops Config UNIQUE';
const DISABLED_NAME = 'Disabled Ops Config UNIQUE';
const ENABLED_TOKEN = 'enabled-bearer-token-UNIQUE-7e2c-aaaa';
const DISABLED_TOKEN = 'disabled-bearer-token-UNIQUE-7e2c-bbbb';
const UNKNOWN_TOKEN = 'unknown-bearer-token-UNIQUE-7e2c-cccc';

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

function storeWithConfigs(
  rows: Array<{ id: string; name: string; token: string; enabled: boolean }>,
): EncryptedStore {
  return createMemoryStore({
    configurations: rows.map((row) => ({
      id: row.id,
      name: row.name,
      tokenHash: hashToken(row.token),
      enabled: row.enabled,
    })),
  });
}

const INITIALIZE_BODY = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test', version: '0.0.0' },
  },
};

describe('mcp-endpoint: Bearer authentication before JSON-RPC on POST /mcp', () => {
  it('Enabled configuration bearer is accepted', async () => {
    const store = storeWithConfigs([
      { id: 'cfg-enabled', name: ENABLED_NAME, token: ENABLED_TOKEN, enabled: true },
    ]);
    const app = createMcpApp({ store });
    const response = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${ENABLED_TOKEN}`)
      .send(INITIALIZE_BODY);

    expect(response.status).not.toBe(401);
    expect(response.text).not.toBe('Unauthorized');
  });

  it('Disabled configuration bearer is refused like unknown', async () => {
    const store = storeWithConfigs([
      { id: 'cfg-disabled', name: DISABLED_NAME, token: DISABLED_TOKEN, enabled: false },
    ]);
    const app = createMcpApp({ store });
    const response = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${DISABLED_TOKEN}`)
      .send(INITIALIZE_BODY);

    expect(response.status).toBe(401);
    expect(response.headers['content-type']).toMatch(/text\/plain/);
    expect(response.text).toBe('Unauthorized');
  });
});

describe('mcp-endpoint: Identical Unauthorized refusal for failed auth', () => {
  it('Missing Authorization — 401 Unauthorized', async () => {
    const store = storeWithConfigs([
      { id: 'cfg-enabled', name: ENABLED_NAME, token: ENABLED_TOKEN, enabled: true },
    ]);
    const app = createMcpApp({ store });
    const response = await request(app).post('/mcp').send(INITIALIZE_BODY);

    expect(response.status).toBe(401);
    expect(response.headers['content-type']).toMatch(/text\/plain/);
    expect(response.text).toBe('Unauthorized');
    expect(response.text).not.toContain(ENABLED_NAME);
  });

  it('Empty bearer — same 401 as missing', async () => {
    const store = storeWithConfigs([
      { id: 'cfg-enabled', name: ENABLED_NAME, token: ENABLED_TOKEN, enabled: true },
    ]);
    const app = createMcpApp({ store });
    const response = await request(app)
      .post('/mcp')
      .set('Authorization', 'Bearer ')
      .send(INITIALIZE_BODY);

    expect(response.status).toBe(401);
    expect(response.text).toBe('Unauthorized');
  });

  it('Unknown token — same 401 as missing', async () => {
    const store = storeWithConfigs([
      { id: 'cfg-enabled', name: ENABLED_NAME, token: ENABLED_TOKEN, enabled: true },
    ]);
    const app = createMcpApp({ store });
    const response = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${UNKNOWN_TOKEN}`)
      .send(INITIALIZE_BODY);

    expect(response.status).toBe(401);
    expect(response.text).toBe('Unauthorized');
  });

  it('Four refusal cases are byte-identical', async () => {
    const store = storeWithConfigs([
      { id: 'cfg-enabled', name: ENABLED_NAME, token: ENABLED_TOKEN, enabled: true },
      { id: 'cfg-disabled', name: DISABLED_NAME, token: DISABLED_TOKEN, enabled: false },
    ]);
    const app = createMcpApp({ store });

    const missing = await request(app).post('/mcp').send(INITIALIZE_BODY);
    const empty = await request(app)
      .post('/mcp')
      .set('Authorization', 'Bearer ')
      .send(INITIALIZE_BODY);
    const unknown = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${UNKNOWN_TOKEN}`)
      .send(INITIALIZE_BODY);
    const disabled = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${DISABLED_TOKEN}`)
      .send(INITIALIZE_BODY);

    const responses = [missing, empty, unknown, disabled];
    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(response.text).toBe('Unauthorized');
      expect(response.text).not.toContain(ENABLED_NAME);
      expect(response.text).not.toContain(DISABLED_NAME);
    }
    expect(new Set(responses.map((r) => r.text))).toEqual(new Set(['Unauthorized']));
  });
});
