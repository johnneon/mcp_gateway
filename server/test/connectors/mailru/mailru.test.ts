import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { NativeEgressClient } from '../../../src/connectors/contract.js';
import type { EgressTransport } from '../../../src/connectors/native/egress.js';
import {
  MAILRU_IMAP_HOST,
  MAILRU_IMAP_PORT,
  MAILRU_SMTP_HOST,
  MAILRU_SMTP_PORT,
  mailruConnector,
} from '../../../src/connectors/mailru/index.js';
import { productionConnectorRegistry } from '../../../src/connectors/registry.js';
import { createAdminApp } from '../../../src/http/createAdminApp.js';
import type { JsonObject } from '../../../src/store/codec.js';
import type { EncryptedStore } from '../../../src/store/store.js';
import { createMailruFakeEgressTransport } from './fake-egress.js';

const FIXTURE_PASSWORD = 'mailru-fixture-app-password-UNIQUE';
const FIXTURE_ADDRESS = 'user@mail.ru';
const here = path.dirname(fileURLToPath(import.meta.url));

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

function asEgressClient(transport: EgressTransport): NativeEgressClient {
  const signal = new AbortController().signal;
  return {
    httpsRequest: () => Promise.reject(new Error('https not used')),
    tlsConnect: () => Promise.reject(new Error('tlsConnect not used')),
    tlsSession: (params) => transport.tlsSession({ ...params, signal }),
  };
}

describe('connector-mail-ru: Mail.ru connector module identity and fields', () => {
  it('Production registry lists Mail.ru with Address and App password fields', () => {
    const listed = productionConnectorRegistry.listPublic();
    const mailru = listed.find((connector) => connector.id === 'mailru');
    expect(mailru).toEqual(
      expect.objectContaining({
        id: 'mailru',
        name: 'Mail.ru',
        kind: 'native',
      }),
    );
    expect(mailru?.fields).toEqual([
      { name: 'address', label: 'Address', type: 'text', required: true },
      { name: 'password', label: 'App password', type: 'secret', required: true },
    ]);
    expect(listed.map((connector) => connector.id)).toContain('gmail');
  });

  it('Mail.ru allowlist is the two constant hosts', () => {
    const module = productionConnectorRegistry.connectors.find(
      (connector) => connector.id === 'mailru',
    );
    expect(module?.allowedDestinations).toEqual([
      { host: 'imap.mail.ru', port: 993 },
      { host: 'smtp.mail.ru', port: 465 },
    ]);
    expect(mailruConnector.allowedDestinations).toEqual([
      { host: MAILRU_IMAP_HOST, port: MAILRU_IMAP_PORT },
      { host: MAILRU_SMTP_HOST, port: MAILRU_SMTP_PORT },
    ]);
  });
});

describe('connector-contract: Production registry includes registered product connectors', () => {
  it('Production export includes Mail.ru alongside Gmail', () => {
    const listed = productionConnectorRegistry.listPublic();
    expect(listed.map((connector) => connector.id)).toContain('mailru');
    expect(listed.map((connector) => connector.id)).toContain('gmail');
  });
});

describe('connector-mail-ru: Mail.ru connection check uses IMAP LOGIN and SMTP AUTH over egress', () => {
  it('Successful check when fake IMAP and SMTP both accept login', async () => {
    const store = createMemoryStore({});
    const transport = createMailruFakeEgressTransport({
      imap: { user: FIXTURE_ADDRESS, password: FIXTURE_PASSWORD, acceptLogin: true },
      smtp: { user: FIXTURE_ADDRESS, password: FIXTURE_PASSWORD, acceptAuth: true },
    });
    const app = createAdminApp({
      store,
      connectorRegistry: productionConnectorRegistry,
      egressTransport: transport,
    });

    const response = await request(app)
      .post('/api/accounts')
      .set('Content-Type', 'application/json')
      .send({
        connector: 'mailru',
        label: 'Inbox',
        values: { address: FIXTURE_ADDRESS, password: FIXTURE_PASSWORD },
      });

    expect(response.status).toBe(201);
    expect(response.text).not.toContain(FIXTURE_PASSWORD);
    const accounts = store.read().accounts as JsonObject[];
    expect(accounts).toHaveLength(1);
    expect((accounts[0]?.values as Record<string, string>).password).toBe(FIXTURE_PASSWORD);
  });

  it('Failed check when fake IMAP rejects login', async () => {
    const store = createMemoryStore({});
    const transport = createMailruFakeEgressTransport({
      imap: { user: FIXTURE_ADDRESS, password: FIXTURE_PASSWORD, acceptLogin: false },
      smtp: { user: FIXTURE_ADDRESS, password: FIXTURE_PASSWORD, acceptAuth: true },
    });
    const app = createAdminApp({
      store,
      connectorRegistry: productionConnectorRegistry,
      egressTransport: transport,
    });

    const response = await request(app)
      .post('/api/accounts')
      .set('Content-Type', 'application/json')
      .send({
        connector: 'mailru',
        label: 'Inbox',
        values: { address: FIXTURE_ADDRESS, password: FIXTURE_PASSWORD },
      });

    expect(response.status).toBe(400);
    expect(response.text).toBe('Connection check failed');
    expect(response.text).not.toContain(FIXTURE_PASSWORD);
    expect(store.read().accounts ?? []).toEqual([]);
  });

  it('Failed check when fake SMTP rejects AUTH', async () => {
    const store = createMemoryStore({});
    const transport = createMailruFakeEgressTransport({
      imap: { user: FIXTURE_ADDRESS, password: FIXTURE_PASSWORD, acceptLogin: true },
      smtp: { user: FIXTURE_ADDRESS, password: FIXTURE_PASSWORD, acceptAuth: false },
    });
    const app = createAdminApp({
      store,
      connectorRegistry: productionConnectorRegistry,
      egressTransport: transport,
    });

    const response = await request(app)
      .post('/api/accounts')
      .set('Content-Type', 'application/json')
      .send({
        connector: 'mailru',
        label: 'Inbox',
        values: { address: FIXTURE_ADDRESS, password: FIXTURE_PASSWORD },
      });

    expect(response.status).toBe(400);
    expect(response.text).toBe('Connection check failed');
    expect(response.text).not.toContain(FIXTURE_PASSWORD);
    expect(store.read().accounts ?? []).toEqual([]);
  });
});

describe('connector-mail-ru: Mail.ru uses the shared mail protocol module', () => {
  it('Mail.ru login uses the shared module over the egress duplex', async () => {
    const transport = createMailruFakeEgressTransport({
      imap: { user: FIXTURE_ADDRESS, password: FIXTURE_PASSWORD, acceptLogin: true },
      smtp: { user: FIXTURE_ADDRESS, password: FIXTURE_PASSWORD, acceptAuth: true },
    });

    await mailruConnector.checkConnection(
      { address: FIXTURE_ADDRESS, password: FIXTURE_PASSWORD },
      asEgressClient(transport),
    );

    expect(transport.tlsSessionCallCount).toBe(2);

    const source = await readFile(
      path.join(here, '../../../src/connectors/mailru/index.ts'),
      'utf8',
    );
    expect(source).toMatch(/from '\.\.\/mail\/index\.js'/);
    expect(source).toMatch(/createImapClient/);
    expect(source).toMatch(/createSmtpClient/);
    expect(source).not.toMatch(/node:net/);
    expect(source).not.toMatch(/node:tls/);
    expect(source).not.toMatch(/\bcreateConnection\b/);
    expect(source).not.toMatch(/tls\.connect/);
    expect(source).not.toMatch(/\bnet\.connect\b/);
  });
});
