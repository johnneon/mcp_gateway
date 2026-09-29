import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  ConnectorModule,
  NativeEgressClient,
  NativeToolHandler,
} from '../../src/connectors/contract.js';
import {
  buildConnectorRegistry,
  productionConnectorRegistry,
  type ConnectorRegistry,
} from '../../src/connectors/registry.js';
import { createMcpApp } from '../../src/http/createMcpApp.js';
import type { JsonObject } from '../../src/store/codec.js';
import type { EncryptedStore } from '../../src/store/store.js';
import { hashToken } from '../../src/token/token.js';

const openServers: http.Server[] = [];

afterEach(async () => {
  while (openServers.length > 0) {
    const server = openServers.pop();
    if (!server) {
      continue;
    }
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
});

function mcpAppFor(
  store: EncryptedStore,
  connectorRegistry: ConnectorRegistry = productionConnectorRegistry,
) {
  return createMcpApp({ store, connectorRegistry });
}

async function listenMcpApp(
  store: EncryptedStore,
  connectorRegistry: ConnectorRegistry = productionConnectorRegistry,
): Promise<{ baseUrl: string; server: http.Server }> {
  const app = mcpAppFor(store, connectorRegistry);
  const server = http.createServer(app);
  openServers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
    server.once('error', reject);
  });
  const address = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${String(address.port)}`, server };
}

const ENABLED_NAME = 'Enabled Ops Config UNIQUE';
const DISABLED_NAME = 'Disabled Ops Config UNIQUE';
const ENABLED_TOKEN = 'enabled-bearer-token-UNIQUE-7e2c-aaaa';
const DISABLED_TOKEN = 'disabled-bearer-token-UNIQUE-7e2c-bbbb';
const UNKNOWN_TOKEN = 'unknown-bearer-token-UNIQUE-7e2c-cccc';

const FIXTURE_SECRET = 'fixture-secret-value-UNIQUE-7e2c';
const CONFIG_A_TOKEN = 'config-a-bearer-UNIQUE-7e2c-aaaa';
const CONFIG_B_TOKEN = 'config-b-bearer-UNIQUE-7e2c-bbbb';

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

function storeWithConfigs(
  rows: Array<{ id: string; name: string; token: string; enabled: boolean }>,
): EncryptedStore {
  return createMemoryStore({
    configurations: rows.map((row) => ({
      id: row.id,
      name: row.name,
      tokenHash: hashToken(row.token),
      enabled: row.enabled,
    })),
  });
}

function createFakeEchoConnector(handler?: NativeToolHandler): ConnectorModule {
  return {
    id: 'fake',
    name: 'Fake',
    kind: 'native',
    fields: [
      { name: 'user', label: 'User', type: 'text', required: true },
      { name: 'token', label: 'Token', type: 'secret', required: true },
    ],
    allowedDestinations: [{ host: 'fake.example.test', port: 443 }],
    checkConnection: () => undefined,
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
        handler:
          handler ??
          (() => ({
            content: [{ type: 'text', text: 'ok' }],
          })),
      },
    ],
  };
}

async function listToolsWithBearer(
  store: EncryptedStore,
  registry: ConnectorRegistry,
  token: string,
) {
  const { baseUrl } = await listenMcpApp(store, registry);
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });
  const client = new Client({ name: 'mcp-endpoint-test', version: '0.0.0' });
  await client.connect(transport);
  const listed = await client.listTools();
  await client.close();
  return listed;
}

const INITIALIZE_BODY = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test', version: '0.0.0' },
  },
};

describe('mcp-endpoint: Bearer authentication before JSON-RPC on POST /mcp', () => {
  it('Enabled configuration bearer is accepted', async () => {
    const store = storeWithConfigs([
      { id: 'cfg-enabled', name: ENABLED_NAME, token: ENABLED_TOKEN, enabled: true },
    ]);
    const app = mcpAppFor(store);
    const response = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${ENABLED_TOKEN}`)
      .send(INITIALIZE_BODY);

    expect(response.status).not.toBe(401);
    expect(response.text).not.toBe('Unauthorized');
  });

  it('Disabled configuration bearer is refused like unknown', async () => {
    const store = storeWithConfigs([
      { id: 'cfg-disabled', name: DISABLED_NAME, token: DISABLED_TOKEN, enabled: false },
    ]);
    const app = mcpAppFor(store);
    const response = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${DISABLED_TOKEN}`)
      .send(INITIALIZE_BODY);

    expect(response.status).toBe(401);
    expect(response.headers['content-type']).toMatch(/text\/plain/);
    expect(response.text).toBe('Unauthorized');
  });
});

describe('mcp-endpoint: Identical Unauthorized refusal for failed auth', () => {
  it('Missing Authorization — 401 Unauthorized', async () => {
    const store = storeWithConfigs([
      { id: 'cfg-enabled', name: ENABLED_NAME, token: ENABLED_TOKEN, enabled: true },
    ]);
    const app = mcpAppFor(store);
    const response = await request(app).post('/mcp').send(INITIALIZE_BODY);

    expect(response.status).toBe(401);
    expect(response.headers['content-type']).toMatch(/text\/plain/);
    expect(response.text).toBe('Unauthorized');
    expect(response.text).not.toContain(ENABLED_NAME);
  });

  it('Empty bearer — same 401 as missing', async () => {
    const store = storeWithConfigs([
      { id: 'cfg-enabled', name: ENABLED_NAME, token: ENABLED_TOKEN, enabled: true },
    ]);
    const app = mcpAppFor(store);
    const response = await request(app)
      .post('/mcp')
      .set('Authorization', 'Bearer ')
      .send(INITIALIZE_BODY);

    expect(response.status).toBe(401);
    expect(response.text).toBe('Unauthorized');
  });

  it('Unknown token — same 401 as missing', async () => {
    const store = storeWithConfigs([
      { id: 'cfg-enabled', name: ENABLED_NAME, token: ENABLED_TOKEN, enabled: true },
    ]);
    const app = mcpAppFor(store);
    const response = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${UNKNOWN_TOKEN}`)
      .send(INITIALIZE_BODY);

    expect(response.status).toBe(401);
    expect(response.text).toBe('Unauthorized');
  });

  it('Four refusal cases are byte-identical', async () => {
    const store = storeWithConfigs([
      { id: 'cfg-enabled', name: ENABLED_NAME, token: ENABLED_TOKEN, enabled: true },
      { id: 'cfg-disabled', name: DISABLED_NAME, token: DISABLED_TOKEN, enabled: false },
    ]);
    const app = mcpAppFor(store);

    const missing = await request(app).post('/mcp').send(INITIALIZE_BODY);
    const empty = await request(app)
      .post('/mcp')
      .set('Authorization', 'Bearer ')
      .send(INITIALIZE_BODY);
    const unknown = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${UNKNOWN_TOKEN}`)
      .send(INITIALIZE_BODY);
    const disabled = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${DISABLED_TOKEN}`)
      .send(INITIALIZE_BODY);

    const responses = [missing, empty, unknown, disabled];
    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(response.text).toBe('Unauthorized');
      expect(response.text).not.toContain(ENABLED_NAME);
      expect(response.text).not.toContain(DISABLED_NAME);
    }
    expect(new Set(responses.map((r) => r.text))).toEqual(new Set(['Unauthorized']));
  });
});

