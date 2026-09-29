import type { Express } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { AccountFieldValues, ConnectorModule } from '../../src/connectors/contract.js';
import { buildConnectorRegistry } from '../../src/connectors/registry.js';
import { createAdminApp } from '../../src/http/createAdminApp.js';
import type { JsonObject } from '../../src/store/codec.js';
import type { EncryptedStore } from '../../src/store/store.js';

const FIXTURE_SECRET = 'fixture-secret-value-do-not-leak';

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

function parseJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}

type AccountPublic = {
  id: string;
  connector: string;
  label: string;
  enabled: boolean;
  values: Record<string, string>;
};

type ConfigPublic = {
  id: string;
  name: string;
  enabled: boolean;
  accountIds: string[];
};

function asAccountPublic(value: unknown): AccountPublic {
  expect(value).toEqual(
    expect.objectContaining({
      id: expect.any(String) as string,
      connector: expect.any(String) as string,
      label: expect.any(String) as string,
      enabled: expect.any(Boolean) as boolean,
      values: expect.any(Object) as Record<string, string>,
    }),
  );
  return value as AccountPublic;
}

function asAccountList(value: unknown): AccountPublic[] {
  expect(Array.isArray(value)).toBe(true);
  return (value as unknown[]).map(asAccountPublic);
}

function asConfigPublic(value: unknown): ConfigPublic {
  expect(value).toEqual(
    expect.objectContaining({
      id: expect.any(String) as string,
      name: expect.any(String) as string,
      enabled: expect.any(Boolean) as boolean,
      accountIds: expect.any(Array) as string[],
    }),
  );
  return value as ConfigPublic;
}

function createFakeNative(overrides: Partial<ConnectorModule> = {}): ConnectorModule {
  const base: ConnectorModule = {
    id: 'fake',
    name: 'Fake',
    kind: 'native',
    fields: [
      { name: 'user', label: 'User', type: 'text', required: true },
      { name: 'token', label: 'Token', type: 'secret', required: true },
      { name: 'mailhost', label: 'Mail host', type: 'host', required: true },
      { name: 'note', label: 'Note', type: 'text', required: false },
    ],
    allowedDestinations: [{ host: 'imap.example.test', port: 993 }],
    checkConnection: () => undefined,
    tools: [],
  };
  return {
    ...base,
    ...overrides,
    fields: overrides.fields ?? base.fields,
    allowedDestinations: overrides.allowedDestinations ?? base.allowedDestinations,
    checkConnection: overrides.checkConnection ?? base.checkConnection,
    tools: overrides.tools ?? base.tools,
  };
}

function validValues(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    user: 'alice',
    token: FIXTURE_SECRET,
    mailhost: 'mail.example.test',
    ...overrides,
  };
}

function createApp(options: {
  store?: EncryptedStore;
  checkConnection?: ConnectorModule['checkConnection'];
}): { app: Express; store: EncryptedStore } {
  const store = options.store ?? createMemoryStore({});
  const fake = createFakeNative(
    options.checkConnection ? { checkConnection: options.checkConnection } : undefined,
  );
  const app = createAdminApp({
    store,
    connectorRegistry: buildConnectorRegistry([fake]),
  });
  return { app, store };
}

async function createAccount(
  app: Express,
  overrides: { label?: string; values?: Record<string, string> } = {},
): Promise<AccountPublic> {
  const response = await request(app)
    .post('/api/accounts')
    .set('Content-Type', 'application/json')
    .send({
      connector: 'fake',
      label: overrides.label ?? 'Work',
      values: overrides.values ?? validValues(),
    });
  expect(response.status).toBe(201);
  expect(response.text).not.toContain(FIXTURE_SECRET);
  return asAccountPublic(parseJson(response.text));
}

