import http from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ProxyConnectorModule } from '../../src/connectors/contract.js';
import {
  createProxyRuntime,
  PROXY_IDLE_TIMEOUT_MS,
  type ProxyRuntime,
} from '../../src/connectors/proxy/runtime.js';
import { buildConnectorRegistry, type ConnectorRegistry } from '../../src/connectors/registry.js';
import { createMcpApp } from '../../src/http/createMcpApp.js';
import type { JsonObject } from '../../src/store/codec.js';
import type { EncryptedStore } from '../../src/store/store.js';
import { hashToken } from '../../src/token/token.js';

const require = createRequire(import.meta.url);

const CONNECTOR_ID = 'stdiofake';
const ACCOUNT_ID = 'acc-proxy';
const ACCOUNT_LABEL = 'Proxy box';
const ACCOUNT_SECRET = 'proxy-account-secret-UNIQUE';
const CONFIG_TOKEN = 'proxy-list-bearer-UNIQUE';

const inputSchema = z
  .object({
    required: z.array(z.string()).optional(),
    properties: z
      .object({
        account: z
          .object({
            enum: z.array(z.string()).optional(),
            description: z.string().optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const listedToolSchema = z
  .object({
    name: z.string(),
    inputSchema,
  })
  .passthrough();

type ListedTool = z.infer<typeof listedToolSchema>;

const openServers: http.Server[] = [];
const tempDirs: string[] = [];
const openRuntimes: ProxyRuntime[] = [];

afterEach(async () => {
  while (openRuntimes.length > 0) {
    const runtime = openRuntimes.pop();
    if (runtime !== undefined) {
      await runtime.close();
    }
  }
  while (openServers.length > 0) {
    const server = openServers.pop();
    if (server !== undefined) {
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
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
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

async function makeLaunchCountFile(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'proxy-list-'));
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

function proxyConnector(countFile: string): ProxyConnectorModule {
  return {
    id: CONNECTOR_ID,
    name: 'Stdio fake',
    kind: 'proxy',
    fields: [{ name: 'token', label: 'Token', type: 'secret', required: true }],
    allowedDestinations: [{ host: 'example.test', port: 443 }],
    checkConnection: () => undefined,
    entryPath: require.resolve('@mcp-gateway/fake-stdio-mcp'),
    args: [countFile],
    env: [{ field: 'token', variable: 'TOKEN' }],
    tools: [
      {
        name: 'echo_args',
        description: 'Echo the note argument',
        inputSchema: {
          type: 'object',
          properties: { note: { type: 'string' } },
          required: ['note'],
        },
      },
      {
        name: 'leak_secret',
        description: 'Return the mapped secret',
        inputSchema: { type: 'object', properties: {} },
      },
    ],
  };
}

function storeForProxyAccount(accountIds: string[]): EncryptedStore {
  return createMemoryStore({
    accounts: [
      {
        id: ACCOUNT_ID,
        connector: CONNECTOR_ID,
        label: ACCOUNT_LABEL,
        enabled: true,
        values: { token: ACCOUNT_SECRET },
      },
    ],
    configurations: [
      {
        id: 'cfg-proxy',
        name: 'Proxy config',
        tokenHash: hashToken(CONFIG_TOKEN),
        enabled: true,
        accountIds,
      },
    ],
  });
}

async function listTools(
  store: EncryptedStore,
  registry: ConnectorRegistry,
): Promise<ListedTool[]> {
  const app = createMcpApp({ store, connectorRegistry: registry });
  const server = http.createServer(app);
  openServers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
    server.once('error', reject);
  });
  const address = server.address() as AddressInfo;
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${String(address.port)}/mcp`),
    {
      requestInit: {
        headers: { Authorization: `Bearer ${CONFIG_TOKEN}` },
      },
    },
  );
  const client = new Client({ name: 'proxy-tools-list-test', version: '0.0.0' });
  await client.connect(transport);
  const listed = await client.listTools();
  await client.close();
  return listed.tools.map((tool) => listedToolSchema.parse(tool));
}

describe('mcp-endpoint: Proxy tools/list from the in-code allowlist', () => {
  it('Allowlisted tools are listed with prefix and account and list starts no child', async () => {
    const countFile = await makeLaunchCountFile();
    const registry = buildConnectorRegistry([proxyConnector(countFile)]);
    const store = storeForProxyAccount([ACCOUNT_ID]);

    const listed = await listTools(store, registry);
    const names = listed.map((tool) => tool.name);
    expect(names).toContain(`${CONNECTOR_ID}_echo_args`);
    expect(names).toContain(`${CONNECTOR_ID}_leak_secret`);

    for (const tool of listed) {
      expect(tool.inputSchema.required).toContain('account');
      expect(tool.inputSchema.properties?.account?.enum).toEqual([ACCOUNT_ID]);
      expect(tool.inputSchema.properties?.account?.description).toContain(
        `${ACCOUNT_ID} (${ACCOUNT_LABEL})`,
      );
    }

    const echo = listed.find((tool) => tool.name === `${CONNECTOR_ID}_echo_args`);
    expect(echo?.inputSchema.required).toContain('note');
    expect(JSON.stringify(listed)).not.toContain(ACCOUNT_SECRET);
    expect(await readLaunchCount(countFile)).toBe(0);
  });

  it('Tools off the allowlist do not appear', async () => {
    const countFile = await makeLaunchCountFile();
    const registry = buildConnectorRegistry([proxyConnector(countFile)]);
    const store = storeForProxyAccount([ACCOUNT_ID]);

    const listed = await listTools(store, registry);
    const names = listed.map((tool) => tool.name);
    expect(names).not.toContain(`${CONNECTOR_ID}_report_env`);
    expect(names).not.toContain(`${CONNECTOR_ID}_crash`);
    expect(await readLaunchCount(countFile)).toBe(0);
  });

  it('No eligible account hides proxy tools', async () => {
    const countFile = await makeLaunchCountFile();
    const registry = buildConnectorRegistry([proxyConnector(countFile)]);
    const store = storeForProxyAccount([]);

    const listed = await listTools(store, registry);
    const names = listed.map((tool) => tool.name);
    expect(names).not.toContain(`${CONNECTOR_ID}_echo_args`);
    expect(names).not.toContain(`${CONNECTOR_ID}_leak_secret`);
  });
});

const STDERR_MARKER = 'fake-stdio-mcp-stderr-marker';

function parentEnvForChild(): Record<string, string> {
  const parent: Record<string, string> = {};
  if (process.env.PATH !== undefined) {
    parent.PATH = process.env.PATH;
  }
  if (process.env.SYSTEMROOT !== undefined) {
    parent.SYSTEMROOT = process.env.SYSTEMROOT;
  }
  return parent;
}

function openRuntime(): ProxyRuntime {
  const runtime = createProxyRuntime({
    platform: process.platform,
    parentEnv: parentEnvForChild(),
    idleTimeoutMs: PROXY_IDLE_TIMEOUT_MS,
    now: () => 0,
    schedule: () => ({
      cancel() {
        return undefined;
      },
    }),
  });
  openRuntimes.push(runtime);
  return runtime;
}

function readToolText(result: unknown): string {
  if (typeof result !== 'object' || result === null || !('content' in result)) {
    throw new Error('The tool result has no content.');
  }
  const content = result.content;
  if (!Array.isArray(content) || content.length === 0) {
    throw new Error('The tool result has no content.');
  }
  const first: unknown = content[0];
  if (
    typeof first !== 'object' ||
    first === null ||
    !('text' in first) ||
    typeof first.text !== 'string'
  ) {
    throw new Error('The tool result has no text.');
  }
  return first.text;
}

async function callTool(
  store: EncryptedStore,
  registry: ConnectorRegistry,
  runtime: ProxyRuntime,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const app = createMcpApp({ store, connectorRegistry: registry, proxyRuntime: runtime });
  const server = http.createServer(app);
  openServers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
    server.once('error', reject);
  });
  const address = server.address() as AddressInfo;
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${String(address.port)}/mcp`),
    {
      requestInit: {
        headers: { Authorization: `Bearer ${CONFIG_TOKEN}` },
      },
    },
  );
  const client = new Client({ name: 'proxy-tools-call-test', version: '0.0.0' });
  await client.connect(transport);
  try {
    return await client.callTool({ name, arguments: args });
  } finally {
    await client.close();
  }
}

describe('mcp-endpoint: Proxy tools/call strips account and calls the child by short name', () => {
  it('echo_args receives arguments without account', async () => {
    const countFile = await makeLaunchCountFile();
    const registry = buildConnectorRegistry([proxyConnector(countFile)]);
    const store = storeForProxyAccount([ACCOUNT_ID]);
    const result = await callTool(store, registry, openRuntime(), `${CONNECTOR_ID}_echo_args`, {
      account: ACCOUNT_ID,
      note: 'hello',
    });
    const text = readToolText(result);
    const parsed: unknown = JSON.parse(text) as unknown;
    expect(parsed).toEqual({ note: 'hello' });
    expect(
      typeof parsed === 'object' &&
        parsed !== null &&
        Object.prototype.hasOwnProperty.call(parsed, 'account'),
    ).toBe(false);
    expect(await readLaunchCount(countFile)).toBe(1);
  });

  it('Allowlist schema rejects a call the child would accept', async () => {
    const countFile = await makeLaunchCountFile();
    const registry = buildConnectorRegistry([proxyConnector(countFile)]);
    const store = storeForProxyAccount([ACCOUNT_ID]);
    await expect(
      callTool(store, registry, openRuntime(), `${CONNECTOR_ID}_echo_args`, {
        account: ACCOUNT_ID,
      }),
    ).rejects.toThrow(/Invalid tool arguments/);
    expect(await readLaunchCount(countFile)).toBe(0);
  });

  it('Ineligible account does not start the child', async () => {
    const countFile = await makeLaunchCountFile();
    const registry = buildConnectorRegistry([proxyConnector(countFile)]);
    const store = storeForProxyAccount([]);
    await expect(
      callTool(store, registry, openRuntime(), `${CONNECTOR_ID}_echo_args`, {
        account: ACCOUNT_ID,
        note: 'hello',
      }),
    ).rejects.toThrow(/Account is not allowed/);
    expect(await readLaunchCount(countFile)).toBe(0);
  });

  it('Non-allowlisted tool name does not start the child', async () => {
    const countFile = await makeLaunchCountFile();
    const registry = buildConnectorRegistry([proxyConnector(countFile)]);
    const store = storeForProxyAccount([ACCOUNT_ID]);
    await expect(
      callTool(store, registry, openRuntime(), `${CONNECTOR_ID}_report_env`, {
        account: ACCOUNT_ID,
      }),
    ).rejects.toThrow(/Unknown tool/);
    expect(await readLaunchCount(countFile)).toBe(0);
  });
});

describe('mcp-endpoint: Proxy tool result scrubs secrets and omits stderr', () => {
  it('Secret in the result is redacted and the stderr marker is absent', async () => {
    const countFile = await makeLaunchCountFile();
    const registry = buildConnectorRegistry([proxyConnector(countFile)]);
    const store = storeForProxyAccount([ACCOUNT_ID]);
    const result = await callTool(store, registry, openRuntime(), `${CONNECTOR_ID}_leak_secret`, {
      account: ACCOUNT_ID,
    });
    const text = readToolText(result);
    expect(text).toContain('[redacted]');
    expect(text).not.toContain(ACCOUNT_SECRET);
    expect(text).not.toContain(STDERR_MARKER);
  });
});
