import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  GMAIL_IMAP_HOST,
  GMAIL_IMAP_PORT,
  GMAIL_SMTP_HOST,
  GMAIL_SMTP_PORT,
  gmailConnector,
} from '../../../src/connectors/gmail/index.js';
import {
  buildConnectorRegistry,
  productionConnectorRegistry,
} from '../../../src/connectors/registry.js';
import { createAdminApp } from '../../../src/http/createAdminApp.js';
import type { JsonObject } from '../../../src/store/codec.js';
import type { EncryptedStore } from '../../../src/store/store.js';
import { createGmailFakeEgressTransport } from './fake-egress.js';

const FIXTURE_PASSWORD = 'gmail-fixture-app-password-UNIQUE';
const FIXTURE_ADDRESS = 'user@gmail.com';

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

describe('connector-gmail: Gmail connector module identity and fields', () => {
  it('Production registry lists Gmail with Address and App password fields', () => {
    const listed = productionConnectorRegistry.listPublic();
    expect(listed.length).toBeGreaterThanOrEqual(1);
    const gmail = listed.find((connector) => connector.id === 'gmail');
    expect(gmail).toEqual(
      expect.objectContaining({
        id: 'gmail',
        name: 'Gmail',
        kind: 'native',
      }),
    );
    expect(gmail?.fields).toEqual(
      expect.arrayContaining([
        { name: 'address', label: 'Address', type: 'text', required: true },
        { name: 'password', label: 'App password', type: 'secret', required: true },
      ]),
    );
  });

  it('Gmail allowlist is the two constant hosts', () => {
    const module = productionConnectorRegistry.connectors.find(
      (connector) => connector.id === 'gmail',
    );
    expect(module?.allowedDestinations).toEqual([
      { host: GMAIL_IMAP_HOST, port: GMAIL_IMAP_PORT },
      { host: GMAIL_SMTP_HOST, port: GMAIL_SMTP_PORT },
    ]);
    expect(gmailConnector.allowedDestinations).toEqual([
      { host: 'imap.gmail.com', port: 993 },
      { host: 'smtp.gmail.com', port: 465 },
    ]);
  });
});

describe('connector-contract: Production registry includes registered product connectors', () => {
  it('Production export includes Gmail', () => {
    expect(productionConnectorRegistry.connectors.length).toBeGreaterThanOrEqual(1);
    expect(productionConnectorRegistry.connectors.map((c) => c.id)).toContain('gmail');
  });

  it('Tests inject a fake instead of using production for fake assertions', () => {
    const fake = {
      ...gmailConnector,
      id: 'fakemail',
      name: 'Fake Mail',
      checkConnection: () => undefined,
      tools: [],
    };
    const registry = buildConnectorRegistry([fake]);
    expect(registry.connectors.map((c) => c.id)).toContain('fakemail');
    expect(productionConnectorRegistry.connectors.map((c) => c.id)).not.toContain('fakemail');
  });
});

describe('connector-gmail: Gmail connection check uses IMAP LOGIN and SMTP AUTH over egress', () => {
  it('Successful check when fake IMAP and SMTP both accept login', async () => {
    const store = createMemoryStore({});
    const transport = createGmailFakeEgressTransport({
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
        connector: 'gmail',
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
    const transport = createGmailFakeEgressTransport({
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
        connector: 'gmail',
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
    const transport = createGmailFakeEgressTransport({
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
        connector: 'gmail',
        label: 'Inbox',
        values: { address: FIXTURE_ADDRESS, password: FIXTURE_PASSWORD },
      });

    expect(response.status).toBe(400);
    expect(response.text).toBe('Connection check failed');
    expect(response.text).not.toContain(FIXTURE_PASSWORD);
    expect(store.read().accounts ?? []).toEqual([]);
  });
});
