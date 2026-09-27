import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createAdminApp } from '../../src/http/createAdminApp.js';
import { createMcpApp } from '../../src/http/createMcpApp.js';
import type { JsonObject } from '../../src/store/codec.js';
import { open, type EncryptedStore } from '../../src/store/store.js';
import { hashToken } from '../../src/token/token.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const dataRoot = path.join(repoRoot, 'data');

const CORS_HEADERS = [
  'access-control-allow-origin',
  'access-control-allow-methods',
  'access-control-allow-headers',
  'access-control-allow-credentials',
] as const;

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

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

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

type ConfigWithToken = {
  id: string;
  name: string;
  enabled: boolean;
  token: string;
};

type ConfigPublic = {
  id: string;
  name: string;
  enabled: boolean;
};

function parseJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}

function asConfigWithToken(value: unknown): ConfigWithToken {
  expect(value).toEqual(
    expect.objectContaining({
      id: expect.any(String) as string,
      name: expect.any(String) as string,
      enabled: expect.any(Boolean) as boolean,
      token: expect.any(String) as string,
    }),
  );
  const row = value as ConfigWithToken;
  expect(row).not.toHaveProperty('tokenHash');
  return row;
}

function asConfigPublic(value: unknown): ConfigPublic {
  expect(value).toEqual(
    expect.objectContaining({
      id: expect.any(String) as string,
      name: expect.any(String) as string,
      enabled: expect.any(Boolean) as boolean,
    }),
  );
  const row = value as ConfigPublic;
  expect(row).not.toHaveProperty('token');
  expect(row).not.toHaveProperty('tokenHash');
  return row;
}

function asConfigList(value: unknown): ConfigPublic[] {
  expect(Array.isArray(value)).toBe(true);
  return (value as unknown[]).map(asConfigPublic);
}

/** PATCH with a JSON body and no Content-Type header (supertest would invent one). */
async function patchWithoutContentType(
  app: Express,
  urlPath: string,
  body: object,
): Promise<{ status: number; text: string }> {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });
  try {
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('expected TCP address');
    }
    return await new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: address.port,
          path: urlPath,
          method: 'PATCH',
          headers: {
            'Content-Length': String(payload.length),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
          });
          res.on('end', () => {
            resolve({
              status: res.statusCode ?? 0,
              text: Buffer.concat(chunks).toString('utf8'),
            });
          });
        },
      );
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  } finally {
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
}

describe('configurations-api: Configurations document shape', () => {
  it('Empty document reads as an empty list', async () => {
    const app = createAdminApp({ store: createMemoryStore({}) });
    const response = await request(app).get('/api/configurations');
    expect(response.status).toBe(200);
    expect(parseJson(response.text)).toEqual([]);
  });

  it('Stored rows keep id, name, tokenHash, and enabled only', async () => {
    const store = createMemoryStore({});
    const app = createAdminApp({ store });
    await request(app)
      .post('/api/configurations')
      .set('Content-Type', 'application/json')
      .send({ name: 'Ops' });
    const document = store.read();
    const rows = document.configurations as JsonObject[];
    const entry = rows[0];
    expect(typeof entry.id).toBe('string');
    expect(typeof entry.name).toBe('string');
    expect(typeof entry.tokenHash).toBe('string');
    expect(typeof entry.enabled).toBe('boolean');
    expect(entry).not.toHaveProperty('accountIds');
    expect(entry).not.toHaveProperty('token');
  });
});

