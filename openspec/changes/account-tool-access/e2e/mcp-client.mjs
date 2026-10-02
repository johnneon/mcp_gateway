/**
 * Throwaway MCP client for account-tool-access.
 * Uses the fake native connector, the Gmail connector with a fake IMAP transport,
 * and the fake stdio proxy. Does not contact a live host.
 * Run from the repo root:
 *   node node_modules/vite-node/vite-node.mjs openspec/changes/account-tool-access/e2e/mcp-client.mjs
 */
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { gmailConnector } from '../../../../server/src/connectors/gmail/index.js';
import { createProxyRuntime, PROXY_IDLE_TIMEOUT_MS } from '../../../../server/src/connectors/proxy/runtime.js';
import { buildConnectorRegistry } from '../../../../server/src/connectors/registry.js';
import { createAdminApp } from '../../../../server/src/http/createAdminApp.js';
import { createMcpApp } from '../../../../server/src/http/createMcpApp.js';
import { createGmailFakeEgressTransport } from '../../../../server/test/connectors/gmail/fake-egress.js';

const require = createRequire(import.meta.url);

const FIXTURE_SECRET = 'account-tool-access-e2e-secret-UNIQUE';
const GMAIL_PASSWORD = 'gmail-denylist-e2e-password-UNIQUE';
const PROXY_SECRET = 'proxy-denylist-e2e-secret-UNIQUE';
const GMAIL_ADDRESS = 'user@gmail.com';

const calls = { keep: 0, drop: 0 };

function createMemoryStore(initial = {}) {
  let document = structuredClone(initial);
  return {
    read() {
      return structuredClone(document);
    },
    replace(next) {
      document = structuredClone(next);
      return Promise.resolve();
    },
  };
}

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr === null || typeof addr === 'string') {
        reject(new Error('no address'));
        return;
      }
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${addr.port}`,
      });
    });
    server.on('error', reject);
  });
}

function parentEnv() {
  const parent = {};
  if (process.env.PATH !== undefined) {
    parent.PATH = process.env.PATH;
  }
  if (process.env.SYSTEMROOT !== undefined) {
    parent.SYSTEMROOT = process.env.SYSTEMROOT;
  }
  return parent;
}

const fake = {
  id: 'fake',
  name: 'Fake',
  kind: 'native',
  fields: [
    { name: 'user', label: 'User', type: 'text', required: true },
    { name: 'token', label: 'Token', type: 'secret', required: true },
  ],
  allowedDestinations: [{ host: 'fake.example.test', port: 443 }],
  checkConnection: () => undefined,
  tools: ['keep', 'drop'].map((name) => ({
    name,
    description: name === 'keep' ? 'Keep a row' : 'Drop a row',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message'],
    },
    handler: () => {
      calls[name] += 1;
      return { content: [{ type: 'text', text: 'ok' }] };
    },
  })),
};

const launchDir = await mkdtemp(path.join(tmpdir(), 'account-tool-access-proxy-'));
const launchFile = path.join(launchDir, 'launches.txt');
await writeFile(launchFile, '0', 'utf8');

const proxy = {
  id: 'stdiofake',
  name: 'Stdio fake',
  kind: 'proxy',
  fields: [{ name: 'token', label: 'Token', type: 'secret', required: true }],
  allowedDestinations: [{ host: 'example.test', port: 443 }],
  checkConnection: () => undefined,
  entryPath: require.resolve('@mcp-gateway/fake-stdio-mcp'),
  args: [launchFile],
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

const egress = createGmailFakeEgressTransport({
  imap: {
    user: GMAIL_ADDRESS,
    password: GMAIL_PASSWORD,
    messages: [
      {
        uid: 7,
        from: 'alice@example.test',
        to: GMAIL_ADDRESS,
        subject: 'Delete me',
        date: 'Mon, 1 Jan 2024 00:00:00 +0000',
        seen: false,
        textBody: 'Body',
      },
    ],
    mailboxes: [{ name: 'Deleted Items', attributes: ['\\Trash'], messages: [] }],
  },
  smtp: { user: GMAIL_ADDRESS, password: GMAIL_PASSWORD },
});

const store = createMemoryStore({});
const registry = buildConnectorRegistry([fake, gmailConnector, proxy]);
const proxyRuntime = createProxyRuntime({
  platform: process.platform,
  parentEnv: parentEnv(),
  idleTimeoutMs: PROXY_IDLE_TIMEOUT_MS,
  now: () => Date.now(),
  schedule: (callback, delayMs) => {
    const timer = setTimeout(callback, delayMs);
    return {
      cancel() {
        clearTimeout(timer);
      },
    };
  },
});
const adminApp = createAdminApp({
  store,
  connectorRegistry: registry,
  egressTransport: egress,
});
const mcpApp = createMcpApp({
  store,
  connectorRegistry: registry,
  egressTransport: egress,
  proxyRuntime,
});
const admin = await listen(adminApp);
const mcp = await listen(mcpApp);

const leaks = [FIXTURE_SECRET, GMAIL_PASSWORD, PROXY_SECRET];
const report = [];

function assertClean(label, text) {
  for (const secret of leaks) {
    if (text.includes(secret)) {
      throw new Error(`${label} contains a fixture secret`);
    }
  }
}

async function api(method, pathname, body) {
  const response = await fetch(`${admin.baseUrl}${pathname}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  assertClean(`${method} ${pathname}`, text);
  let json = null;
  if (text.startsWith('{') || text.startsWith('[')) {
    json = JSON.parse(text);
  }
  return { status: response.status, text, json };
}