describe('mcp-endpoint: Stateless Streamable HTTP with empty tools/list', () => {
  it('Initialize and empty tools/list with enabled bearer', async () => {
    const store = storeWithConfigs([
      { id: 'cfg-enabled', name: ENABLED_NAME, token: ENABLED_TOKEN, enabled: true },
    ]);
    const { baseUrl } = await listenMcpApp(store);
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: {
        headers: {
          Authorization: `Bearer ${ENABLED_TOKEN}`,
        },
      },
    });
    const client = new Client({ name: 'mcp-endpoint-test', version: '0.0.0' });
    await client.connect(transport);
    const listed = await client.listTools();
    expect(listed.tools).toEqual([]);
    await client.close();
  });

  it('No session id on successful POST', async () => {
    const store = storeWithConfigs([
      { id: 'cfg-enabled', name: ENABLED_NAME, token: ENABLED_TOKEN, enabled: true },
    ]);
    const app = mcpAppFor(store);
    const response = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${ENABLED_TOKEN}`)
      .set('Accept', 'application/json, text/event-stream')
      .send(INITIALIZE_BODY);

    expect(response.status).not.toBe(401);
    expect(response.headers['mcp-session-id']).toBeUndefined();
    expect(response.body).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: expect.objectContaining({
        serverInfo: { name: 'mcp-gateway', version: '0.0.0' },
      }) as unknown,
    });

    const followUp = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${ENABLED_TOKEN}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      });

    expect(followUp.status).not.toBe(401);
    expect(followUp.headers['mcp-session-id']).toBeUndefined();
    expect(followUp.body).toMatchObject({
      jsonrpc: '2.0',
      id: 2,
      result: { tools: [] },
    });
  });
});

function twoConfigStoreWithAccount(options: {
  accountIdsA: string[];
  accountIdsB: string[];
  accountEnabled?: boolean;
}): EncryptedStore {
  return createMemoryStore({
    accounts: [
      {
        id: 'acc-1',
        connector: 'fake',
        label: 'Box',
        enabled: options.accountEnabled ?? true,
        values: {
          user: 'alice',
          token: FIXTURE_SECRET,
        },
      },
    ],
    configurations: [
      {
        id: 'cfg-a',
        name: 'Config A',
        tokenHash: hashToken(CONFIG_A_TOKEN),
        enabled: true,
        accountIds: options.accountIdsA,
      },
      {
        id: 'cfg-b',
        name: 'Config B',
        tokenHash: hashToken(CONFIG_B_TOKEN),
        enabled: true,
        accountIds: options.accountIdsB,
      },
    ],
  });
}

describe('mcp-endpoint: Resolve first enabled configuration after bearer auth', () => {
  it('First enabled matching configuration scopes tools', async () => {
    const registry = buildConnectorRegistry([createFakeEchoConnector()]);
    const store = twoConfigStoreWithAccount({
      accountIdsA: ['acc-1'],
      accountIdsB: [],
    });

    const listedA = await listToolsWithBearer(store, registry, CONFIG_A_TOKEN);
    expect(listedA.tools.map((tool) => tool.name)).toContain('fake_echo');

    const listedB = await listToolsWithBearer(store, registry, CONFIG_B_TOKEN);
    expect(listedB.tools).toEqual([]);
  });
});

describe('mcp-endpoint: tools/list from eligible accounts only', () => {
  it('Connector tools hidden when configuration has no eligible account', async () => {
    const registry = buildConnectorRegistry([createFakeEchoConnector()]);
    const store = twoConfigStoreWithAccount({
      accountIdsA: ['acc-1'],
      accountIdsB: [],
    });

    const listed = await listToolsWithBearer(store, registry, CONFIG_B_TOKEN);
    expect(listed.tools).toEqual([]);
  });

  it('Connector tools listed when configuration has an eligible account', async () => {
    const registry = buildConnectorRegistry([createFakeEchoConnector()]);
    const store = twoConfigStoreWithAccount({
      accountIdsA: ['acc-1'],
      accountIdsB: [],
    });

    const listed = await listToolsWithBearer(store, registry, CONFIG_A_TOKEN);
    expect(listed.tools.map((tool) => tool.name)).toContain('fake_echo');
  });

  it('Empty production registry still yields empty tools/list', async () => {
    const store = storeWithConfigs([
      { id: 'cfg-enabled', name: ENABLED_NAME, token: ENABLED_TOKEN, enabled: true },
    ]);
    const listed = await listToolsWithBearer(store, productionConnectorRegistry, ENABLED_TOKEN);
    expect(listed.tools).toEqual([]);
    expect(productionConnectorRegistry.connectors).toHaveLength(0);
  });
});

describe('mcp-endpoint: Injected account argument in tool schemas', () => {
  it('Account enum and description show only eligible accounts', async () => {
    const registry = buildConnectorRegistry([createFakeEchoConnector()]);
    const store = twoConfigStoreWithAccount({
      accountIdsA: ['acc-1'],
      accountIdsB: [],
    });

    const listed = await listToolsWithBearer(store, registry, CONFIG_A_TOKEN);
    const tool = listed.tools.find((entry) => entry.name === 'fake_echo');
    expect(tool).toBeDefined();
    const schema = tool?.inputSchema as {
      required?: string[];
      properties?: {
        account?: {
          type?: string;
          enum?: string[];
          description?: string;
          oneOf?: unknown;
          const?: unknown;
          title?: unknown;
        };
      };
    };
    expect(schema.required).toContain('account');
    expect(schema.properties?.account?.type).toBe('string');
    expect(schema.properties?.account?.enum).toEqual(['acc-1']);
    expect(schema.properties?.account?.description).toContain('acc-1 (Box)');
    expect(schema.properties?.account?.oneOf).toBeUndefined();
    expect(schema.properties?.account?.const).toBeUndefined();
    expect(schema.properties?.account?.title).toBeUndefined();

    const serialized = JSON.stringify(tool);
    expect(serialized).not.toContain(FIXTURE_SECRET);
  });
});

describe('connector-contract: MCP app accepts an injectable connector registry', () => {
  it('MCP app with injected fake registry can list tools for an eligible account', async () => {
    const registry = buildConnectorRegistry([createFakeEchoConnector()]);
    const store = twoConfigStoreWithAccount({
      accountIdsA: ['acc-1'],
      accountIdsB: [],
    });

    const listed = await listToolsWithBearer(store, registry, CONFIG_A_TOKEN);
    expect(listed.tools.map((tool) => tool.name)).toContain('fake_echo');
    expect(productionConnectorRegistry.connectors).toHaveLength(0);
  });
});

async function withMcpClient<T>(
  store: EncryptedStore,
  registry: ConnectorRegistry,
  token: string,
  run: (client: Client) => Promise<T>,
): Promise<T> {
  const { baseUrl } = await listenMcpApp(store, registry);
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });
  const client = new Client({ name: 'mcp-endpoint-call-test', version: '0.0.0' });
  await client.connect(transport);
  try {
    return await run(client);
  } finally {
    await client.close();
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

describe('mcp-endpoint: tools/call validates, authorizes, then invokes handler', () => {
  it('Successful call increments fake counter and passes decrypted values', async () => {
    let callCount = 0;
    let recordedValues: Record<string, string> | undefined;
    const registry = buildConnectorRegistry([
      createFakeEchoConnector((_args, accountValues) => {
        callCount += 1;
        recordedValues = { ...accountValues };
        return { content: [{ type: 'text', text: 'ok' }] };
      }),
    ]);
    const store = twoConfigStoreWithAccount({
      accountIdsA: ['acc-1'],
      accountIdsB: [],
    });

    await withMcpClient(store, registry, CONFIG_A_TOKEN, async (client) => {
      const result = await client.callTool({
        name: 'fake_echo',
        arguments: { message: 'hello', account: 'acc-1' },
      });
      expect(result).toMatchObject({
        content: [{ type: 'text', text: 'ok' }],
      });
    });

    expect(callCount).toBe(1);
    expect(recordedValues).toEqual(
      expect.objectContaining({
        user: 'alice',
        token: FIXTURE_SECRET,
      }),
    );
  });

  it('Account absent from configuration refuses without calling handler', async () => {
    let callCount = 0;
    const registry = buildConnectorRegistry([
      createFakeEchoConnector(() => {
        callCount += 1;
        return { content: [{ type: 'text', text: 'ok' }] };
      }),
    ]);
    const store = twoConfigStoreWithAccount({
      accountIdsA: ['acc-1'],
      accountIdsB: [],
    });

    await withMcpClient(store, registry, CONFIG_B_TOKEN, async (client) => {
      await expect(
        client.callTool({
          name: 'fake_echo',
          arguments: { message: 'hello', account: 'acc-1' },
        }),
      ).rejects.toThrow(/Invalid tool arguments|Account is not allowed|Unknown tool/i);
    });

    expect(callCount).toBe(0);
  });

  it('Foreign account refuses without calling handler', async () => {
    let callCount = 0;
    const registry = buildConnectorRegistry([
      createFakeEchoConnector(() => {
        callCount += 1;
        return { content: [{ type: 'text', text: 'ok' }] };
      }),
    ]);
    const store = createMemoryStore({
      accounts: [
        {
          id: 'acc-1',
          connector: 'fake',
          label: 'Box',
          enabled: true,
          values: { user: 'alice', token: FIXTURE_SECRET },
        },
        {
          id: 'acc-2',
          connector: 'fake',
          label: 'Other',
          enabled: true,
          values: { user: 'bob', token: 'other-secret-UNIQUE' },
        },
      ],
      configurations: [
        {
          id: 'cfg-a',
          name: 'Config A',
          tokenHash: hashToken(CONFIG_A_TOKEN),
          enabled: true,
          accountIds: ['acc-1'],
        },
      ],
    });

    await withMcpClient(store, registry, CONFIG_A_TOKEN, async (client) => {
      await expect(
        client.callTool({
          name: 'fake_echo',
          arguments: { message: 'hello', account: 'acc-2' },
        }),
      ).rejects.toThrow(/Invalid tool arguments|Account is not allowed/i);
    });

    expect(callCount).toBe(0);
  });

  it('Disabled account refuses without calling handler', async () => {
    let callCount = 0;
    const registry = buildConnectorRegistry([
      createFakeEchoConnector(() => {
        callCount += 1;
        return { content: [{ type: 'text', text: 'ok' }] };
      }),
    ]);
    const store = twoConfigStoreWithAccount({
      accountIdsA: ['acc-1'],
      accountIdsB: [],
      accountEnabled: false,
    });

    await withMcpClient(store, registry, CONFIG_A_TOKEN, async (client) => {
      await expect(
        client.callTool({
          name: 'fake_echo',
          arguments: { message: 'hello', account: 'acc-1' },
        }),
      ).rejects.toThrow(/Invalid tool arguments|Account is not allowed/i);
    });

    expect(callCount).toBe(0);
  });

  it('Schema validation failure refuses without calling handler', async () => {
    let callCount = 0;
    const registry = buildConnectorRegistry([
      createFakeEchoConnector(() => {
        callCount += 1;
        return { content: [{ type: 'text', text: 'ok' }] };
      }),
    ]);
    const store = twoConfigStoreWithAccount({
      accountIdsA: ['acc-1'],
      accountIdsB: [],
    });

    await withMcpClient(store, registry, CONFIG_A_TOKEN, async (client) => {
      await expect(
        client.callTool({
          name: 'fake_echo',
          arguments: { account: 'acc-1' },
        }),
      ).rejects.toThrow(/Invalid tool arguments/i);
    });

    expect(callCount).toBe(0);
  });

  it('Handler throw becomes fixed English error without exception text', async () => {
    const exceptionMessage = `boom containing ${FIXTURE_SECRET}`;
    const registry = buildConnectorRegistry([
      createFakeEchoConnector(() => {
        throw new Error(exceptionMessage);
      }),
    ]);
    const store = twoConfigStoreWithAccount({
      accountIdsA: ['acc-1'],
      accountIdsB: [],
    });

    await withMcpClient(store, registry, CONFIG_A_TOKEN, async (client) => {
      try {
        await client.callTool({
          name: 'fake_echo',
          arguments: { message: 'hello', account: 'acc-1' },
        });
        expect.fail('expected callTool to throw');
      } catch (error) {
        const message = errorMessage(error);
        expect(message).toMatch(/Tool execution failed/);
        expect(message).not.toContain(FIXTURE_SECRET);
        expect(message).not.toContain(exceptionMessage);
        expect(message).not.toContain('boom containing');
      }
    });
  });

  it('Successful call passes egress client to handler', async () => {
    let recordedEgress: unknown;
    const registry = buildConnectorRegistry([
      createFakeEchoConnector((_args, _accountValues, egressClient) => {
        recordedEgress = egressClient;
        return { content: [{ type: 'text', text: 'ok' }] };
      }),
    ]);
    const store = twoConfigStoreWithAccount({
      accountIdsA: ['acc-1'],
      accountIdsB: [],
    });

    await withMcpClient(store, registry, CONFIG_A_TOKEN, async (client) => {
      const result = await client.callTool({
        name: 'fake_echo',
        arguments: { message: 'hello', account: 'acc-1' },
      });
      expect(result).toMatchObject({
        content: [{ type: 'text', text: 'ok' }],
      });
    });

    expect(recordedEgress).toEqual(
      expect.objectContaining({
        httpsRequest: expect.any(Function) as unknown,
        tlsConnect: expect.any(Function) as unknown,
        tlsSession: expect.any(Function) as unknown,
      }),
    );
  });

  it('Egress Destination is not allowed reaches the MCP client unchanged', async () => {
    const registry = buildConnectorRegistry([
      createFakeEchoConnector(async (_args, _accountValues, egressClient) => {
        await egressClient.httpsRequest({
          host: 'evil.example.test',
          port: 443,
          method: 'GET',
          path: '/',
        });
        return { content: [{ type: 'text', text: 'should-not-reach' }] };
      }),
    ]);
    const store = twoConfigStoreWithAccount({
      accountIdsA: ['acc-1'],
      accountIdsB: [],
    });

    await withMcpClient(store, registry, CONFIG_A_TOKEN, async (client) => {
      try {
        await client.callTool({
          name: 'fake_echo',
          arguments: { message: 'hello', account: 'acc-1' },
        });
        expect.fail('expected callTool to throw');
      } catch (error) {
        const message = errorMessage(error);
        expect(message).toContain('Destination is not allowed');
        expect(message).not.toContain('Tool execution failed');
      }
    });
  });
});

describe('connector-contract: Native connector tools', () => {
  it('Handler receives egress client; checkConnection does not', async () => {
    let recordedEgress: unknown;
    let checkConnectionSawEgress = false;
    const connector = createFakeEchoConnector((_args, _accountValues, egressClient) => {
      recordedEgress = egressClient;
      return { content: [{ type: 'text', text: 'ok' }] };
    });
    connector.checkConnection = (_values, egressClient: NativeEgressClient) => {
      checkConnectionSawEgress = typeof egressClient.tlsSession === 'function';
    };
    const registry = buildConnectorRegistry([connector]);
    const store = twoConfigStoreWithAccount({
      accountIdsA: ['acc-1'],
      accountIdsB: [],
    });

    await withMcpClient(store, registry, CONFIG_A_TOKEN, async (client) => {
      await client.callTool({
        name: 'fake_echo',
        arguments: { message: 'hello', account: 'acc-1' },
      });
    });

    expect(recordedEgress).toEqual(
      expect.objectContaining({
        httpsRequest: expect.any(Function) as unknown,
        tlsConnect: expect.any(Function) as unknown,
        tlsSession: expect.any(Function) as unknown,
      }),
    );

    const fakeEgress: NativeEgressClient = {
      httpsRequest: () => Promise.resolve({ status: 200, headers: {}, body: new Uint8Array(0) }),
      tlsConnect: () => Promise.resolve(),
      tlsSession: () => Promise.reject(new Error('not used')),
    };
    await Promise.resolve(
      registry.connectors[0]?.checkConnection({ user: 'alice', token: FIXTURE_SECRET }, fakeEgress),
    );
    expect(checkConnectionSawEgress).toBe(true);
  });
});

describe('mcp-endpoint: Scrub secret account values from tool results and errors', () => {
  it('Secret returned in the body is redacted in the tool result', async () => {
    const registry = buildConnectorRegistry([
      createFakeEchoConnector((_args, accountValues) => ({
        content: [{ type: 'text', text: `token=${accountValues.token ?? ''}` }],
      })),
    ]);
    const store = twoConfigStoreWithAccount({
      accountIdsA: ['acc-1'],
      accountIdsB: [],
    });

    await withMcpClient(store, registry, CONFIG_A_TOKEN, async (client) => {
      const result = await client.callTool({
        name: 'fake_echo',
        arguments: { message: 'hello', account: 'acc-1' },
      });
      const text = JSON.stringify(result);
      expect(text).toContain('[redacted]');
      expect(text).not.toContain(FIXTURE_SECRET);
    });
  });

  it('Longer secret is redacted before a shorter overlapping secret', async () => {
    const connector: ConnectorModule = {
      id: 'fake',
      name: 'Fake',
      kind: 'native',
      fields: [
        { name: 'short', label: 'Short', type: 'secret', required: true },
        { name: 'long', label: 'Long', type: 'secret', required: true },
      ],
      allowedDestinations: [{ host: 'fake.example.test', port: 443 }],
      checkConnection: () => undefined,
      tools: [
        {
          name: 'echo',
          description: 'Echo',
          inputSchema: {
            type: 'object',
            properties: { message: { type: 'string' } },
            required: ['message'],
          },
          handler: () => ({
            content: [{ type: 'text', text: 'value=abc' }],
          }),
        },
      ],
    };
    const registry = buildConnectorRegistry([connector]);
    const store = createMemoryStore({
      accounts: [
        {
          id: 'acc-1',
          connector: 'fake',
          label: 'Box',
          enabled: true,
          values: { short: 'ab', long: 'abc' },
        },
      ],
      configurations: [
        {
          id: 'cfg-a',
          name: 'Config A',
          tokenHash: hashToken(CONFIG_A_TOKEN),
          enabled: true,
          accountIds: ['acc-1'],
        },
      ],
    });

    await withMcpClient(store, registry, CONFIG_A_TOKEN, async (client) => {
      const result = await client.callTool({
        name: 'fake_echo',
        arguments: { message: 'hello', account: 'acc-1' },
      });
      const text = JSON.stringify(result);
      expect(text).toContain('[redacted]');
      expect(text).not.toContain('abc');
      expect(text).not.toMatch(/\[redacted\]c/);
    });
  });

  it('Empty secret and non-secret fields are not redacted', async () => {
    const connector: ConnectorModule = {
      id: 'fake',
      name: 'Fake',
      kind: 'native',
      fields: [
        { name: 'token', label: 'Token', type: 'secret', required: false },
        { name: 'note', label: 'Note', type: 'text', required: true },
        { name: 'mailhost', label: 'Mail host', type: 'host', required: true },
      ],
      allowedDestinations: [{ host: 'fake.example.test', port: 443 }],
      checkConnection: () => undefined,
      tools: [
        {
          name: 'echo',
          description: 'Echo',
          inputSchema: {
            type: 'object',
            properties: { message: { type: 'string' } },
            required: ['message'],
          },
          handler: () => ({
            content: [
              {
                type: 'text',
                text: 'visible-text and mail.example.test',
              },
            ],
          }),
        },
      ],
    };
    const registry = buildConnectorRegistry([connector]);
    const store = createMemoryStore({
      accounts: [
        {
          id: 'acc-1',
          connector: 'fake',
          label: 'Box',
          enabled: true,
          values: {
            token: '',
            note: 'visible-text',
            mailhost: 'mail.example.test',
          },
        },
      ],
      configurations: [
        {
          id: 'cfg-a',
          name: 'Config A',
          tokenHash: hashToken(CONFIG_A_TOKEN),
          enabled: true,
          accountIds: ['acc-1'],
        },
      ],
    });

    await withMcpClient(store, registry, CONFIG_A_TOKEN, async (client) => {
      const result = await client.callTool({
        name: 'fake_echo',
        arguments: { message: 'hello', account: 'acc-1' },
      });
      const text = JSON.stringify(result);
      expect(text).toContain('visible-text');
      expect(text).toContain('mail.example.test');
      expect(text).not.toContain('[redacted]');
    });
  });

  it('Secret in error text is scrubbed before the client sees it', async () => {
    const registry = buildConnectorRegistry([
      createFakeEchoConnector(() => {
        throw new Error(`failure leaked ${FIXTURE_SECRET}`);
      }),
    ]);
    const store = twoConfigStoreWithAccount({
      accountIdsA: ['acc-1'],
      accountIdsB: [],
    });

    await withMcpClient(store, registry, CONFIG_A_TOKEN, async (client) => {
      try {
        await client.callTool({
          name: 'fake_echo',
          arguments: { message: 'hello', account: 'acc-1' },
        });
        expect.fail('expected callTool to throw');
      } catch (error) {
        const message = errorMessage(error);
        expect(message).not.toContain(FIXTURE_SECRET);
      }
    });
  });
});
