/**
 * Throwaway MCP client for proxy-tools.
 * Injects the fake stdio connector. Does not call a live host.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createProxyRuntime } from '../../../../server/dist/connectors/proxy/runtime.js';
import { buildConnectorRegistry } from '../../../../server/dist/connectors/registry.js';
import { createMcpApp } from '../../../../server/dist/http/createMcpApp.js';
import { hashToken } from '../../../../server/dist/token/token.js';

const FIXTURE_SECRET = 'proxy-e2e-secret-UNIQUE-9f3a';
const FOREIGN_SECRET = 'proxy-e2e-foreign-secret-UNIQUE-9f3a';
const DISABLED_SECRET = 'proxy-e2e-disabled-secret-UNIQUE-9f3a';
const STDERR_MARKER = 'fake-stdio-mcp-stderr-marker';
const TOKEN_OK = 'proxy-e2e-bearer-ok-UNIQUE-9f3a';
const TOKEN_NONE = 'proxy-e2e-bearer-none-UNIQUE-9f3a';
const TOKEN_DISABLED = 'proxy-e2e-bearer-disabled-UNIQUE-9f3a';
const UNKNOWN_TOKEN = 'proxy-e2e-bearer-unknown-UNIQUE-9f3a';
const CONNECTOR_ID = 'stdiofake';
const ACCOUNT_OK = 'acc-ok';
const ACCOUNT_FOREIGN = 'acc-foreign';
const ACCOUNT_DISABLED = 'acc-disabled';
const ACCOUNT_LABEL = 'Proxy box';

const require = createRequire(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../../server/package.json'),
);

const results = [];

function pass(name, detail) {
  results.push({ name, ok: true, detail });
  console.log(`PASS: ${name} — ${detail}`);
}

function fail(name, detail) {
  results.push({ name, ok: false, detail });
  console.error(`FAIL: ${name} — ${detail}`);
}

function createMemoryStore(document) {
  let doc = structuredClone(document);
  return {
    read() {
      return structuredClone(doc);
    },
    replace(next) {
      doc = structuredClone(next);
      return Promise.resolve();
    },
  };
}

async function listen(app) {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
    server.once('error', reject);
  });
  const address = server.address();
  return { server, baseUrl: `http://127.0.0.1:${String(address.port)}` };
}

async function withClient(baseUrl, token, run) {
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: 'e2e-proxy-tools', version: '0.0.0' });
  await client.connect(transport);
  try {
    return await run(client);
  } finally {
    await client.close();
  }
}

async function readLaunchCount(filePath) {
  const text = await readFile(filePath, 'utf8');
  return Number.parseInt(text.trim(), 10);
}

async function postMcp(baseUrl, authorization) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(authorization === undefined ? {} : { Authorization: authorization }),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'e2e-proxy-tools', version: '0.0.0' },
      },
    }),
  });
  const body = await response.text();
  return { status: response.status, body };
}

function toolText(result) {
  const content = result.content;
  if (!Array.isArray(content) || content.length === 0) {
    throw new Error('The tool result has no content.');
  }
  const first = content[0];
  if (first === null || typeof first !== 'object' || typeof first.text !== 'string') {
    throw new Error('The tool result has no text.');
  }
  return first.text;
}

async function expectCallError(baseUrl, token, name, args) {
  try {
    const result = await withClient(baseUrl, token, (client) =>
      client.callTool({ name, arguments: args }),
    );
    return { threw: false, text: JSON.stringify(result) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { threw: true, text: message };
  }
}

async function main() {
  const dir = await mkdtemp(path.join(tmpdir(), 'proxy-tools-e2e-'));
  const countFile = path.join(dir, 'launches.txt');
  await writeFile(countFile, '0', 'utf8');

  const registry = buildConnectorRegistry([
    {
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
    },
  ]);

  const store = createMemoryStore({
    accounts: [
      {
        id: ACCOUNT_OK,
        connector: CONNECTOR_ID,
        label: ACCOUNT_LABEL,
        enabled: true,
        values: { token: FIXTURE_SECRET },
      },
      {
        id: ACCOUNT_FOREIGN,
        connector: CONNECTOR_ID,
        label: 'Foreign box',
        enabled: true,
        values: { token: FOREIGN_SECRET },
      },
      {
        id: ACCOUNT_DISABLED,
        connector: CONNECTOR_ID,
        label: 'Disabled box',
        enabled: false,
        values: { token: DISABLED_SECRET },
      },
    ],
    configurations: [
      {
        id: 'cfg-ok',
        name: 'Eligible',
        tokenHash: hashToken(TOKEN_OK),
        enabled: true,
        accountIds: [ACCOUNT_OK],
      },
      {
        id: 'cfg-none',
        name: 'None',
        tokenHash: hashToken(TOKEN_NONE),
        enabled: true,
        accountIds: [],
      },
      {
        id: 'cfg-disabled',
        name: 'Disabled',
        tokenHash: hashToken(TOKEN_DISABLED),
        enabled: true,
        accountIds: [ACCOUNT_DISABLED],
      },
    ],
  });

  const parentEnv = {};
  if (process.env.PATH !== undefined) {
    parentEnv.PATH = process.env.PATH;
  }
  if (process.env.SYSTEMROOT !== undefined) {
    parentEnv.SYSTEMROOT = process.env.SYSTEMROOT;
  }
  const runtime = createProxyRuntime({
    platform: process.platform,
    parentEnv,
    idleTimeoutMs: 300000,
    now: () => 0,
    schedule: () => ({
      cancel() {
        return undefined;
      },
    }),
  });

  const { server, baseUrl } = await listen(
    createMcpApp({ store, connectorRegistry: registry, proxyRuntime: runtime }),
  );

  try {
    const missing = await postMcp(baseUrl, undefined);
    const empty = await postMcp(baseUrl, 'Bearer ');
    const unknown = await postMcp(baseUrl, `Bearer ${UNKNOWN_TOKEN}`);
    if (
      missing.status === 401 &&
      empty.status === 401 &&
      unknown.status === 401 &&
      missing.body === empty.body &&
      empty.body === unknown.body &&
      missing.body === 'Unauthorized'
    ) {
      pass(
        'Empty bearer and unknown bearer',
        'missing header, empty bearer, and unknown bearer were all 401 Unauthorized',
      );
    } else {
      fail(
        'Empty bearer and unknown bearer',
        `missing=${String(missing.status)} ${missing.body}; empty=${String(empty.status)} ${empty.body}; unknown=${String(unknown.status)} ${unknown.body}`,
      );
    }

    const adminOnMcp = await fetch(`${baseUrl}/api/connectors`);
    const adminBody = await adminOnMcp.text();
    if (adminOnMcp.status === 404 && adminBody === 'Not Found') {
      pass('MCP port does not serve the admin API', 'GET /api/connectors returned 404 Not Found');
    } else {
      fail(
        'MCP port does not serve the admin API',
        `${String(adminOnMcp.status)} ${adminBody}`,
      );
    }

    const listed = await withClient(baseUrl, TOKEN_OK, (client) => client.listTools());
    const names = listed.tools.map((tool) => tool.name);
    const serialized = JSON.stringify(listed);
    const echo = listed.tools.find((tool) => tool.name === `${CONNECTOR_ID}_echo_args`);
    const leak = listed.tools.find((tool) => tool.name === `${CONNECTOR_ID}_leak_secret`);
    const echoSchema = echo?.inputSchema;
    const leakSchema = leak?.inputSchema;
    const echoAccount =
      echoSchema !== undefined &&
      typeof echoSchema === 'object' &&
      echoSchema.properties !== undefined &&
      typeof echoSchema.properties === 'object'
        ? echoSchema.properties.account
        : undefined;
    const listOk =
      names.includes(`${CONNECTOR_ID}_echo_args`) &&
      names.includes(`${CONNECTOR_ID}_leak_secret`) &&
      !names.includes(`${CONNECTOR_ID}_report_env`) &&
      !names.includes(`${CONNECTOR_ID}_crash`) &&
      Array.isArray(echoSchema?.required) &&
      echoSchema.required.includes('account') &&
      echoSchema.required.includes('note') &&
      Array.isArray(leakSchema?.required) &&
      leakSchema.required.includes('account') &&
      echoAccount !== undefined &&
      typeof echoAccount === 'object' &&
      Array.isArray(echoAccount.enum) &&
      echoAccount.enum.length === 1 &&
      echoAccount.enum[0] === ACCOUNT_OK &&
      typeof echoAccount.description === 'string' &&
      echoAccount.description.includes(`${ACCOUNT_OK} (${ACCOUNT_LABEL})`) &&
      !serialized.includes(FIXTURE_SECRET) &&
      !serialized.includes(FOREIGN_SECRET) &&
      !serialized.includes(DISABLED_SECRET) &&
      (await readLaunchCount(countFile)) === 0;
    if (listOk) {
      pass(
        'Allowlisted tools are listed with prefix and account and list starts no child',
        `listed ${names.join(', ')}; account enum is ${ACCOUNT_OK}; launch count 0; secret absent`,
      );
      pass(
        'Tools off the allowlist do not appear',
        'report_env and crash were absent; launch count 0',
      );
    } else {
      fail(
        'Allowlisted tools are listed with prefix and account and list starts no child',
        `${serialized}; launch=${String(await readLaunchCount(countFile))}`,
      );
    }

    const hidden = await withClient(baseUrl, TOKEN_NONE, (client) => client.listTools());
    const hiddenNames = hidden.tools.map((tool) => tool.name);
    if (
      !hiddenNames.includes(`${CONNECTOR_ID}_echo_args`) &&
      !hiddenNames.includes(`${CONNECTOR_ID}_leak_secret`)
    ) {
      pass(
        'No eligible account hides proxy tools',
        `listed ${hiddenNames.length === 0 ? 'no tools' : hiddenNames.join(', ')}`,
      );
    } else {
      fail('No eligible account hides proxy tools', hiddenNames.join(', '));
    }

    const missingNote = await expectCallError(baseUrl, TOKEN_OK, `${CONNECTOR_ID}_echo_args`, {
      account: ACCOUNT_OK,
    });
    if (
      missingNote.threw &&
      missingNote.text.includes('Invalid tool arguments') &&
      (await readLaunchCount(countFile)) === 0
    ) {
      pass(
        'Allowlist schema rejects a call the child would accept',
        'Invalid tool arguments; launch count 0',
      );
    } else {
      fail(
        'Allowlist schema rejects a call the child would accept',
        `${missingNote.text}; launch=${String(await readLaunchCount(countFile))}`,
      );
    }

    const ineligible = await expectCallError(baseUrl, TOKEN_NONE, `${CONNECTOR_ID}_echo_args`, {
      account: ACCOUNT_OK,
      note: 'hello',
    });
    if (
      ineligible.threw &&
      ineligible.text.includes('Account is not allowed') &&
      (await readLaunchCount(countFile)) === 0
    ) {
      pass(
        'Ineligible account does not start the child',
        'Account is not allowed; launch count 0',
      );
    } else {
      fail(
        'Ineligible account does not start the child',
        `${ineligible.text}; launch=${String(await readLaunchCount(countFile))}`,
      );
    }

    const foreign = await expectCallError(baseUrl, TOKEN_OK, `${CONNECTOR_ID}_echo_args`, {
      account: ACCOUNT_FOREIGN,
      note: 'hello',
    });
    if (foreign.threw && (await readLaunchCount(countFile)) === 0 && !foreign.text.includes(FIXTURE_SECRET)) {
      pass(
        'Foreign account does not start the child',
        `${foreign.text}; launch count 0`,
      );
    } else {
      fail(
        'Foreign account does not start the child',
        `${foreign.text}; launch=${String(await readLaunchCount(countFile))}`,
      );
    }

    const disabled = await expectCallError(
      baseUrl,
      TOKEN_DISABLED,
      `${CONNECTOR_ID}_echo_args`,
      {
        account: ACCOUNT_DISABLED,
        note: 'hello',
      },
    );
    if (
      disabled.threw &&
      disabled.text.includes('Account is not allowed') &&
      (await readLaunchCount(countFile)) === 0 &&
      !disabled.text.includes(DISABLED_SECRET)
    ) {
      pass(
        'Disabled account does not start the child',
        'Account is not allowed; launch count 0',
      );
    } else {
      fail(
        'Disabled account does not start the child',
        `${disabled.text}; launch=${String(await readLaunchCount(countFile))}`,
      );
    }

    const unknownTool = await expectCallError(baseUrl, TOKEN_OK, `${CONNECTOR_ID}_report_env`, {
      account: ACCOUNT_OK,
    });
    if (
      unknownTool.threw &&
      unknownTool.text.includes('Unknown tool') &&
      (await readLaunchCount(countFile)) === 0
    ) {
      pass(
        'Non-allowlisted tool name does not start the child',
        'Unknown tool; launch count 0',
      );
    } else {
      fail(
        'Non-allowlisted tool name does not start the child',
        `${unknownTool.text}; launch=${String(await readLaunchCount(countFile))}`,
      );
    }

    const echoed = await withClient(baseUrl, TOKEN_OK, (client) =>
      client.callTool({
        name: `${CONNECTOR_ID}_echo_args`,
        arguments: { account: ACCOUNT_OK, note: 'hello' },
      }),
    );
    const echoText = toolText(echoed);
    const parsed = JSON.parse(echoText);
    if (
      parsed.note === 'hello' &&
      !Object.prototype.hasOwnProperty.call(parsed, 'account') &&
      !echoText.includes(ACCOUNT_OK) &&
      !echoText.includes(FIXTURE_SECRET) &&
      (await readLaunchCount(countFile)) === 1
    ) {
      pass(
        'echo_args receives arguments without account',
        'result JSON note is hello; no account property; launch count 1',
      );
    } else {
      fail(
        'echo_args receives arguments without account',
        `${echoText}; launch=${String(await readLaunchCount(countFile))}`,
      );
    }

    const leaked = await withClient(baseUrl, TOKEN_OK, (client) =>
      client.callTool({
        name: `${CONNECTOR_ID}_leak_secret`,
        arguments: { account: ACCOUNT_OK },
      }),
    );
    const leakText = toolText(leaked);
    const leakSerialized = JSON.stringify(leaked);
    if (
      leakText.includes('[redacted]') &&
      !leakText.includes(FIXTURE_SECRET) &&
      !leakText.includes(STDERR_MARKER) &&
      !leakSerialized.includes(FIXTURE_SECRET) &&
      !leakSerialized.includes(STDERR_MARKER)
    ) {
      pass(
        'Secret in the result is redacted and the stderr marker is absent',
        'result contains [redacted]; secret and stderr marker absent',
      );
    } else {
      fail(
        'Secret in the result is redacted and the stderr marker is absent',
        leakSerialized,
      );
    }
  } finally {
    await runtime.close();
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
    await rm(dir, { recursive: true, force: true });
  }

  const failed = results.filter((item) => !item.ok);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

await main();
