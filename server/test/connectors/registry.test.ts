import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ConnectorModule, NativeEgressClient } from '../../src/connectors/contract.js';
import {
  buildConnectorRegistry,
  ConnectorRegistryError,
  productionConnectorRegistry,
} from '../../src/connectors/registry.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function createFakeNative(overrides: Partial<ConnectorModule> = {}): ConnectorModule {
  const base: ConnectorModule = {
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

describe('connector-contract: Native connector module shape', () => {
  it('Fake native connector satisfies the contract', () => {
    const fake = createFakeNative();
    const registry = buildConnectorRegistry([fake]);
    expect(registry.connectors).toHaveLength(1);
    expect(registry.connectors[0]?.id).toBe('fake');
  });

  it('Connection check is callable without HTTP exposure', async () => {
    const accountValues = { user: 'u', token: 'secret-value', mailhost: 'mail.example.test' };
    const fakeEgress: NativeEgressClient = {
      httpsRequest: () => Promise.resolve({ status: 200, headers: {}, body: new Uint8Array(0) }),
      tlsConnect: () => Promise.resolve(),
      tlsSession: () => Promise.reject(new Error('not used')),
    };
    const fake = createFakeNative({
      checkConnection: (values, egressClient) => {
        expect(values).toEqual(accountValues);
        expect(egressClient).toBe(fakeEgress);
      },
    });
    const registry = buildConnectorRegistry([fake]);
    await expect(
      Promise.resolve(registry.connectors[0]?.checkConnection(accountValues, fakeEgress)),
    ).resolves.toBeUndefined();
  });
});

describe('connector-contract: Account field description', () => {
  it('Valid fields are accepted', () => {
    const fake = createFakeNative({
      fields: [
        { name: 'user', label: 'User', type: 'text', required: true },
        { name: 'token', label: 'Token', type: 'secret', required: true },
        { name: 'mailhost', label: 'Mail host', type: 'host', required: true },
      ],
      allowedDestinations: [{ field: 'mailhost', port: 993 }],
    });
    expect(() => buildConnectorRegistry([fake])).not.toThrow();
  });
});

describe('connector-contract: Allowed destinations as host and port pairs', () => {
  it('Constant and field-backed destinations are accepted', () => {
    const fake = createFakeNative({
      fields: [{ name: 'mailhost', label: 'Mail host', type: 'host', required: true }],
      allowedDestinations: [
        { host: 'imap.example.test', port: 993 },
        { field: 'mailhost', port: 993 },
      ],
    });
    expect(() => buildConnectorRegistry([fake])).not.toThrow();
  });

  it('Field-backed destination must name a host field', () => {
    const fake = createFakeNative({
      fields: [{ name: 'user', label: 'User', type: 'text', required: true }],
      allowedDestinations: [{ field: 'missing', port: 993 }],
    });
    expect(() => buildConnectorRegistry([fake])).toThrow(ConnectorRegistryError);
  });
});

describe('connector-contract: Registry build validates and rejects proxy', () => {
  it('Duplicate id fails registry build', () => {
    const first = createFakeNative({ id: 'fake', name: 'First' });
    const second = createFakeNative({ id: 'fake', name: 'Second' });
    expect(() => buildConnectorRegistry([first, second])).toThrow(ConnectorRegistryError);
  });

  it('Bad id fails registry build', () => {
    const fake = createFakeNative({ id: 'Bad_Id' });
    expect(() => buildConnectorRegistry([fake])).toThrow(ConnectorRegistryError);
  });

  it('Proxy kind fails registry build', async () => {
    const proxyModule = createFakeNative({ kind: 'proxy' });
    expect(() => buildConnectorRegistry([proxyModule])).toThrow(ConnectorRegistryError);

    // Build rejects proxy in-process; the registry module never starts a child.
    const registrySource = await readFile(
      path.join(here, '../../src/connectors/registry.ts'),
      'utf8',
    );
    expect(registrySource).not.toMatch(/child_process/);
    expect(registrySource).not.toMatch(/\bspawn\b/);
    expect(registrySource).not.toMatch(/\bfork\b/);
  });
});

describe('connector-contract: Production registry is empty', () => {
  it('Production export has no connectors', () => {
    expect(productionConnectorRegistry.connectors).toHaveLength(0);
    expect(productionConnectorRegistry.listPublic()).toHaveLength(0);
  });
});

describe('connector-contract: Native connector tools', () => {
  it('Fake native connector with tools builds into a registry', () => {
    const fake = createFakeNative({
      tools: [
        {
          name: 'echo',
          description: 'Echo arguments for tests',
          inputSchema: {
            type: 'object',
            properties: {
              message: { type: 'string' },
            },
            required: ['message'],
          },
          handler: () => ({ content: [{ type: 'text', text: 'ok' }] }),
        },
      ],
    });
    const registry = buildConnectorRegistry([fake]);
    expect(registry.getTool('fake_echo')?.mcpName).toBe('fake_echo');
    expect(registry.tools.map((tool) => tool.mcpName)).toContain('fake_echo');
  });

  it('Tool schema that declares account fails registry build', () => {
    const fake = createFakeNative({
      tools: [
        {
          name: 'echo',
          description: 'Echo arguments for tests',
          inputSchema: {
            type: 'object',
            properties: {
              account: { type: 'string' },
              message: { type: 'string' },
            },
          },
          handler: () => ({ content: [{ type: 'text', text: 'ok' }] }),
        },
      ],
    });
    expect(() => buildConnectorRegistry([fake])).toThrow(ConnectorRegistryError);
  });

  it('Production registry stays empty', () => {
    expect(productionConnectorRegistry.connectors).toHaveLength(0);
    expect(productionConnectorRegistry.tools).toHaveLength(0);
    expect(productionConnectorRegistry.listPublic()).toHaveLength(0);
  });
});
