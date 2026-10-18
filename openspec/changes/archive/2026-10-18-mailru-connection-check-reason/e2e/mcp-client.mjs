/**
 * Throwaway MCP walk for mailru-connection-check-reason.
 * Talks to the harness fake. Does not contact a live Mail.ru host.
 * Run from the repo root after harness.mjs prints READY:
 *   $env:ADMIN_URL=...; $env:MCP_URL=...; $env:CONTROL_URL=...
 *   node openspec/changes/mailru-connection-check-reason/e2e/mcp-client.mjs
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const adminUrl = process.env.ADMIN_URL?.replace(/\/$/, '');
const mcpUrl = process.env.MCP_URL?.replace(/\/$/, '');
const controlUrl = process.env.CONTROL_URL?.replace(/\/$/, '');
const FIXTURE_PASSWORD = 'mailru-e2e-fixture-app-password-UNIQUE';
const NEXT_PASSWORD = 'mailru-e2e-fixture-app-password-NEXT';
const UNKNOWN_BEARER = 'unknown-bearer-UNIQUE';
const ADDRESS = 'user@mail.ru';

if (!adminUrl || !mcpUrl || !controlUrl) {
  console.error('FAIL setup — ADMIN_URL, MCP_URL, and CONTROL_URL are required');
  process.exit(1);
}

const leaks = [FIXTURE_PASSWORD, NEXT_PASSWORD];

function leaked(text) {
  return leaks.some((secret) => text.includes(secret));
}

function pass(name, detail) {
  console.log(`PASS ${name} — ${detail}`);
}

function fail(name, detail) {
  console.error(`FAIL ${name} — ${detail}`);
  process.exitCode = 1;
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  return { status: response.status, text };
}

async function jsonRequest(url, method, body, headers = {}) {
  return request(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function state() {
  const response = await request(`${controlUrl}/state`);
  return JSON.parse(response.text);
}

async function withClient(token, run) {
  const headers = {};
  if (token !== undefined) {
    headers.Authorization = `Bearer ${token}`;
  }
  const transport = new StreamableHTTPClientTransport(new URL(`${mcpUrl}/mcp`), {
    requestInit: { headers },
  });
  const client = new Client({ name: 'e2e-mailru-check-reason', version: '0.0.0' });
  await client.connect(transport);
  try {
    return await run(client);
  } finally {
    await client.close();
  }
}

function errorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function unauthorizedBody(authHeader) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (authHeader !== undefined) {
    headers.Authorization = authHeader;
  }
  return request(`${mcpUrl}/mcp`, {
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
}

const adminMcp = await request(`${adminUrl}/mcp`, { method: 'POST' });
const mcpApi = await request(`${mcpUrl}/api/connectors`);
if (adminMcp.status === 404 && mcpApi.status === 404 && !leaked(adminMcp.text) && !leaked(mcpApi.text)) {
  pass('port separation', 'admin /mcp 404; MCP /api/connectors 404');
} else {
  fail(
    'port separation',
    `admin /mcp ${String(adminMcp.status)}; MCP /api ${String(mcpApi.status)}`,
  );
}

const empty = await unauthorizedBody(undefined);
const unknown = await unauthorizedBody(`Bearer ${UNKNOWN_BEARER}`);
if (
  empty.status === 401 &&
  unknown.status === 401 &&
  empty.text === unknown.text &&
  !leaked(empty.text) &&
  !empty.text.includes(UNKNOWN_BEARER)
) {
  pass('bearer rejection', 'empty and unknown bearer identical 401');
} else {
  fail(
    'bearer rejection',
    `empty=${String(empty.status)} unknown=${String(unknown.status)} equal=${String(empty.text === unknown.text)}`,
  );
}

const imap = await jsonRequest(`${controlUrl}/imap`, 'POST', {
  acceptLogin: true,
  password: NEXT_PASSWORD,
});
if (imap.status !== 200) {
  fail('fake imap', `control status ${String(imap.status)}`);
}

const beforeCreate = await state();
const foreign = await jsonRequest(`${adminUrl}/api/accounts`, 'POST', {
  connector: 'mailru',
  label: 'Foreign',
  values: { address: ADDRESS, password: NEXT_PASSWORD },
});
const disabled = await jsonRequest(`${adminUrl}/api/accounts`, 'POST', {
  connector: 'mailru',
  label: 'Disabled',
  values: { address: ADDRESS, password: NEXT_PASSWORD },
});
if (
  foreign.status === 201 &&
  disabled.status === 201 &&
  !leaked(foreign.text) &&
  !leaked(disabled.text)
) {
  pass('extra accounts', 'foreign and disabled creates returned 201 without the fixture password');
} else {
  fail(
    'extra accounts',
    `foreign=${String(foreign.status)} disabled=${String(disabled.status)} leak=${String(leaked(foreign.text) || leaked(disabled.text))}`,
  );
}

const foreignId = JSON.parse(foreign.text).id;
const disabledId = JSON.parse(disabled.text).id;
const inbox = beforeCreate.accounts.find((account) => account.label === 'Inbox');
const turnedOff = await jsonRequest(`${adminUrl}/api/accounts/${disabledId}`, 'PATCH', {
  enabled: false,
});
if (turnedOff.status !== 200 || leaked(turnedOff.text)) {
  fail('disable account', `status ${String(turnedOff.status)}`);
}

const createdConfig = await jsonRequest(`${adminUrl}/api/configurations`, 'POST', {
  name: 'Mail.ru check',
});
const token = JSON.parse(createdConfig.text).token;
const configId = JSON.parse(createdConfig.text).id;
if (createdConfig.status !== 201 || typeof token !== 'string' || leaked(createdConfig.text)) {
  fail('configuration create', `status ${String(createdConfig.status)}`);
}
const listed = await request(`${adminUrl}/api/configurations`);
if (listed.status === 200 && !listed.text.includes(token) && !leaked(listed.text)) {
  pass('configuration list', 'raw bearer is not returned again');
} else {
  fail('configuration list', 'raw bearer or fixture password came back from the list');
}

const assigned = await jsonRequest(`${adminUrl}/api/configurations/${configId}/accounts`, 'PUT', {
  accountIds: [inbox.id, disabledId],
});
if (assigned.status !== 200 || leaked(assigned.text) || assigned.text.includes(token)) {
  fail('assign accounts', `status ${String(assigned.status)}`);
}

const afterSetup = await state();
const smtpOpened = afterSetup.tlsSessions.some(
  (session) => session.host === 'smtp.mail.ru' && session.port === 465,
);
if (!smtpOpened) {
  pass('no smtp during setup', `sessions ${String(afterSetup.tlsSessions.length)}; smtp.mail.ru:465 absent`);
} else {
  fail('no smtp during setup', 'smtp.mail.ru:465 was opened');
}

await withClient(token, async (client) => {
  const tools = await client.listTools();
  const blob = JSON.stringify(tools);
  const names = tools.tools.map((tool) => tool.name);
  if (names.includes('mailru_list_messages') && !leaked(blob) && !blob.includes(token)) {
    pass('tools/list', 'mailru_list_messages is listed; fixture password and bearer absent');
  } else {
    fail('tools/list', 'missing tool or secret in the list');
  }

  const before = (await state()).tlsSessions.length;
  let foreignRejected = false;
  let disabledRejected = false;
  try {
    await client.callTool({
      name: 'mailru_list_messages',
      arguments: { account: foreignId, limit: 1 },
    });
  } catch (error) {
    foreignRejected = !leaked(errorMessage(error));
  }
  try {
    await client.callTool({
      name: 'mailru_list_messages',
      arguments: { account: disabledId, limit: 1 },
    });
  } catch (error) {
    disabledRejected = !leaked(errorMessage(error));
  }
  const after = (await state()).tlsSessions.length;
  if (foreignRejected && disabledRejected && after === before) {
    pass('foreign and disabled account', 'rejected; fake TLS session count stayed unchanged');
  } else {
    fail(
      'foreign and disabled account',
      `foreign=${String(foreignRejected)} disabled=${String(disabledRejected)} before=${String(before)} after=${String(after)}`,
    );
  }
});

if (process.exitCode === 1) {
  process.exit(1);
}