async function withClient(token, run) {
  const transport = new StreamableHTTPClientTransport(new URL(`${mcp.baseUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: 'account-tool-access-e2e', version: '0.0.0' });
  await client.connect(transport);
  try {
    return await run(client);
  } finally {
    await client.close();
  }
}

function toolNames(listed) {
  return listed.tools.map((tool) => tool.name);
}

function accountField(tool) {
  const schema = tool?.inputSchema;
  const account = schema?.properties?.account;
  return account ?? {};
}

async function callError(client, name, args) {
  try {
    const result = await client.callTool({ name, arguments: args });
    return { ok: true, text: JSON.stringify(result) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, text: message };
  }
}

async function launchCount() {
  const text = await readFile(launchFile, 'utf8');
  return Number.parseInt(text.trim(), 10);
}

async function scenario(name, run) {
  try {
    const detail = await run();
    report.push({ name, status: 'passed', detail });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    report.push({ name, status: 'failed', detail: message });
  }
}

const createdA = await api('POST', '/api/configurations', { name: 'Config A' });
const createdB = await api('POST', '/api/configurations', { name: 'Config B' });
const tokenA = createdA.json.token;
const tokenB = createdB.json.token;
const configA = createdA.json.id;
const configB = createdB.json.id;

const account = await api('POST', '/api/accounts', {
  connector: 'fake',
  label: 'Box',
  values: { user: 'alice', token: FIXTURE_SECRET },
});
const foreign = await api('POST', '/api/accounts', {
  connector: 'fake',
  label: 'Foreign',
  values: { user: 'bob', token: FIXTURE_SECRET },
});
const accountId = account.json.id;
const foreignId = foreign.json.id;

await scenario('Missing denylist lists every tool for the assigned account', async () => {
  await api('PUT', `/api/configurations/${configA}/accounts`, { accountIds: [accountId] });
  const listed = await withClient(tokenA, (client) => client.listTools());
  const names = toolNames(listed);
  if (!names.includes('fake_keep') || !names.includes('fake_drop')) {
    throw new Error(`listed ${names.join(',')}`);
  }
  const keep = listed.tools.find((tool) => tool.name === 'fake_keep');
  if (JSON.stringify(accountField(keep).enum) !== JSON.stringify([accountId])) {
    throw new Error(`enum ${JSON.stringify(accountField(keep))}`);
  }
  assertClean('tools/list', JSON.stringify(listed));
  return names.filter((name) => name.startsWith('fake_')).join(',');
});

await scenario('Tool omitted when every assigned account has it disabled', async () => {
  await api('PUT', `/api/configurations/${configA}/accounts/${accountId}/disabled-tools`, {
    toolNames: ['fake_drop'],
  });
  const listed = await withClient(tokenA, (client) => client.listTools());
  const names = toolNames(listed);
  if (!names.includes('fake_keep') || names.includes('fake_drop')) {
    throw new Error(`listed ${names.join(',')}`);
  }
  assertClean('tools/list omit', JSON.stringify(listed));
  return 'fake_keep only';
});

await scenario('Same account on another configuration still lists the tool', async () => {
  await api('PUT', `/api/configurations/${configB}/accounts`, { accountIds: [accountId] });
  const listed = await withClient(tokenB, (client) => client.listTools());
  const drop = listed.tools.find((tool) => tool.name === 'fake_drop');
  if (!drop) {
    throw new Error('fake_drop missing on config B');
  }
  if (JSON.stringify(accountField(drop).enum) !== JSON.stringify([accountId])) {
    throw new Error(`enum ${JSON.stringify(accountField(drop).enum)}`);
  }
  assertClean('tools/list B', JSON.stringify(listed));
  return 'fake_drop listed for config B';
});

await scenario('Disabled account is omitted from that tool enum only', async () => {
  const second = await api('POST', '/api/accounts', {
    connector: 'fake',
    label: 'Beta',
    values: { user: 'cara', token: FIXTURE_SECRET },
  });
  const secondId = second.json.id;
  await api('PUT', `/api/configurations/${configA}/accounts`, {
    accountIds: [accountId, secondId],
  });
  await api('PUT', `/api/configurations/${configA}/accounts/${accountId}/disabled-tools`, {
    toolNames: ['fake_drop'],
  });
  const listed = await withClient(tokenA, (client) => client.listTools());
  const drop = accountField(listed.tools.find((tool) => tool.name === 'fake_drop'));
  const keep = accountField(listed.tools.find((tool) => tool.name === 'fake_keep'));
  if (JSON.stringify(drop.enum) !== JSON.stringify([secondId])) {
    throw new Error(`drop enum ${JSON.stringify(drop.enum)}`);
  }
  if (JSON.stringify(keep.enum) !== JSON.stringify([accountId, secondId])) {
    throw new Error(`keep enum ${JSON.stringify(keep.enum)}`);
  }
  if (String(drop.description ?? '').includes(accountId)) {
    throw new Error('drop description still names the disabled account');
  }
  assertClean('enum', JSON.stringify(listed));
  return `drop enum ${secondId}`;
});

await scenario('Disabled tool returns the fixed error and does not call the handler', async () => {
  await api('PUT', `/api/configurations/${configA}/accounts`, { accountIds: [accountId] });
  await api('PUT', `/api/configurations/${configA}/accounts/${accountId}/disabled-tools`, {
    toolNames: ['fake_drop'],
  });
  const before = { ...calls };
  const denied = await withClient(tokenA, (client) =>
    callError(client, 'fake_drop', { message: 'hello', account: accountId }),
  );
  if (denied.ok || !denied.text.includes('Tool is disabled for this account')) {
    throw new Error(denied.text);
  }
  if (denied.text.includes('Invalid tool arguments')) {
    throw new Error(denied.text);
  }
  const kept = await withClient(tokenA, (client) =>
    client.callTool({ name: 'fake_keep', arguments: { message: 'hello', account: accountId } }),
  );
  if (calls.drop !== before.drop || calls.keep !== before.keep + 1) {
    throw new Error(`counters ${JSON.stringify(calls)}`);
  }
  assertClean('disabled call', denied.text + JSON.stringify(kept));
  return denied.text;
});

await scenario('Foreign account refuses without calling handler', async () => {
  const before = calls.keep;
  const denied = await withClient(tokenA, (client) =>
    callError(client, 'fake_keep', { message: 'hello', account: foreignId }),
  );
  if (denied.ok) {
    throw new Error('foreign call succeeded');
  }
  if (calls.keep !== before) {
    throw new Error('handler ran');
  }
  assertClean('foreign', denied.text);
  return denied.text;
});

await scenario('Disabled account refuses without calling handler', async () => {
  const before = calls.keep;
  const patched = await api('PATCH', `/api/accounts/${accountId}`, { enabled: false });
  if (patched.status !== 200) {
    throw new Error(`patch ${patched.status}`);
  }
  const denied = await withClient(tokenA, (client) =>
    callError(client, 'fake_keep', { message: 'hello', account: accountId }),
  );
  await api('PATCH', `/api/accounts/${accountId}`, { enabled: true });
  if (denied.ok || calls.keep !== before) {
    throw new Error(`ran=${calls.keep - before} ${denied.text}`);
  }
  assertClean('disabled account', denied.text);
  return denied.text;
});

await scenario('gmail_delete_message off on one configuration leaves the other path working', async () => {
  const gmailAccount = await api('POST', '/api/accounts', {
    connector: 'gmail',
    label: 'Personal',
    values: { address: GMAIL_ADDRESS, password: GMAIL_PASSWORD },
  });
  if (gmailAccount.status !== 201) {
    throw new Error(`gmail create ${gmailAccount.status} ${gmailAccount.text}`);
  }
  const gmailId = gmailAccount.json.id;
  await api('PUT', `/api/configurations/${configA}/accounts`, { accountIds: [gmailId] });
  await api('PUT', `/api/configurations/${configB}/accounts`, { accountIds: [gmailId] });
  await api('PUT', `/api/configurations/${configA}/accounts/${gmailId}/disabled-tools`, {
    toolNames: ['gmail_delete_message'],
  });
  const before = egress.tlsSessionCallCount;
  const denied = await withClient(tokenA, (client) =>
    callError(client, 'gmail_delete_message', { account: gmailId, uid: 7 }),
  );
  if (!denied.text.includes('Tool is disabled for this account')) {
    throw new Error(denied.text);
  }
  if (egress.tlsSessionCallCount !== before) {
    throw new Error(`imap sessions ${egress.tlsSessionCallCount}`);
  }
  const listed = await withClient(tokenA, (client) =>
    client.callTool({ name: 'gmail_list_mailboxes', arguments: { account: gmailId } }),
  );
  if (!JSON.stringify(listed).includes('INBOX')) {
    throw new Error('list_mailboxes missed INBOX');
  }
  const deleted = await withClient(tokenB, (client) =>
    client.callTool({
      name: 'gmail_delete_message',
      arguments: { account: gmailId, uid: 7 },
    }),
  );
  if (!JSON.stringify(deleted).includes('Deleted Items')) {
    throw new Error(JSON.stringify(deleted));
  }
  assertClean('gmail', denied.text + JSON.stringify(listed) + JSON.stringify(deleted));
  return 'A refused, list_mailboxes ok, B deleted';
});

await scenario('Disabled proxy tool is absent when no account may use it', async () => {
  const proxyAccount = await api('POST', '/api/accounts', {
    connector: 'stdiofake',
    label: 'Proxy box',
    values: { token: PROXY_SECRET },
  });
  if (proxyAccount.status !== 201) {
    throw new Error(`proxy create ${proxyAccount.status} ${proxyAccount.text}`);
  }
  const proxyId = proxyAccount.json.id;
  const proxyConfig = await api('POST', '/api/configurations', { name: 'Proxy config' });
  const proxyToken = proxyConfig.json.token;
  await api('PUT', `/api/configurations/${proxyConfig.json.id}/accounts`, { accountIds: [proxyId] });
  await api('PUT', `/api/configurations/${proxyConfig.json.id}/accounts/${proxyId}/disabled-tools`, {
    toolNames: ['stdiofake_echo_args'],
  });
  const before = await launchCount();
  const listed = await withClient(proxyToken, (client) => client.listTools());
  const names = toolNames(listed);
  if (names.includes('stdiofake_echo_args') || !names.includes('stdiofake_leak_secret')) {
    throw new Error(names.join(','));
  }
  if ((await launchCount()) !== before) {
    throw new Error('child started on list');
  }
  assertClean('proxy list', JSON.stringify(listed));
  const denied = await withClient(proxyToken, (client) =>
    callError(client, 'stdiofake_echo_args', { account: proxyId, note: 'hello' }),
  );
  if (!denied.text.includes('Tool is disabled for this account')) {
    throw new Error(denied.text);
  }
  if ((await launchCount()) !== before) {
    throw new Error('child started on disabled call');
  }
  assertClean('proxy call', denied.text);
  return 'echo_args hidden and refused, launch count unchanged';
});

await scenario('Empty and unknown bearer identical rejection', async () => {
  async function probe(authorization) {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
    if (authorization !== undefined) {
      headers.Authorization = authorization;
    }
    const response = await fetch(`${mcp.baseUrl}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'e2e', version: '0.0.0' },
        },
      }),
    });
    const text = await response.text();
    assertClean('auth', text);
    return { status: response.status, text };
  }
  const empty = await probe('Bearer ');
  const unknown = await probe('Bearer not-a-real-token');
  if (empty.status !== 401 || unknown.status !== 401 || empty.text !== unknown.text) {
    throw new Error(`empty ${empty.status} ${empty.text} unknown ${unknown.status} ${unknown.text}`);
  }
  return 'both 401 with the same body';
});

