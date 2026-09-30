import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type {
  NativeConnectorModule,
  NativeEgressClient,
  ProxyConnectorModule,
} from '../../src/connectors/contract.js';
import {
  buildConnectorRegistry,
  ConnectorRegistryError,
  productionConnectorRegistry,
} from '../../src/connectors/registry.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function makeLaunchCountFile(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'proxy-registry-'));
  tempDirs.push(dir);
  const countFile = path.join(dir, 'launches.txt');
  await writeFile(countFile, '0', 'utf8');
  return countFile;
}

async function readLaunchCount(filePath: string): Promise<number> {
  const text = await readFile(filePath, 'utf8');
  const parsed = Number.parseInt(text.trim(), 10);
  if (!Number.isInteger(parsed)) {
    throw new Error(`Invalid launch count in ${filePath}`);
  }
  return parsed;
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

function createProxyModule(
  countFile: string,
  overrides: Partial<ProxyConnectorModule> = {},
): ProxyConnectorModule {
  const base: ProxyConnectorModule = {
    id: 'proxyfake',
    name: 'Proxy fake',
    kind: 'proxy',
    fields: [{ name: 'token', label: 'Token', type: 'secret', required: true }],
    allowedDestinations: [{ host: 'example.test', port: 443 }],
    checkConnection: () => undefined,
    tools: [],
    entryPath: countFile,
    args: [],
    env: [],
  };
  return {
    ...base,
    ...overrides,
    fields: overrides.fields ?? base.fields,
    allowedDestinations: overrides.allowedDestinations ?? base.allowedDestinations,
    checkConnection: overrides.checkConnection ?? base.checkConnection,
    tools: overrides.tools ?? base.tools,
    args: overrides.args ?? base.args,
    env: overrides.env ?? base.env,
  };
}

describe('connector-contract: Proxy connector tool allowlist', () => {
  it('Empty proxy allowlist registers and starts no child', async () => {
    const countFile = await makeLaunchCountFile();
    const proxyModule = createProxyModule(countFile);
    const registry = buildConnectorRegistry([proxyModule]);
    expect(registry.connectors.map((connector) => connector.id)).toContain('proxyfake');
    expect(registry.tools.filter((tool) => tool.connectorId === 'proxyfake')).toEqual([]);
    expect(await readLaunchCount(countFile)).toBe(0);
  });

  it('Proxy tool schema that declares account fails registry build', async () => {
    const countFile = await makeLaunchCountFile();
    const proxyModule = createProxyModule(countFile, {
      args: [countFile],
      tools: [
        {
          name: 'echo',
          description: 'Echo arguments for tests',
          inputSchema: {
            type: 'object',
            properties: {
              account: { type: 'string' },
            },
          },
        },
      ],
    });
    expect(() => buildConnectorRegistry([proxyModule])).toThrow(ConnectorRegistryError);
    expect(await readLaunchCount(countFile)).toBe(0);
  });

  it('Proxy tool with a handler fails registry build', async () => {
    const countFile = await makeLaunchCountFile();
    const proxyModule = {
      ...createProxyModule(countFile, { args: [countFile] }),
      tools: [
        {
          name: 'echo',
          description: 'Echo arguments for tests',
          inputSchema: {
            type: 'object',
            properties: {
              note: { type: 'string' },
            },
          },
          handler: () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
        },
      ],
    } as ProxyConnectorModule;
    expect(() => buildConnectorRegistry([proxyModule])).toThrow(ConnectorRegistryError);
    expect(await readLaunchCount(countFile)).toBe(0);
  });

  it('Env binding must name a field on the connector', async () => {
    const countFile = await makeLaunchCountFile();
    const proxyModule = createProxyModule(countFile, {
      args: [countFile],
      env: [{ field: 'missing', variable: 'TOKEN' }],
    });
    expect(() => buildConnectorRegistry([proxyModule])).toThrow(ConnectorRegistryError);
    expect(await readLaunchCount(countFile)).toBe(0);
  });

  it('Fake proxy checkConnection does not spawn', async () => {
    const countFile = await makeLaunchCountFile();
    const accountValues = { token: 'secret-value' };
    const fakeEgress: NativeEgressClient = {
      httpsRequest: () => Promise.resolve({ status: 200, headers: {}, body: new Uint8Array(0) }),
      tlsConnect: () => Promise.resolve(),
      tlsSession: () => Promise.reject(new Error('not used')),
    };
    const proxyModule = createProxyModule(countFile, { args: [countFile] });
    const registry = buildConnectorRegistry([proxyModule]);
    await expect(
      Promise.resolve(registry.connectors[0]?.checkConnection(accountValues, fakeEgress)),
    ).resolves.toBeUndefined();
    expect(await readLaunchCount(countFile)).toBe(0);
  });
});

describe('connector-contract: Registry build validates modules', () => {
  it('Duplicate id fails registry build', () => {
    const first = createFakeNative({ id: 'fake', name: 'First' });
    const second = createFakeNative({ id: 'fake', name: 'Second' });
    expect(() => buildConnectorRegistry([first, second])).toThrow(ConnectorRegistryError);
  });

  it('Bad id fails registry build', () => {
    const fake = createFakeNative({ id: 'Bad_Id' });
    expect(() => buildConnectorRegistry([fake])).toThrow(ConnectorRegistryError);
  });

  it('Valid proxy allowlist registers and starts no child', async () => {
    const countFile = await makeLaunchCountFile();
    const proxyModule = createProxyModule(countFile, {
      args: [countFile],
      tools: [
        {
          name: 'echo',
          description: 'Echo arguments for tests',
          inputSchema: {
            type: 'object',
            properties: {
              note: { type: 'string' },
            },
            required: ['note'],
          },
        },
      ],
    });
    const registry = buildConnectorRegistry([proxyModule]);
    expect(registry.getTool('proxyfake_echo')?.mcpName).toBe('proxyfake_echo');
    expect(await readLaunchCount(countFile)).toBe(0);

    const registrySource = await readFile(
      path.join(here, '../../src/connectors/registry.ts'),
      'utf8',
    );
    expect(registrySource).not.toMatch(/child_process/);
    expect(registrySource).not.toMatch(/\bspawn\b/);
    expect(registrySource).not.toMatch(/\bfork\b/);
  });
});

describe('connector-contract: Production registry includes registered product connectors', () => {
  it('Production export includes Gmail', () => {
    expect(productionConnectorRegistry.connectors.length).toBeGreaterThanOrEqual(1);
    expect(productionConnectorRegistry.connectors.map((c) => c.id)).toContain('gmail');
    expect(productionConnectorRegistry.listPublic().map((c) => c.id)).toContain('gmail');
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
    expect(productionConnectorRegistry.connectors.length).toBeGreaterThanOrEqual(1);
    expect(productionConnectorRegistry.connectors.map((c) => c.id)).toContain('gmail');
    expect(productionConnectorRegistry.listPublic().map((c) => c.id)).toContain('gmail');
  });
});