describe('accounts-api: Accounts document shape', () => {
  it('Empty document reads as an empty accounts list', async () => {
    const { app } = createApp({});
    const response = await request(app).get('/api/accounts');
    expect(response.status).toBe(200);
    expect(parseJson(response.text)).toEqual([]);
  });

  it('Stored account keeps id, connector, label, values, and enabled', async () => {
    const { app, store } = createApp({});
    await createAccount(app);
    const entry = (store.read().accounts as JsonObject[])[0];
    expect(typeof entry.id).toBe('string');
    expect(entry.connector).toBe('fake');
    expect(entry.label).toBe('Work');
    expect(entry.enabled).toBe(true);
    expect(entry.values).toEqual(validValues());
    expect(entry.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});

describe('accounts-api: List accounts without secret values', () => {
  it('Secret keys are absent from list values', async () => {
    const { app } = createApp({});
    await createAccount(app);
    const response = await request(app).get('/api/accounts');
    expect(response.status).toBe(200);
    const list = asAccountList(parseJson(response.text));
    expect(list).toHaveLength(1);
    expect(list[0].values).toEqual({
      user: 'alice',
      mailhost: 'mail.example.test',
    });
    expect(list[0].values).not.toHaveProperty('token');
    expect(response.text).not.toContain(FIXTURE_SECRET);
  });
});

describe('accounts-api: Create account after connection check', () => {
  it('Successful create after checkConnection', async () => {
    const checkConnection = vi.fn(() => undefined);
    const { app, store } = createApp({ checkConnection });
    const response = await request(app)
      .post('/api/accounts')
      .set('Content-Type', 'application/json')
      .send({
        connector: 'fake',
        label: '  Work  ',
        values: validValues(),
      });
    expect(response.status).toBe(201);
    const body = asAccountPublic(parseJson(response.text));
    expect(body.enabled).toBe(true);
    expect(body.connector).toBe('fake');
    expect(body.label).toBe('Work');
    expect(body.values).not.toHaveProperty('token');
    expect(response.text).not.toContain(FIXTURE_SECRET);
    expect(checkConnection).toHaveBeenCalled();
    const stored = (store.read().accounts as Array<{ values: Record<string, string> }>)[0];
    expect(stored.values.token).toBe(FIXTURE_SECRET);
  });

  it('Unknown connector id is 400 without write', async () => {
    const { app } = createApp({});
    const response = await request(app)
      .post('/api/accounts')
      .set('Content-Type', 'application/json')
      .send({ connector: 'missing', label: 'X', values: {} });
    expect(response.status).toBe(400);
    expect(response.text).not.toContain(FIXTURE_SECRET);
    const list = await request(app).get('/api/accounts');
    expect(parseJson(list.text)).toEqual([]);
  });

  it('Connection check failure does not save', async () => {
    const { app } = createApp({
      checkConnection: () => {
        throw new Error(`provider boom ${FIXTURE_SECRET}`);
      },
    });
    const response = await request(app)
      .post('/api/accounts')
      .set('Content-Type', 'application/json')
      .send({
        connector: 'fake',
        label: 'Work',
        values: validValues(),
      });
    expect(response.status).toBe(400);
    expect(response.text).toBe('Connection check failed');
    expect(response.text).not.toContain(FIXTURE_SECRET);
    expect(response.text).not.toContain('provider boom');
    const list = await request(app).get('/api/accounts');
    expect(parseJson(list.text)).toEqual([]);
  });

  it('Host value with scheme is rejected', async () => {
    const checkConnection = vi.fn(() => undefined);
    const { app } = createApp({ checkConnection });
    const response = await request(app)
      .post('/api/accounts')
      .set('Content-Type', 'application/json')
      .send({
        connector: 'fake',
        label: 'Work',
        values: validValues({ mailhost: 'https://mail.example.test' }),
      });
    expect(response.status).toBe(400);
    expect(checkConnection).not.toHaveBeenCalled();
    const list = await request(app).get('/api/accounts');
    expect(parseJson(list.text)).toEqual([]);
  });

  it('Unknown values key is rejected', async () => {
    const checkConnection = vi.fn(() => undefined);
    const { app } = createApp({ checkConnection });
    const response = await request(app)
      .post('/api/accounts')
      .set('Content-Type', 'application/json')
      .send({
        connector: 'fake',
        label: 'Work',
        values: { ...validValues(), extra: 'nope' },
      });
    expect(response.status).toBe(400);
    expect(checkConnection).not.toHaveBeenCalled();
    const list = await request(app).get('/api/accounts');
    expect(parseJson(list.text)).toEqual([]);
  });
});

describe('accounts-api: Patch account with secret keep semantics', () => {
  it('Empty secret on patch keeps stored value and rechecks', async () => {
    const seen: AccountFieldValues[] = [];
    const checkConnection = vi.fn((values: AccountFieldValues) => {
      seen.push({ ...values });
    });
    const { app, store } = createApp({ checkConnection });
    const created = await createAccount(app);
    checkConnection.mockClear();
    seen.length = 0;

    const response = await request(app)
      .patch(`/api/accounts/${created.id}`)
      .set('Content-Type', 'application/json')
      .send({ values: { token: '' } });

    expect(response.status).toBe(200);
    expect(checkConnection).toHaveBeenCalledTimes(1);
    expect(seen[0]?.token).toBe(FIXTURE_SECRET);
    const body = asAccountPublic(parseJson(response.text));
    expect(body.values).not.toHaveProperty('token');
    expect(response.text).not.toContain(FIXTURE_SECRET);
    const stored = (store.read().accounts as Array<{ values: Record<string, string> }>)[0];
    expect(stored.values.token).toBe(FIXTURE_SECRET);
  });

  it('Enabled-only patch skips checkConnection', async () => {
    const checkConnection = vi.fn(() => undefined);
    const { app } = createApp({ checkConnection });
    const created = await createAccount(app);
    checkConnection.mockClear();

    const response = await request(app)
      .patch(`/api/accounts/${created.id}`)
      .set('Content-Type', 'application/json')
      .send({ enabled: false });

    expect(response.status).toBe(200);
    expect(asAccountPublic(parseJson(response.text)).enabled).toBe(false);
    expect(checkConnection).not.toHaveBeenCalled();
    expect(response.text).not.toContain(FIXTURE_SECRET);
  });

  it('Empty required non-secret on patch is 400', async () => {
    const { app, store } = createApp({});
    const created = await createAccount(app);
    const response = await request(app)
      .patch(`/api/accounts/${created.id}`)
      .set('Content-Type', 'application/json')
      .send({ values: { user: '' } });
    expect(response.status).toBe(400);
    expect(response.text).not.toContain(FIXTURE_SECRET);
    const stored = (store.read().accounts as Array<{ values: Record<string, string> }>)[0];
    expect(stored.values.user).toBe('alice');
  });
});

describe('accounts-api: Check connection without write', () => {
  it('Check succeeds without writing', async () => {
    const { app, store } = createApp({});
    const created = await createAccount(app);
    const before = JSON.stringify(store.read());
    const response = await request(app)
      .post(`/api/accounts/${created.id}/check`)
      .set('Content-Type', 'application/json');
    expect(response.status).toBe(200);
    expect(response.text).not.toContain(FIXTURE_SECRET);
    expect(JSON.stringify(store.read())).toBe(before);
  });

  it('Check failure returns fixed body', async () => {
    let fail = false;
    const { app } = createApp({
      checkConnection: () => {
        if (fail) {
          throw new Error(`leak ${FIXTURE_SECRET}`);
        }
      },
    });
    const created = await createAccount(app);
    fail = true;
    const response = await request(app)
      .post(`/api/accounts/${created.id}/check`)
      .set('Content-Type', 'application/json');
    expect(response.status).toBe(400);
    expect(response.text).toBe('Connection check failed');
    expect(response.text).not.toContain(FIXTURE_SECRET);
  });
});

describe('accounts-api: Delete account removes it from configurations', () => {
  it('Delete cascades out of configuration accountIds', async () => {
    const { app } = createApp({});
    const account = await createAccount(app);
    const configResponse = await request(app)
      .post('/api/configurations')
      .set('Content-Type', 'application/json')
      .send({ name: 'Ops' });
    const config = asConfigPublic(parseJson(configResponse.text));
    await request(app)
      .put(`/api/configurations/${config.id}/accounts`)
      .set('Content-Type', 'application/json')
      .send({ accountIds: [account.id] });

    const deleted = await request(app)
      .delete(`/api/accounts/${account.id}`)
      .set('Content-Type', 'application/json');
    expect(deleted.status).toBe(204);

    const accounts = await request(app).get('/api/accounts');
    expect(parseJson(accounts.text)).toEqual([]);

    const configs = await request(app).get('/api/configurations');
    expect(asConfigPublic((parseJson(configs.text) as unknown[])[0]).accountIds).toEqual([]);
  });

  it('Unknown account id on DELETE — 404', async () => {
    const { app } = createApp({});
    const response = await request(app)
      .delete('/api/accounts/missing')
      .set('Content-Type', 'application/json');
    expect(response.status).toBe(404);
    expect(response.text).toBe('Not Found');
    expect(response.text).not.toContain(FIXTURE_SECRET);
  });
});

describe('accounts-api: Assign accounts to a configuration', () => {
  it('Replace accountIds preserving order', async () => {
    const { app } = createApp({});
    const a1 = await createAccount(app, { label: 'One' });
    const a2 = await createAccount(app, { label: 'Two' });
    const configResponse = await request(app)
      .post('/api/configurations')
      .set('Content-Type', 'application/json')
      .send({ name: 'Ops' });
    const config = asConfigPublic(parseJson(configResponse.text));

    const response = await request(app)
      .put(`/api/configurations/${config.id}/accounts`)
      .set('Content-Type', 'application/json')
      .send({ accountIds: [a2.id, a1.id] });

    expect(response.status).toBe(200);
    const body = asConfigPublic(parseJson(response.text));
    expect(body.accountIds).toEqual([a2.id, a1.id]);
    expect(body).not.toHaveProperty('token');
    expect(body).not.toHaveProperty('tokenHash');

    const list = await request(app).get('/api/configurations');
    expect(asConfigPublic((parseJson(list.text) as unknown[])[0]).accountIds).toEqual([
      a2.id,
      a1.id,
    ]);
  });

  it('Unknown account id rejects without write', async () => {
    const { app } = createApp({});
    const configResponse = await request(app)
      .post('/api/configurations')
      .set('Content-Type', 'application/json')
      .send({ name: 'Ops' });
    const config = asConfigPublic(parseJson(configResponse.text));

    const response = await request(app)
      .put(`/api/configurations/${config.id}/accounts`)
      .set('Content-Type', 'application/json')
      .send({ accountIds: ['missing'] });

    expect(response.status).toBe(400);
    const list = await request(app).get('/api/configurations');
    expect(asConfigPublic((parseJson(list.text) as unknown[])[0]).accountIds).toEqual([]);
  });

  it('Duplicate account ids rejected', async () => {
    const { app } = createApp({});
    const account = await createAccount(app);
    const configResponse = await request(app)
      .post('/api/configurations')
      .set('Content-Type', 'application/json')
      .send({ name: 'Ops' });
    const config = asConfigPublic(parseJson(configResponse.text));

    const response = await request(app)
      .put(`/api/configurations/${config.id}/accounts`)
      .set('Content-Type', 'application/json')
      .send({ accountIds: [account.id, account.id] });

    expect(response.status).toBe(400);
    const list = await request(app).get('/api/configurations');
    expect(asConfigPublic((parseJson(list.text) as unknown[])[0]).accountIds).toEqual([]);
  });

  it('Disabled account may be assigned', async () => {
    const { app } = createApp({});
    const account = await createAccount(app);
    await request(app)
      .patch(`/api/accounts/${account.id}`)
      .set('Content-Type', 'application/json')
      .send({ enabled: false });

    const configResponse = await request(app)
      .post('/api/configurations')
      .set('Content-Type', 'application/json')
      .send({ name: 'Ops' });
    const config = asConfigPublic(parseJson(configResponse.text));

    const response = await request(app)
      .put(`/api/configurations/${config.id}/accounts`)
      .set('Content-Type', 'application/json')
      .send({ accountIds: [account.id] });

    expect(response.status).toBe(200);
    expect(asConfigPublic(parseJson(response.text)).accountIds).toEqual([account.id]);
  });
});

describe('accounts-api: Accounts API follows admin JSON and CORS rules', () => {
  it('Form body create account is rejected', async () => {
    const { app } = createApp({});
    const response = await request(app)
      .post('/api/accounts')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('connector=fake&label=Work');
    expect(response.status).toBe(415);
    const list = await request(app).get('/api/accounts');
    expect(parseJson(list.text)).toEqual([]);
  });

  it('Successful accounts list has no CORS headers', async () => {
    const { app } = createApp({});
    const response = await request(app).get('/api/accounts');
    expect(response.status).toBe(200);
    assertNoCors(response.headers);
  });
});

describe('accounts-api: configurations responses include accountIds', () => {
  it('Create list rotate and patch include accountIds', async () => {
    const { app } = createApp({});
    const createdResponse = await request(app)
      .post('/api/configurations')
      .set('Content-Type', 'application/json')
      .send({ name: 'Ops' });
    expect(createdResponse.status).toBe(201);
    const created = asConfigPublic(parseJson(createdResponse.text));
    expect(created.accountIds).toEqual([]);

    const list = await request(app).get('/api/configurations');
    expect(asConfigPublic((parseJson(list.text) as unknown[])[0]).accountIds).toEqual([]);

    const patched = await request(app)
      .patch(`/api/configurations/${created.id}`)
      .set('Content-Type', 'application/json')
      .send({ enabled: false });
    expect(asConfigPublic(parseJson(patched.text)).accountIds).toEqual([]);

    const rotated = await request(app)
      .post(`/api/configurations/${created.id}/rotate`)
      .set('Content-Type', 'application/json');
    const rotatedBody = parseJson(rotated.text) as Record<string, unknown>;
    expect(rotatedBody.accountIds).toEqual([]);
    expect(rotatedBody).toHaveProperty('token');
  });
});