describe('configurations-api: Bearer token generation and hash persistence', () => {
  it('Create returns a token once and stores only the hash', async () => {
    const store = createMemoryStore({});
    const app = createAdminApp({ store });
    const response = await request(app)
      .post('/api/configurations')
      .set('Content-Type', 'application/json')
      .send({ name: 'Ops' });

    expect(response.status).toBe(201);
    const body = asConfigWithToken(parseJson(response.text));
    expect(body.name).toBe('Ops');
    expect(body.enabled).toBe(true);
    expect(body.token).toMatch(/^[A-Za-z0-9_-]+$/);

    const rows = store.read().configurations as Array<{ tokenHash: string }>;
    expect(rows[0].tokenHash).toBe(hashToken(body.token));
    expect(rows[0].tokenHash).toBe(sha256Hex(body.token));
    expect(JSON.stringify(store.read())).not.toContain(body.token);
  });

  it('Rotate replaces the hash immediately', async () => {
    const store = createMemoryStore({});
    const app = createAdminApp({ store });
    const createdResponse = await request(app)
      .post('/api/configurations')
      .set('Content-Type', 'application/json')
      .send({ name: 'Ops' });
    const created = asConfigWithToken(parseJson(createdResponse.text));
    const previousHash = hashToken(created.token);

    const rotatedResponse = await request(app)
      .post(`/api/configurations/${created.id}/rotate`)
      .set('Content-Type', 'application/json');

    expect(rotatedResponse.status).toBe(200);
    const rotated = asConfigWithToken(parseJson(rotatedResponse.text));
    expect(rotated.token).not.toBe(created.token);
    const rows = store.read().configurations as Array<{ tokenHash: string }>;
    expect(rows[0].tokenHash).toBe(hashToken(rotated.token));
    expect(rows[0].tokenHash).not.toBe(previousHash);
  });
});

describe('configurations-api: Create configuration', () => {
  it('Successful create', async () => {
    const app = createAdminApp({ store: createMemoryStore({}) });
    const response = await request(app)
      .post('/api/configurations')
      .set('Content-Type', 'application/json')
      .send({ name: 'Primary' });

    expect(response.status).toBe(201);
    const body = asConfigWithToken(parseJson(response.text));
    expect(body.name).toBe('Primary');
    expect(body.enabled).toBe(true);
  });

  it('Empty name is rejected without changing state', async () => {
    const app = createAdminApp({ store: createMemoryStore({}) });
    const response = await request(app)
      .post('/api/configurations')
      .set('Content-Type', 'application/json')
      .send({ name: '   ' });

    expect(response.status).toBe(400);
    const list = await request(app).get('/api/configurations');
    expect(parseJson(list.text)).toEqual([]);
  });
});

describe('configurations-api: List configurations without secrets', () => {
  it('List omits token and hash', async () => {
    const store = createMemoryStore({});
    const app = createAdminApp({ store });
    const createdResponse = await request(app)
      .post('/api/configurations')
      .set('Content-Type', 'application/json')
      .send({ name: 'Ops' });
    const created = asConfigWithToken(parseJson(createdResponse.text));
    const tokenHash = (store.read().configurations as Array<{ tokenHash: string }>)[0].tokenHash;

    const list = await request(app).get('/api/configurations');
    expect(list.status).toBe(200);
    asConfigList(parseJson(list.text));
    expect(list.text).not.toContain(created.token);
    expect(list.text).not.toContain(tokenHash);
  });
});

describe('configurations-api: Enable or disable a configuration', () => {
  it('Disable then enable', async () => {
    const app = createAdminApp({ store: createMemoryStore({}) });
    const createdResponse = await request(app)
      .post('/api/configurations')
      .set('Content-Type', 'application/json')
      .send({ name: 'Ops' });
    const created = asConfigWithToken(parseJson(createdResponse.text));

    const disabledResponse = await request(app)
      .patch(`/api/configurations/${created.id}`)
      .set('Content-Type', 'application/json')
      .send({ enabled: false });

    expect(disabledResponse.status).toBe(200);
    expect(asConfigPublic(parseJson(disabledResponse.text))).toEqual({
      id: created.id,
      name: 'Ops',
      enabled: false,
    });

    const enabledResponse = await request(app)
      .patch(`/api/configurations/${created.id}`)
      .set('Content-Type', 'application/json')
      .send({ enabled: true });

    expect(asConfigPublic(parseJson(enabledResponse.text)).enabled).toBe(true);
  });

  it('Unknown id on PATCH — 404', async () => {
    const app = createAdminApp({ store: createMemoryStore({}) });
    const response = await request(app)
      .patch('/api/configurations/missing')
      .set('Content-Type', 'application/json')
      .send({ enabled: false });

    expect(response.status).toBe(404);
    expect(response.text).toBe('Not Found');
    expect(response.text.length).toBeLessThan(100);
  });
});

