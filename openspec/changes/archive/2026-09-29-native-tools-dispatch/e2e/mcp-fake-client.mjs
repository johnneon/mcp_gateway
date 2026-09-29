/**
 * Throwaway MCP e2e client for native-tools-dispatch.
 * Uses the change's fake connector only; does not call a live host.
 */
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { buildConnectorRegistry } from '../../../../server/dist/connectors/registry.js';
import { createMcpApp } from '../../../../server/dist/http/createMcpApp.js';
import { hashToken } from '../../../../server/dist/token/token.js';

const FIXTURE_SECRET = 'fixture-secret-value-UNIQUE-7e2c';
const CONFIG_A_TOKEN = 'config-a-bearer-UNIQUE-7e2c-aaaa';
const CONFIG_B_TOKEN = 'config-b-bearer-UNIQUE-7e2c-bbbb';

function createMemoryStore(document) {
  let doc = structuredClone(document);
  return {
    read() {
      return structuredClone(doc);
    },
    async replace(next) {
      doc = structuredClone(next);
    },
  };
}

function createFakeEcho(handler) {
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
          properties: { message: { type: 'string' } },
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

async function listen(app) {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', resolve);
    server.once('error', reject);
  });
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

async function withClient(baseUrl, token, run) {
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: 'e2e-native-tools-dispatch', version: '0.0.0' });
  await client.connect(transport);
  try {
    return await run(client);
  } finally {
    await client.close();
  }
}

const results = [];

function pass(name, detail) {
  results.push({ name, ok: true, detail });
  console.log(`PASS: ${name} — ${detail}`);
}

function fail(name, detail) {
  results.push({ name, ok: false, detail });
  console.error(`FAIL: ${name} — ${detail}`);
}

