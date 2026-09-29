/**
 * Throwaway MCP e2e client for native-egress-guard.
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

function createFakeEcho(handler, fieldOverrides) {
  return {
    id: 'fake',
    name: 'Fake',
    kind: 'native',
    fields: fieldOverrides?.fields ?? [
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
          ((_args, _accountValues, _egress) => ({
            content: [{ type: 'text', text: 'ok' }],
          })),
      },
    ],
  };
}

function baseStore(accountValues = { user: 'alice', token: FIXTURE_SECRET }) {
  return createMemoryStore({
    accounts: [
      {
        id: 'acc-1',
        connector: 'fake',
        label: 'Box',
        enabled: true,
        values: accountValues,
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
    ],
  });
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
  const client = new Client({ name: 'e2e-native-egress-guard', version: '0.0.0' });
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
  // Empty / unknown bearer identical Unauthorized
  {
    const registry = buildConnectorRegistry([createFakeEcho()]);
    const store = baseStore();
    const app = createMcpApp({ store, connectorRegistry: registry });
    const { server, baseUrl } = await listen(app);
    try {
      const adminProbe = await fetch(`${baseUrl}/api/connectors`);
      if (adminProbe.status === 404) {
        pass('mcp-port-no-admin', `status ${adminProbe.status}`);
      } else {
        fail('mcp-port-no-admin', `unexpected status ${adminProbe.status}`);
      }

      const initBody = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'e2e', version: '0' },
        },
      });
      const emptyAuth = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ',
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: initBody,
      });
      const unknownAuth = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer unknown-token-e2e',
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: initBody,
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
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  // Successful call passes egress client; handler sees decrypted secret; result clean
  {
    let recordedEgress;
    let recordedValues;
    const registry = buildConnectorRegistry([
      createFakeEcho((_args, accountValues, egressClient) => {
        recordedEgress = egressClient;
        recordedValues = { ...accountValues };
        return { content: [{ type: 'text', text: 'ok' }] };
      }),
    ]);
    const store = baseStore();
    const app = createMcpApp({ store, connectorRegistry: registry });
    const { server, baseUrl } = await listen(app);
    try {
      const result = await withClient(baseUrl, CONFIG_A_TOKEN, (c) =>
        c.callTool({ name: 'fake_echo', arguments: { message: 'hello', account: 'acc-1' } }),
      );
      const callJson = JSON.stringify(result);
      if (
        recordedEgress &&
        typeof recordedEgress.httpsRequest === 'function' &&
        typeof recordedEgress.tlsConnect === 'function' &&
        recordedValues?.token === FIXTURE_SECRET &&
        !callJson.includes(FIXTURE_SECRET)
      ) {
        pass(
          'tools-call-passes-egress',
          'egress present; handler saw secret; MCP result clean',
        );
      } else {
        fail(
          'tools-call-passes-egress',
          `egress=${Boolean(recordedEgress)} values=${JSON.stringify(recordedValues)} result=${callJson}`,
        );
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  // Handler receives egress; checkConnection does not
  {
    let recordedEgress;
    let checkConnectionArgCount = -1;
    const connector = createFakeEcho((_args, _accountValues, egressClient) => {
      recordedEgress = egressClient;
      return { content: [{ type: 'text', text: 'ok' }] };
    });
    connector.checkConnection = (...args) => {
      checkConnectionArgCount = args.length;
    };
    const registry = buildConnectorRegistry([connector]);
    const store = baseStore();
    const app = createMcpApp({ store, connectorRegistry: registry });
    const { server, baseUrl } = await listen(app);
    try {
      await withClient(baseUrl, CONFIG_A_TOKEN, (c) =>
        c.callTool({ name: 'fake_echo', arguments: { message: 'hello', account: 'acc-1' } }),
      );
      await Promise.resolve(
        registry.connectors[0]?.checkConnection({ user: 'alice', token: FIXTURE_SECRET }),
      );
      if (recordedEgress && checkConnectionArgCount === 1) {
        pass('handler-has-egress-checkConnection-does-not', `checkArgs=${checkConnectionArgCount}`);
      } else {
        fail(
          'handler-has-egress-checkConnection-does-not',
          `egress=${Boolean(recordedEgress)} checkArgs=${checkConnectionArgCount}`,
        );
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  // Egress Destination is not allowed reaches MCP unchanged
  {
    const registry = buildConnectorRegistry([
      createFakeEcho(async (_args, _accountValues, egressClient) => {
        await egressClient.httpsRequest({
          host: 'evil.example.test',
          port: 443,
          method: 'GET',
          path: '/',
        });
        return { content: [{ type: 'text', text: 'should-not-reach' }] };
      }),
    ]);
    const store = baseStore();
    const app = createMcpApp({ store, connectorRegistry: registry });
    const { server, baseUrl } = await listen(app);
    try {
      try {
        await withClient(baseUrl, CONFIG_A_TOKEN, (c) =>
          c.callTool({ name: 'fake_echo', arguments: { message: 'hello', account: 'acc-1' } }),
        );
        fail('egress-destination-not-allowed', 'expected rejection');
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (
          msg.includes('Destination is not allowed') &&
          !msg.includes('Tool execution failed') &&
          !msg.includes(FIXTURE_SECRET)
        ) {
          pass('egress-destination-not-allowed', msg);
        } else {
          fail('egress-destination-not-allowed', msg);
        }
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  // Foreign account refuses without calling handler
  {
    let callCount = 0;
    const registry = buildConnectorRegistry([
      createFakeEcho(() => {
        callCount += 1;
        return { content: [{ type: 'text', text: 'ok' }] };
      }),
    ]);
    const store = baseStore();
    const app = createMcpApp({ store, connectorRegistry: registry });
    const { server, baseUrl } = await listen(app);
    try {
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
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  // Disabled account refuses without calling handler
  {
    let callCount = 0;
    const registry = buildConnectorRegistry([
      createFakeEcho(() => {
        callCount += 1;
        return { content: [{ type: 'text', text: 'ok' }] };
      }),
    ]);
    const store = baseStore();
    const app = createMcpApp({ store, connectorRegistry: registry });
    const { server, baseUrl } = await listen(app);
    try {
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
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  // Secret returned in body is redacted
  {
    const registry = buildConnectorRegistry([
      createFakeEcho((_args, accountValues) => ({
        content: [{ type: 'text', text: `token=${accountValues.token ?? ''}` }],
      })),
    ]);
    const store = baseStore();
    const app = createMcpApp({ store, connectorRegistry: registry });
    const { server, baseUrl } = await listen(app);
    try {
      const result = await withClient(baseUrl, CONFIG_A_TOKEN, (c) =>
        c.callTool({ name: 'fake_echo', arguments: { message: 'hello', account: 'acc-1' } }),
      );
      const text = JSON.stringify(result);
      if (text.includes('[redacted]') && !text.includes(FIXTURE_SECRET)) {
        pass('secret-body-redacted', 'result contains [redacted]; fixture secret absent');
      } else {
        fail('secret-body-redacted', text);
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  // Longer secret redacted before shorter overlapping secret
  {
    const connector = createFakeEcho(
      () => ({
        content: [{ type: 'text', text: 'value=abc' }],
      }),
      {
        fields: [
          { name: 'short', label: 'Short', type: 'secret', required: true },
          { name: 'long', label: 'Long', type: 'secret', required: true },
        ],
      },
    );
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
    const app = createMcpApp({ store, connectorRegistry: registry });
    const { server, baseUrl } = await listen(app);
    try {
      const result = await withClient(baseUrl, CONFIG_A_TOKEN, (c) =>
        c.callTool({ name: 'fake_echo', arguments: { message: 'hello', account: 'acc-1' } }),
      );
      const text = JSON.stringify(result);
      if (text.includes('[redacted]') && !text.includes('abc') && !/\[redacted\]c/.test(text)) {
        pass('longer-secret-first', 'abc fully redacted');
      } else {
        fail('longer-secret-first', text);
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  // Empty secret and non-secret fields are not redacted
  {
    const connector = createFakeEcho(
      () => ({
        content: [{ type: 'text', text: 'visible-text and mail.example.test' }],
      }),
      {
        fields: [
          { name: 'token', label: 'Token', type: 'secret', required: false },
          { name: 'note', label: 'Note', type: 'text', required: true },
          { name: 'mailhost', label: 'Mail host', type: 'host', required: true },
        ],
      },
    );
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
    const app = createMcpApp({ store, connectorRegistry: registry });
    const { server, baseUrl } = await listen(app);
    try {
      const result = await withClient(baseUrl, CONFIG_A_TOKEN, (c) =>
        c.callTool({ name: 'fake_echo', arguments: { message: 'hello', account: 'acc-1' } }),
      );
      const text = JSON.stringify(result);
      if (
        text.includes('visible-text') &&
        text.includes('mail.example.test') &&
        !text.includes('[redacted]')
      ) {
        pass('empty-and-non-secret-untouched', 'visible-text and host remain');
      } else {
        fail('empty-and-non-secret-untouched', text);
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  // Secret in error text scrubbed; handler throw fixed English
  {
    const registry = buildConnectorRegistry([
      createFakeEcho(() => {
        throw new Error(`failure leaked ${FIXTURE_SECRET}`);
      }),
    ]);
    const store = baseStore();
    const app = createMcpApp({ store, connectorRegistry: registry });
    const { server, baseUrl } = await listen(app);
    try {
      try {
        await withClient(baseUrl, CONFIG_A_TOKEN, (c) =>
          c.callTool({ name: 'fake_echo', arguments: { message: 'hello', account: 'acc-1' } }),
        );
        fail('secret-in-error-scrubbed', 'expected rejection');
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (
          /Tool execution failed/.test(msg) &&
          !msg.includes(FIXTURE_SECRET) &&
          !msg.includes('failure leaked')
        ) {
          pass('secret-in-error-scrubbed', msg);
        } else {
          fail('secret-in-error-scrubbed', msg);
        }
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  // Live production process port isolation (optional env)
  const prodMcp = process.env.E2E_MCP_PORT;
  const prodAdmin = process.env.E2E_ADMIN_PORT;
  if (prodMcp && prodAdmin) {
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
  } else {
    pass('production-ports', 'skipped — E2E_MCP_PORT/E2E_ADMIN_PORT not set; fake harness covered above');
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nSummary: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

await main();
