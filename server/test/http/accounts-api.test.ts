import type { Express } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type {
  AccountFieldValues,
  ConnectorModule,
  NativeConnectorModule,
  NativeEgressClient,
} from '../../src/connectors/contract.js';
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
  const row = value as ConfigPublic;
  expect(row).not.toHaveProperty('disabledTools');
  return value as ConfigPublic;
}

function createFakeNative(overrides: Partial<NativeConnectorModule> = {}): NativeConnectorModule {
  const base: NativeConnectorModule = {
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
    tools: [
      {
        name: 'keep',
        description: 'Keep a row',
        inputSchema: { type: 'object' },
        handler: () => ({ content: [{ type: 'text', text: 'ok' }] }),
      },
      {
        name: 'drop',
        description: 'Drop a row',
        inputSchema: { type: 'object' },
        handler: () => ({ content: [{ type: 'text', text: 'ok' }] }),
      },
    ],
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

  it('Create passes egress client into checkConnection', async () => {
    let sawEgress = false;
    const checkConnection = vi.fn(
      (_values: AccountFieldValues, egressClient: NativeEgressClient) => {
        sawEgress = typeof egressClient.tlsSession === 'function';
      },
    );
    const { app } = createApp({ checkConnection });
    const response = await request(app)
      .post('/api/accounts')
      .set('Content-Type', 'application/json')
      .send({
        connector: 'fake',
        label: 'Work',
        values: validValues(),
      });
    expect(response.status).toBe(201);
    expect(sawEgress).toBe(true);
    expect(checkConnection).toHaveBeenCalledTimes(1);
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
    let sawEgress = false;
    const checkConnection = vi.fn(
      (values: AccountFieldValues, egressClient: NativeEgressClient) => {
        seen.push({ ...values });
        sawEgress = typeof egressClient.tlsSession === 'function';
      },
    );
    const { app, store } = createApp({ checkConnection });
    const created = await createAccount(app);
    checkConnection.mockClear();
    seen.length = 0;
    sawEgress = false;

    const response = await request(app)
      .patch(`/api/accounts/${created.id}`)
      .set('Content-Type', 'application/json')
      .send({ values: { token: '' } });

    expect(response.status).toBe(200);
    expect(checkConnection).toHaveBeenCalledTimes(1);
    expect(seen[0]?.token).toBe(FIXTURE_SECRET);
    expect(sawEgress).toBe(true);
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

  it('Explicit check passes egress client', async () => {
    let sawEgress = false;
    const checkConnection = vi.fn(
      (_values: AccountFieldValues, egressClient: NativeEgressClient) => {
        sawEgress = typeof egressClient.tlsSession === 'function';
      },
    );
    const { app } = createApp({ checkConnection });
    const created = await createAccount(app);
    sawEgress = false;
    checkConnection.mockClear();
    const response = await request(app)
      .post(`/api/accounts/${created.id}/check`)
      .set('Content-Type', 'application/json');
    expect(response.status).toBe(200);
    expect(sawEgress).toBe(true);
    expect(checkConnection).toHaveBeenCalledTimes(1);
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

  it('Delete drops the account disabledTools entry', async () => {
    const { app, store } = createApp({});
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
    const disabled = await request(app)
      .put(`/api/configurations/${config.id}/accounts/${account.id}/disabled-tools`)
      .set('Content-Type', 'application/json')
      .send({ toolNames: ['fake_drop'] });
    expect(disabled.status).toBe(200);

    const deleted = await request(app)
      .delete(`/api/accounts/${account.id}`)
      .set('Content-Type', 'application/json');
    expect(deleted.status).toBe(204);
    const stored = (store.read().configurations as JsonObject[])[0];
    const tools = stored.disabledTools as Record<string, string[]> | undefined;
    expect(tools?.[account.id]).toBeUndefined();
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

  it('Unassign drops disabledTools and assign again starts enabled', async () => {
    const { app, store } = createApp({});
    const a1 = await createAccount(app, { label: 'One' });
    const a2 = await createAccount(app, { label: 'Two' });
    const configResponse = await request(app)
      .post('/api/configurations')
      .set('Content-Type', 'application/json')
      .send({ name: 'Ops' });
    const config = asConfigPublic(parseJson(configResponse.text));
    await request(app)
      .put(`/api/configurations/${config.id}/accounts`)
      .set('Content-Type', 'application/json')
      .send({ accountIds: [a1.id, a2.id] });
    await request(app)
      .put(`/api/configurations/${config.id}/accounts/${a1.id}/disabled-tools`)
      .set('Content-Type', 'application/json')
      .send({ toolNames: ['fake_drop'] });
    await request(app)
      .put(`/api/configurations/${config.id}/accounts/${a2.id}/disabled-tools`)
      .set('Content-Type', 'application/json')
      .send({ toolNames: ['fake_keep'] });

    const unassigned = await request(app)
      .put(`/api/configurations/${config.id}/accounts`)
      .set('Content-Type', 'application/json')
      .send({ accountIds: [a2.id] });
    expect(unassigned.status).toBe(200);
    expect(asConfigPublic(parseJson(unassigned.text))).not.toHaveProperty('token');
    const afterUnassign = (store.read().configurations as JsonObject[])[0].disabledTools as Record<
      string,
      string[]
    >;
    expect(afterUnassign).not.toHaveProperty(a1.id);
    expect(afterUnassign[a2.id]).toEqual(['fake_keep']);

    const assigned = await request(app)
      .put(`/api/configurations/${config.id}/accounts`)
      .set('Content-Type', 'application/json')
      .send({ accountIds: [a2.id, a1.id] });
    expect(assigned.status).toBe(200);
    const afterAssign = (store.read().configurations as JsonObject[])[0].disabledTools as Record<
      string,
      string[]
    >;
    expect(afterAssign).not.toHaveProperty(a1.id);
    const enabled = await request(app).get(
      `/api/configurations/${config.id}/accounts/${a1.id}/disabled-tools`,
    );
    expect(enabled.status).toBe(200);
    expect(parseJson(enabled.text)).toEqual({ toolNames: [] });
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

describe('accounts-api: Read and replace disabled tools for an assigned account', () => {
  async function assignOne(app: Express): Promise<{
    account: AccountPublic;
    configId: string;
    token: string;
  }> {
    const account = await createAccount(app);
    const configResponse = await request(app)
      .post('/api/configurations')
      .set('Content-Type', 'application/json')
      .send({ name: 'Ops' });
    expect(configResponse.status).toBe(201);
    const created = parseJson(configResponse.text) as { id: string; token: string };
    await request(app)
      .put(`/api/configurations/${created.id}/accounts`)
      .set('Content-Type', 'application/json')
      .send({ accountIds: [account.id] });
    return { account, configId: created.id, token: created.token };
  }

  function storedTools(store: EncryptedStore, accountId: string): string[] | undefined {
    const row = (store.read().configurations as JsonObject[])[0];
    const tools = row?.disabledTools as Record<string, string[]> | undefined;
    return tools?.[accountId];
  }

  it('GET returns an empty list when nothing is stored', async () => {
    const { app } = createApp({});
    const { account, configId, token } = await assignOne(app);
    const response = await request(app).get(
      `/api/configurations/${configId}/accounts/${account.id}/disabled-tools`,
    );
    expect(response.status).toBe(200);
    expect(parseJson(response.text)).toEqual({ toolNames: [] });
    expect(response.text).not.toContain(token);
    expect(response.text).not.toContain(FIXTURE_SECRET);
  });

  it('PUT replaces the set and GET returns the stored names', async () => {
    const { app, store } = createApp({});
    const { account, configId, token } = await assignOne(app);
    const response = await request(app)
      .put(`/api/configurations/${configId}/accounts/${account.id}/disabled-tools`)
      .set('Content-Type', 'application/json')
      .send({ toolNames: ['fake_drop'], ignored: true });
    expect(response.status).toBe(200);
    expect(parseJson(response.text)).toEqual({ toolNames: ['fake_drop'] });
    expect(response.text).not.toContain(token);
    expect(response.text).not.toContain(FIXTURE_SECRET);
    expect(storedTools(store, account.id)).toEqual(['fake_drop']);
    const again = await request(app).get(
      `/api/configurations/${configId}/accounts/${account.id}/disabled-tools`,
    );
    expect(parseJson(again.text)).toEqual({ toolNames: ['fake_drop'] });
  });

  it('PUT stores tool names in the submitted order', async () => {
    const { app, store } = createApp({});
    const { account, configId } = await assignOne(app);
    const response = await request(app)
      .put(`/api/configurations/${configId}/accounts/${account.id}/disabled-tools`)
      .set('Content-Type', 'application/json')
      .send({ toolNames: ['fake_drop', 'fake_keep'] });
    expect(response.status).toBe(200);
    expect(parseJson(response.text)).toEqual({ toolNames: ['fake_drop', 'fake_keep'] });
    expect(storedTools(store, account.id)).toEqual(['fake_drop', 'fake_keep']);
  });

  it('Empty array enables every tool', async () => {
    const { app } = createApp({});
    const { account, configId } = await assignOne(app);
    await request(app)
      .put(`/api/configurations/${configId}/accounts/${account.id}/disabled-tools`)
      .set('Content-Type', 'application/json')
      .send({ toolNames: ['fake_drop'] });
    const response = await request(app)
      .put(`/api/configurations/${configId}/accounts/${account.id}/disabled-tools`)
      .set('Content-Type', 'application/json')
      .send({ toolNames: [] });
    expect(response.status).toBe(200);
    expect(parseJson(response.text)).toEqual({ toolNames: [] });
    const again = await request(app).get(
      `/api/configurations/${configId}/accounts/${account.id}/disabled-tools`,
    );
    expect(parseJson(again.text)).toEqual({ toolNames: [] });
  });

  it('Duplicate tool names reject without write', async () => {
    const { app, store } = createApp({});
    const { account, configId } = await assignOne(app);
    const response = await request(app)
      .put(`/api/configurations/${configId}/accounts/${account.id}/disabled-tools`)
      .set('Content-Type', 'application/json')
      .send({ toolNames: ['fake_drop', 'fake_drop'] });
    expect(response.status).toBe(400);
    expect(storedTools(store, account.id)).toBeUndefined();
  });

  it('Empty tool name rejects without write', async () => {
    const { app, store } = createApp({});
    const { account, configId } = await assignOne(app);
    const response = await request(app)
      .put(`/api/configurations/${configId}/accounts/${account.id}/disabled-tools`)
      .set('Content-Type', 'application/json')
      .send({ toolNames: [''] });
    expect(response.status).toBe(400);
    expect(storedTools(store, account.id)).toBeUndefined();
  });

  it('Unknown tool name rejects without write', async () => {
    const { app, store } = createApp({});
    const { account, configId } = await assignOne(app);
    const response = await request(app)
      .put(`/api/configurations/${configId}/accounts/${account.id}/disabled-tools`)
      .set('Content-Type', 'application/json')
      .send({ toolNames: ['other_drop'] });
    expect(response.status).toBe(400);
    expect(storedTools(store, account.id)).toBeUndefined();
  });

  it('Account not assigned rejects without write', async () => {
    const { app, store } = createApp({});
    const account = await createAccount(app);
    const configResponse = await request(app)
      .post('/api/configurations')
      .set('Content-Type', 'application/json')
      .send({ name: 'Ops' });
    const config = asConfigPublic(parseJson(configResponse.text));
    const response = await request(app)
      .put(`/api/configurations/${config.id}/accounts/${account.id}/disabled-tools`)
      .set('Content-Type', 'application/json')
      .send({ toolNames: [] });
    expect(response.status).toBe(400);
    expect(storedTools(store, account.id)).toBeUndefined();
    const read = await request(app).get(
      `/api/configurations/${config.id}/accounts/${account.id}/disabled-tools`,
    );
    expect(read.status).toBe(400);
  });

  it('Unknown configuration is 404', async () => {
    const { app } = createApp({});
    const response = await request(app).get(
      '/api/configurations/missing/accounts/a1/disabled-tools',
    );
    expect(response.status).toBe(404);
    expect(response.text).toBe('Not Found');
    expect(response.text).not.toContain(FIXTURE_SECRET);
  });

  it('Non-JSON PUT does not write', async () => {
    const { app } = createApp({});
    const { account, configId } = await assignOne(app);
    const response = await request(app)
      .put(`/api/configurations/${configId}/accounts/${account.id}/disabled-tools`)
      .set('Content-Type', 'text/plain')
      .send('{ "toolNames": ["fake_drop"] }');
    expect(response.status).toBe(415);
    const again = await request(app).get(
      `/api/configurations/${configId}/accounts/${account.id}/disabled-tools`,
    );
    expect(again.status).toBe(200);
    expect(parseJson(again.text)).toEqual({ toolNames: [] });
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