describe('configurations-api: Delete a configuration', () => {
  it('Successful delete', async () => {
    const app = createAdminApp({ store: createMemoryStore({}) });
    const createdResponse = await request(app)
      .post('/api/configurations')
      .set('Content-Type', 'application/json')
      .send({ name: 'Ops' });
    const created = asConfigWithToken(parseJson(createdResponse.text));

    const deleted = await request(app)
      .delete(`/api/configurations/${created.id}`)
      .set('Content-Type', 'application/json');

    expect(deleted.status).toBe(204);
    expect(deleted.text).toBe('');

    const list = await request(app).get('/api/configurations');
    expect(parseJson(list.text)).toEqual([]);
  });

  it('Unknown id on DELETE — 404', async () => {
    const app = createAdminApp({ store: createMemoryStore({}) });
    const response = await request(app)
      .delete('/api/configurations/missing')
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(404);
    expect(response.text).toBe('Not Found');
  });
});

describe('configurations-api: Rotate returns a new token once', () => {
  it('Rotate unknown id — 404', async () => {
    const app = createAdminApp({ store: createMemoryStore({}) });
    const response = await request(app)
      .post('/api/configurations/missing/rotate')
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(404);
    expect(response.text).toBe('Not Found');
  });
});

describe('configurations-api: /api mutations require application/json Content-Type', () => {
  it('Form body create is rejected without changing state', async () => {
    const app = createAdminApp({ store: createMemoryStore({}) });
    const response = await request(app)
      .post('/api/configurations')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('name=Ops');

    expect(response.status).toBe(415);
    const list = await request(app).get('/api/configurations');
    expect(parseJson(list.text)).toEqual([]);
  });

  it('Missing Content-Type on PATCH does not change state', async () => {
    const app = createAdminApp({ store: createMemoryStore({}) });
    const createdResponse = await request(app)
      .post('/api/configurations')
      .set('Content-Type', 'application/json')
      .send({ name: 'Ops' });
    const created = asConfigWithToken(parseJson(createdResponse.text));

    const response = await patchWithoutContentType(app, `/api/configurations/${created.id}`, {
      enabled: false,
    });

    expect(response.status).toBe(415);
    const list = await request(app).get('/api/configurations');
    expect(asConfigList(parseJson(list.text))).toEqual([
      { id: created.id, name: 'Ops', enabled: true },
    ]);
  });

  it('charset=utf-8 JSON is accepted', async () => {
    const app = createAdminApp({ store: createMemoryStore({}) });
    const response = await request(app)
      .post('/api/configurations')
      .set('Content-Type', 'application/json; charset=utf-8')
      .send({ name: 'Charset' });

    expect(response.status).toBe(201);
    expect(asConfigWithToken(parseJson(response.text)).name).toBe('Charset');
  });
});

describe('configurations-api: No CORS headers on /api responses', () => {
  it('Successful list has no CORS headers', async () => {
    const app = createAdminApp({ store: createMemoryStore({}) });
    const response = await request(app).get('/api/configurations');
    expect(response.status).toBe(200);
    assertNoCors(response.headers);
  });

  it('415 error has no CORS headers', async () => {
    const app = createAdminApp({ store: createMemoryStore({}) });
    const response = await request(app)
      .post('/api/configurations')
      .set('Content-Type', 'text/plain')
      .send('name=Ops');

    expect(response.status).toBe(415);
    assertNoCors(response.headers);
  });
});

describe('configurations-api: Token absent from plaintext on disk after create', () => {
  it('Create token is not in state.bin plaintext', async () => {
    await mkdir(dataRoot, { recursive: true });
    const dataDir = await mkdtemp(path.join(dataRoot, 'configurations-api-'));
    tempDirs.push(dataDir);
    const key = randomBytes(32);
    const store = await open(dataDir, key);
    const app = createAdminApp({ store });

    const createdResponse = await request(app)
      .post('/api/configurations')
      .set('Content-Type', 'application/json')
      .send({ name: 'Ops' });
    const created = asConfigWithToken(parseJson(createdResponse.text));

    const fileBytes = await readFile(path.join(dataDir, 'state.bin'));
    expect(fileBytes.includes(Buffer.from(created.token, 'utf8'))).toBe(false);
  });
});

describe('configurations-api: MCP port stays unchanged', () => {
  it('GET /mcp remains 501', async () => {
    const app = createMcpApp();
    const response = await request(app).get('/mcp');
    expect(response.status).toBe(501);
  });
});