await scenario('MCP vs admin port separation', async () => {
  const adminMcp = await fetch(`${admin.baseUrl}/mcp`, { method: 'POST' });
  const adminText = await adminMcp.text();
  const mcpApi = await fetch(`${mcp.baseUrl}/api/connectors`);
  const mcpText = await mcpApi.text();
  assertClean('ports', adminText + mcpText);
  if (adminMcp.status !== 404 || mcpApi.status !== 404) {
    throw new Error(`admin /mcp ${adminMcp.status} mcp /api ${mcpApi.status}`);
  }
  return 'admin /mcp 404 and mcp /api/connectors 404';
});

await scenario('Admin API responses omit bearer and secrets', async () => {
  const listedAccounts = await api('GET', '/api/accounts');
  const listedConfigs = await api('GET', '/api/configurations');
  const listedConnectors = await api('GET', '/api/connectors');
  const disabled = await api(
    'GET',
    `/api/configurations/${configA}/accounts/${accountId}/disabled-tools`,
  );
  const blob =
    listedAccounts.text + listedConfigs.text + listedConnectors.text + disabled.text;
  if (listedConfigs.text.includes('tokenHash') || listedConfigs.text.includes('disabledTools')) {
    throw new Error('public configuration JSON leaked store fields');
  }
  if (blob.includes(tokenA) || blob.includes(tokenB)) {
    throw new Error('raw bearer returned again');
  }
  assertClean('admin json', blob);
  return `accounts ${listedAccounts.status} configurations ${listedConfigs.status} connectors ${listedConnectors.status}`;
});

const failed = report.filter((item) => item.status === 'failed');
console.log(JSON.stringify({ admin: admin.baseUrl, mcp: mcp.baseUrl, report, calls, tls: egress.tlsSessionCallCount }, null, 2));
await proxyRuntime.close();
admin.server.close();
mcp.server.close();
if (failed.length > 0) {
  process.exitCode = 1;
}
