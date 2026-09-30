import { describe, expect, it, vi } from 'vitest';
import {
  AccountNotFoundError,
  AccountValidationError,
  ConnectionCheckFailedError,
} from '../../src/accounts/errors.js';
import { createAccountsService } from '../../src/accounts/service.js';
import type {
  AccountFieldValues,
  ConnectorModule,
  NativeConnectorModule,
  NativeEgressClient,
} from '../../src/connectors/contract.js';
import { buildConnectorRegistry } from '../../src/connectors/registry.js';
import { createConfigurationsService } from '../../src/configurations/service.js';
import type { JsonObject } from '../../src/store/codec.js';
import type { EncryptedStore } from '../../src/store/store.js';

const FIXTURE_SECRET = 'fixture-secret-value-do-not-leak';

type AccountFieldValues = Record<string, string>;

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

function createFakeConnector(
  overrides: Partial<NativeConnectorModule> = {},
): NativeConnectorModule {
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

function createServices(checkConnection?: ConnectorModule['checkConnection']) {
  const store = createMemoryStore({});
  const configurations = createConfigurationsService(store);
  const connector = createFakeConnector(checkConnection ? { checkConnection } : undefined);
  const registry = buildConnectorRegistry([connector]);
  const accounts = createAccountsService({
    store,
    connectorRegistry: registry,
    configurations,
  });
  return { store, configurations, accounts, connector };
}

describe('accounts-api: Accounts document shape', () => {
  it('Empty document reads as an empty accounts list', () => {
    const { accounts } = createServices();
    expect(accounts.list()).toEqual([]);
  });

  it('Stored account keeps id, connector, label, values, and enabled', async () => {
    const { store, accounts } = createServices();
    const created = await accounts.create({
      connector: 'fake',
      label: 'Work',
      values: validValues(),
    });
    expect(created.enabled).toBe(true);
    expect(created.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    const entry = (store.read().accounts as JsonObject[])[0];
    expect(typeof entry.id).toBe('string');
    expect(entry.connector).toBe('fake');
    expect(entry.label).toBe('Work');
    expect(entry.enabled).toBe(true);
    expect(entry.values).toEqual(validValues());
  });
});

describe('accounts-api: List accounts without secret values', () => {
  it('Secret keys are absent from list values', async () => {
    const { accounts } = createServices();
    await accounts.create({
      connector: 'fake',
      label: 'Work',
      values: validValues(),
    });
    const listed = accounts.list();
    expect(listed).toHaveLength(1);
    expect(listed[0].values).toEqual({
      user: 'alice',
      mailhost: 'mail.example.test',
    });
    expect(listed[0].values).not.toHaveProperty('token');
    expect(JSON.stringify(listed)).not.toContain(FIXTURE_SECRET);
  });
});

describe('accounts-api: Create account after connection check', () => {
  it('Successful create after checkConnection', async () => {
    const checkConnection = vi.fn(() => undefined);
    const { store, accounts } = createServices(checkConnection);
    const created = await accounts.create({
      connector: 'fake',
      label: '  Work  ',
      values: validValues(),
    });
    expect(checkConnection).toHaveBeenCalledWith(
      validValues(),
      expect.objectContaining({
        httpsRequest: expect.any(Function) as unknown,
        tlsConnect: expect.any(Function) as unknown,
        tlsSession: expect.any(Function) as unknown,
      }),
    );
    expect(created.label).toBe('Work');
    expect(created.enabled).toBe(true);
    expect(created.values).not.toHaveProperty('token');
    expect(JSON.stringify(created)).not.toContain(FIXTURE_SECRET);
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
    const { accounts } = createServices(checkConnection);
    const created = await accounts.create({
      connector: 'fake',
      label: 'Work',
      values: validValues(),
    });
    expect(created.enabled).toBe(true);
    expect(sawEgress).toBe(true);
    expect(checkConnection).toHaveBeenCalledTimes(1);
  });

  it('Unknown connector id is 400 without write', async () => {
    const { accounts } = createServices();
    await expect(
      accounts.create({ connector: 'missing', label: 'X', values: {} }),
    ).rejects.toBeInstanceOf(AccountValidationError);
    expect(accounts.list()).toEqual([]);
  });

  it('Connection check failure does not save', async () => {
    const { accounts } = createServices(() => {
      throw new Error(`boom ${FIXTURE_SECRET}`);
    });
    await expect(
      accounts.create({
        connector: 'fake',
        label: 'Work',
        values: validValues(),
      }),
    ).rejects.toBeInstanceOf(ConnectionCheckFailedError);
    try {
      await accounts.create({
        connector: 'fake',
        label: 'Work',
        values: validValues(),
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ConnectionCheckFailedError);
      expect((error as Error).message).toBe('Connection check failed');
      expect((error as Error).message).not.toContain(FIXTURE_SECRET);
    }
    expect(accounts.list()).toEqual([]);
  });

  it('Host value with scheme is rejected', async () => {
    const checkConnection = vi.fn(() => undefined);
    const { accounts } = createServices(checkConnection);
    await expect(
      accounts.create({
        connector: 'fake',
        label: 'Work',
        values: validValues({ mailhost: 'https://mail.example.test' }),
      }),
    ).rejects.toBeInstanceOf(AccountValidationError);
    expect(checkConnection).not.toHaveBeenCalled();
    expect(accounts.list()).toEqual([]);
  });

  it('Unknown values key is rejected', async () => {
    const checkConnection = vi.fn(() => undefined);
    const { accounts } = createServices(checkConnection);
    await expect(
      accounts.create({
        connector: 'fake',
        label: 'Work',
        values: { ...validValues(), extra: 'nope' },
      }),
    ).rejects.toBeInstanceOf(AccountValidationError);
    expect(checkConnection).not.toHaveBeenCalled();
    expect(accounts.list()).toEqual([]);
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
    const { store, accounts } = createServices(checkConnection);
    const created = await accounts.create({
      connector: 'fake',
      label: 'Work',
      values: validValues(),
    });
    checkConnection.mockClear();
    seen.length = 0;
    sawEgress = false;

    const patched = await accounts.patch(created.id, { values: { token: '' } });
    expect(checkConnection).toHaveBeenCalledTimes(1);
    expect(seen[0]?.token).toBe(FIXTURE_SECRET);
    expect(sawEgress).toBe(true);
    expect(patched.values).not.toHaveProperty('token');
    expect(JSON.stringify(patched)).not.toContain(FIXTURE_SECRET);
    const stored = (store.read().accounts as Array<{ values: Record<string, string> }>)[0];
    expect(stored.values.token).toBe(FIXTURE_SECRET);
  });

  it('Enabled-only patch skips checkConnection', async () => {
    const checkConnection = vi.fn(() => undefined);
    const { accounts } = createServices(checkConnection);
    const created = await accounts.create({
      connector: 'fake',
      label: 'Work',
      values: validValues(),
    });
    checkConnection.mockClear();

    const patched = await accounts.patch(created.id, { enabled: false });
    expect(patched.enabled).toBe(false);
    expect(checkConnection).not.toHaveBeenCalled();
  });

  it('Empty required non-secret on patch is 400', async () => {
    const { store, accounts } = createServices();
    const created = await accounts.create({
      connector: 'fake',
      label: 'Work',
      values: validValues(),
    });
    await expect(accounts.patch(created.id, { values: { user: '' } })).rejects.toBeInstanceOf(
      AccountValidationError,
    );
    const stored = (store.read().accounts as Array<{ values: Record<string, string> }>)[0];
    expect(stored.values.user).toBe('alice');
  });
});

describe('accounts-api: Check connection without write', () => {
  it('Check succeeds without writing', async () => {
    const { store, accounts } = createServices();
    const created = await accounts.create({
      connector: 'fake',
      label: 'Work',
      values: validValues(),
    });
    const before = JSON.stringify(store.read());
    await accounts.check(created.id);
    expect(JSON.stringify(store.read())).toBe(before);
  });

  it('Explicit check passes egress client', async () => {
    let sawEgress = false;
    const checkConnection = vi.fn(
      (_values: AccountFieldValues, egressClient: NativeEgressClient) => {
        sawEgress = typeof egressClient.tlsSession === 'function';
      },
    );
    const { accounts } = createServices(checkConnection);
    const created = await accounts.create({
      connector: 'fake',
      label: 'Work',
      values: validValues(),
    });
    sawEgress = false;
    checkConnection.mockClear();
    await accounts.check(created.id);
    expect(sawEgress).toBe(true);
    expect(checkConnection).toHaveBeenCalledTimes(1);
  });

  it('Check failure returns fixed body', async () => {
    let fail = false;
    const { accounts } = createServices(() => {
      if (fail) {
        throw new Error(`leak ${FIXTURE_SECRET}`);
      }
    });
    const created = await accounts.create({
      connector: 'fake',
      label: 'Work',
      values: validValues(),
    });
    fail = true;
    try {
      await accounts.check(created.id);
      expect.unreachable('expected check to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ConnectionCheckFailedError);
      expect((error as Error).message).toBe('Connection check failed');
      expect((error as Error).message).not.toContain(FIXTURE_SECRET);
    }
  });
});

describe('accounts-api: Delete account removes it from configurations', () => {
  it('Delete cascades out of configuration accountIds', async () => {
    const { accounts, configurations } = createServices();
    const account = await accounts.create({
      connector: 'fake',
      label: 'Work',
      values: validValues(),
    });
    const config = await configurations.create('Ops');
    await configurations.setAccountIds(config.id, [account.id]);
    await accounts.remove(account.id);
    expect(accounts.list()).toEqual([]);
    expect(configurations.list()[0].accountIds).toEqual([]);
  });

  it('Unknown account id on remove throws not found', async () => {
    const { accounts } = createServices();
    await expect(accounts.remove('missing')).rejects.toBeInstanceOf(AccountNotFoundError);
  });
});
