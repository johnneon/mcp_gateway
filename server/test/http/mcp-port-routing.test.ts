import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createAdminApp } from '../../src/http/createAdminApp.js';
import { createMcpApp } from '../../src/http/createMcpApp.js';
import { productionConnectorRegistry } from '../../src/connectors/registry.js';
import type { JsonObject } from '../../src/store/codec.js';
import type { EncryptedStore } from '../../src/store/store.js';

/** Test canaries that must never appear in MCP responses. */
const DATA_DIR = 'C:\\fake-data-dir-mcp-port-routing-UNIQUE';
const ENCRYPTION_KEY = 'c3Bhd24tdGVzdC1rZXktMzItYnl0ZXMtcGFkZGVkISE=';
const MCP_HOST = 'mcp-host-canary.example';
const MCP_PORT = '18765';
const ADMIN_HOST = 'admin-host-canary.example';
const ADMIN_PORT = '18766';
const BEARER = 'Bearer secret-token-canary-7e2c-UNIQUE';

const SECRET_CANARIES = [DATA_DIR, ENCRYPTION_KEY, MCP_HOST, MCP_PORT, ADMIN_HOST, ADMIN_PORT];

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

function assertNoSecrets(body: string): void {
  for (const canary of SECRET_CANARIES) {
    expect(body).not.toContain(canary);
  }
}

function mcpApp(): ReturnType<typeof createMcpApp> {
  return createMcpApp({
    store: createMemoryStore(),
    connectorRegistry: productionConnectorRegistry,
  });
}

describe('mcp-port-routing: GET /health on the MCP port without authentication', () => {
  it('GET /health without Authorization', async () => {
    const app = mcpApp();
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body).toEqual({ status: 'ok' });
    assertNoSecrets(response.text);
  });

  it('GET /health with Authorization does not change the response', async () => {
    const app = mcpApp();
    const response = await request(app).get('/health').set('Authorization', BEARER);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(response.text).not.toContain(BEARER);
    expect(response.text).not.toContain('secret-token-canary-7e2c-UNIQUE');
    assertNoSecrets(response.text);
  });

  it('GET /health with a query string', async () => {
    const app = mcpApp();
    const response = await request(app).get('/health?x=1');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});

describe('mcp-port-routing: /mcp on the MCP port serves Streamable HTTP after auth', () => {
  it('GET /mcp — 405 without secrets and without SSE', async () => {
    const app = mcpApp();
    const response = await request(app).get('/mcp');

    expect(response.status).toBe(405);
    expect(response.headers['content-type']).toMatch(/text\/plain/);
    expect(response.text.length).toBeGreaterThan(0);
    expect(response.text.length).toBeLessThan(100);
    expect(response.text).toMatch(/^[A-Za-z ]+$/);
    assertNoSecrets(response.text);
    expect(response.headers['content-type']).not.toMatch(/text\/event-stream/);
  });

  it('DELETE /mcp — 405 without secrets', async () => {
    const app = mcpApp();
    const response = await request(app).delete('/mcp');

    expect(response.status).toBe(405);
    expect(response.headers['content-type']).toMatch(/text\/plain/);
    expect(response.text.length).toBeGreaterThan(0);
    expect(response.text.length).toBeLessThan(100);
    expect(response.text).toMatch(/^[A-Za-z ]+$/);
    assertNoSecrets(response.text);
  });

  it('POST /mcp without Authorization — 401 not 501', async () => {
    const app = mcpApp();
    const response = await request(app).post('/mcp').send({ anything: true });

    expect(response.status).toBe(401);
    expect(response.status).not.toBe(501);
    expect(response.headers['content-type']).toMatch(/text\/plain/);
    expect(response.text).toBe('Unauthorized');
    assertNoSecrets(response.text);
  });
});

describe('mcp-port-routing: A foreign path on the MCP port is 404', () => {
  it('Unknown path — 404', async () => {
    const app = mcpApp();
    const response = await request(app).get('/unknown');

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toMatch(/text\/plain/);
    expect(response.text).toBe('Not Found');
    assertNoSecrets(response.text);
  });

  it('POST /health — 404', async () => {
    const app = mcpApp();
    const response = await request(app).post('/health');

    expect(response.status).toBe(404);
    expect(response.text).toBe('Not Found');
  });

  it('PUT /health — 404', async () => {
    const app = mcpApp();
    const response = await request(app).put('/health');

    expect(response.status).toBe(404);
    expect(response.text).toBe('Not Found');
  });

  it('DELETE /health — 404', async () => {
    const app = mcpApp();
    const response = await request(app).delete('/health');

    expect(response.status).toBe(404);
    expect(response.text).toBe('Not Found');
  });

  it('GET /health/ — 404', async () => {
    const app = mcpApp();
    const response = await request(app).get('/health/');

    expect(response.status).toBe(404);
    expect(response.text).toBe('Not Found');
  });
});

const adminTempDirs: string[] = [];

afterEach(async () => {
  while (adminTempDirs.length > 0) {
    const dir = adminTempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function makeAdminWebRoot(options: { mcpFileContent?: string }): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mcp-port-routing-admin-'));
  adminTempDirs.push(dir);
  await writeFile(
    path.join(dir, 'index.html'),
    '<!doctype html><html><head><title>MCP Gateway</title></head><body>admin shell</body></html>\n',
    'utf8',
  );
  if (options.mcpFileContent !== undefined) {
    await writeFile(path.join(dir, 'mcp'), options.mcpFileContent, 'utf8');
  }
  return dir;
}

describe('mcp-port-routing: The admin port does not serve /mcp', () => {
  it('GET /mcp on admin — 404 before static files', async () => {
    const collisionContent = 'STATIC-MCP-COLLISION-CANARY-UNIQUE';
    const webRoot = await makeAdminWebRoot({ mcpFileContent: collisionContent });
    const app = createAdminApp({ store: createMemoryStore(), webRoot });
    const response = await request(app).get('/mcp');

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toMatch(/text\/plain/);
    expect(response.text).toBe('Not Found');
    expect(response.text).not.toBe(collisionContent);
    expect(response.text).not.toContain(collisionContent);
  });

  it('POST /mcp on admin — 404', async () => {
    const webRoot = await makeAdminWebRoot({});
    const app = createAdminApp({ store: createMemoryStore(), webRoot });
    const response = await request(app).post('/mcp');

    expect(response.status).toBe(404);
    expect(response.text).toBe('Not Found');
  });

  it('GET / on admin still returns HTML', async () => {
    const webRoot = await makeAdminWebRoot({});
    const app = createAdminApp({ store: createMemoryStore(), webRoot });
    const response = await request(app).get('/');

    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(400);
    expect(response.text.toLowerCase()).toContain('<!doctype html');
    expect(response.text).toContain('MCP Gateway');
  });
});