async function main() {
  let callCount = 0;
  let recordedValues;
  const registry = buildConnectorRegistry([
    createFakeEcho((_args, accountValues) => {
      callCount += 1;
      recordedValues = { ...accountValues };
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
      {
        id: 'acc-disabled',
        connector: 'fake',
        label: 'Off',
        enabled: false,
        values: { user: 'x', token: FIXTURE_SECRET },
      },
    ],
    configurations: [
      {
        id: 'cfg-a',
        name: 'Config A',
        tokenHash: hashToken(CONFIG_A_TOKEN),
        enabled: true,
        accountIds: ['acc-1', 'acc-disabled'],
      },
      {
        id: 'cfg-b',
        name: 'Config B',
        tokenHash: hashToken(CONFIG_B_TOKEN),
        enabled: true,
        accountIds: [],
      },
    ],
  });

  const app = createMcpApp({ store, connectorRegistry: registry });
  const { server, baseUrl } = await listen(app);

  try {
    // Port isolation: MCP app must not serve admin API
    const adminProbe = await fetch(`${baseUrl}/api/connectors`);
    if (adminProbe.status === 404) {
      pass('mcp-port-no-admin', `status ${adminProbe.status}`);
    } else {
      fail('mcp-port-no-admin', `unexpected status ${adminProbe.status}`);
    }

    // Empty / unknown bearer identical Unauthorized
    const emptyAuth = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ',
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'e2e', version: '0' },
        },
      }),
    });
    const unknownAuth = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer unknown-token-e2e',
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'e2e', version: '0' },
        },
      }),
    });
    const emptyText = await emptyAuth.text();
    const unknownText = await unknownAuth.text();
    if (
      emptyAuth.status === 401 &&
      unknownAuth.status === 401 &&
      emptyText === 'Unauthorized' &&
      unknownText === 'Unauthorized'
    ) {
      pass('empty-and-unknown-bearer', 'identical 401 Unauthorized');
    } else {
      fail(
        'empty-and-unknown-bearer',
        `empty=${emptyAuth.status}/${emptyText} unknown=${unknownAuth.status}/${unknownText}`,
      );
    }

    // tools/list for eligible vs none
    const listedA = await withClient(baseUrl, CONFIG_A_TOKEN, (c) => c.listTools());
    const tool = listedA.tools.find((t) => t.name === 'fake_echo');
    const schemaJson = JSON.stringify(tool);
    if (
      tool &&
      tool.inputSchema?.properties?.account?.enum?.includes('acc-1') &&
      String(tool.inputSchema.properties.account.description).includes('acc-1 (Box)') &&
      !schemaJson.includes(FIXTURE_SECRET)
    ) {
      pass(
        'tools-list-eligible',
        `fake_echo with account enum/description; secret absent from schema`,
      );
    } else {
      fail('tools-list-eligible', `tool=${JSON.stringify(tool)}`);
    }

    const listedB = await withClient(baseUrl, CONFIG_B_TOKEN, (c) => c.listTools());
    if (listedB.tools.length === 0) {
      pass('tools-list-no-eligible', 'empty tools array');
    } else {
      fail('tools-list-no-eligible', JSON.stringify(listedB.tools));
    }

    // Successful call
    callCount = 0;
    recordedValues = undefined;
    const callResult = await withClient(baseUrl, CONFIG_A_TOKEN, (c) =>
      c.callTool({ name: 'fake_echo', arguments: { message: 'hello', account: 'acc-1' } }),
    );
    const callJson = JSON.stringify(callResult);
    if (
      callCount === 1 &&
      recordedValues?.token === FIXTURE_SECRET &&
      !callJson.includes(FIXTURE_SECRET)
    ) {
      pass('tools-call-success', 'counter=1; handler saw secret; MCP result clean');
    } else {
      fail(
        'tools-call-success',
        `count=${callCount} values=${JSON.stringify(recordedValues)} result=${callJson}`,
      );
    }

    // Foreign account
    callCount = 0;
    try {
      await withClient(baseUrl, CONFIG_A_TOKEN, (c) =>
        c.callTool({ name: 'fake_echo', arguments: { message: 'hello', account: 'acc-2' } }),
      );
      fail('tools-call-foreign', 'expected rejection');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (callCount === 0 && !msg.includes(FIXTURE_SECRET)) {
        pass('tools-call-foreign', msg);
      } else {
        fail('tools-call-foreign', `count=${callCount} msg=${msg}`);
      }
    }

    // Disabled account
    callCount = 0;
    try {
      await withClient(baseUrl, CONFIG_A_TOKEN, (c) =>
        c.callTool({
          name: 'fake_echo',
          arguments: { message: 'hello', account: 'acc-disabled' },
        }),
      );
      fail('tools-call-disabled', 'expected rejection');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (callCount === 0 && !msg.includes(FIXTURE_SECRET)) {
        pass('tools-call-disabled', msg);
      } else {
        fail('tools-call-disabled', `count=${callCount} msg=${msg}`);
      }
    }

    // Schema validation failure
    callCount = 0;
    try {
      await withClient(baseUrl, CONFIG_A_TOKEN, (c) =>
        c.callTool({ name: 'fake_echo', arguments: { account: 'acc-1' } }),
      );
      fail('tools-call-schema', 'expected rejection');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (callCount === 0 && /Invalid tool arguments/i.test(msg)) {
        pass('tools-call-schema', msg);
      } else {
        fail('tools-call-schema', `count=${callCount} msg=${msg}`);
      }
    }

    // Handler throw — fixed English, no secret
    const throwRegistry = buildConnectorRegistry([
      createFakeEcho(() => {
        throw new Error(`boom containing ${FIXTURE_SECRET}`);
      }),
    ]);
    const throwApp = createMcpApp({ store, connectorRegistry: throwRegistry });
    const throwListen = await listen(throwApp);
    try {
      await withClient(throwListen.baseUrl, CONFIG_A_TOKEN, async (c) => {
        try {
          await c.callTool({
            name: 'fake_echo',
            arguments: { message: 'hello', account: 'acc-1' },
          });
          fail('tools-call-handler-throw', 'expected rejection');
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          if (
            /Tool execution failed/.test(msg) &&
            !msg.includes(FIXTURE_SECRET) &&
            !msg.includes('boom containing')
          ) {
            pass('tools-call-handler-throw', msg);
          } else {
            fail('tools-call-handler-throw', msg);
          }
        }
      });
    } finally {
      await new Promise((resolve) => throwListen.server.close(resolve));
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  // Production empty registry on live process (ports from env of running main)
  const prodMcp = process.env.E2E_MCP_PORT ?? '39115';
  const prodAdmin = process.env.E2E_ADMIN_PORT ?? '39116';
  const health = await fetch(`http://127.0.0.1:${prodMcp}/health`);
  const healthBody = await health.json();
  if (health.ok && healthBody.status === 'ok') {
    pass('production-health', JSON.stringify(healthBody));
  } else {
    fail('production-health', `${health.status} ${JSON.stringify(healthBody)}`);
  }

  const adminOnMcp = await fetch(`http://127.0.0.1:${prodMcp}/api/connectors`);
  if (adminOnMcp.status === 404) {
    pass('production-mcp-no-admin', `status ${adminOnMcp.status}`);
  } else {
    fail('production-mcp-no-admin', `status ${adminOnMcp.status}`);
  }

  const mcpOnAdmin = await fetch(`http://127.0.0.1:${prodAdmin}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (mcpOnAdmin.status === 404) {
    pass('production-admin-no-mcp', `status ${mcpOnAdmin.status}`);
  } else {
    fail('production-admin-no-mcp', `status ${mcpOnAdmin.status}`);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nSummary: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

await main();
