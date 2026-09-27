import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createMcpApp } from '../../src/http/createMcpApp.js';
import type { JsonObject } from '../../src/store/codec.js';
import type { EncryptedStore } from '../../src/store/store.js';
import { hashToken } from '../../src/token/token.js';

const openServers: http.Server[] = [];

afterEach(async () => {
  while (openServers.length > 0) {
    const server = openServers.pop();
    if (!server) {
      continue;
    }
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
});

async function listenMcpApp(
  store: EncryptedStore,
): Promise<{ baseUrl: string; server: http.Server }> {
  const app = createMcpApp({ store });
  const server = http.createServer(app);
  openServers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
    server.once('error', reject);
  });
  const address = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${String(address.port)}`, server };
}

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

describe('mcp-endpoint: Stateless Streamable HTTP with empty tools/list', () => {
  it('Initialize and empty tools/list with enabled bearer', async () => {
    const store = storeWithConfigs([
      { id: 'cfg-enabled', name: ENABLED_NAME, token: ENABLED_TOKEN, enabled: true },
    ]);
    const { baseUrl } = await listenMcpApp(store);
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: {
        headers: {
          Authorization: `Bearer ${ENABLED_TOKEN}`,
        },
      },
    });
    const client = new Client({ name: 'mcp-endpoint-test', version: '0.0.0' });
    await client.connect(transport);
    const listed = await client.listTools();
    expect(listed.tools).toEqual([]);
    await client.close();
  });

  it('No session id on successful POST', async () => {
    const store = storeWithConfigs([
      { id: 'cfg-enabled', name: ENABLED_NAME, token: ENABLED_TOKEN, enabled: true },
    ]);
    const app = createMcpApp({ store });
    const response = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${ENABLED_TOKEN}`)
      .set('Accept', 'application/json, text/event-stream')
      .send(INITIALIZE_BODY);

    expect(response.status).not.toBe(401);
    expect(response.headers['mcp-session-id']).toBeUndefined();
    expect(response.body).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: expect.objectContaining({
        serverInfo: { name: 'mcp-gateway', version: '0.0.0' },
      }) as unknown,
    });

    const followUp = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${ENABLED_TOKEN}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      });

    expect(followUp.status).not.toBe(401);
    expect(followUp.headers['mcp-session-id']).toBeUndefined();
    expect(followUp.body).toMatchObject({
      jsonrpc: '2.0',
      id: 2,
      result: { tools: [] },
    });
  });
});
