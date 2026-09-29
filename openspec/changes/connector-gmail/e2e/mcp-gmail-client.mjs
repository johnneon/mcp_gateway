/**
 * Throwaway MCP e2e client for connector-gmail.
 * Uses fake IMAP/SMTP egress only; does not call live Gmail.
 * Run from repo root after npm run build:
 *   node openspec/changes/connector-gmail/e2e/mcp-gmail-client.mjs
 */
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { productionConnectorRegistry } from '../../../../server/dist/connectors/registry.js';
import { createMcpApp } from '../../../../server/dist/http/createMcpApp.js';
import { createAdminApp } from '../../../../server/dist/http/createAdminApp.js';
import { hashToken } from '../../../../server/dist/token/token.js';
import { createGmailFakeEgressTransport } from './fake-mail.mjs';

const FIXTURE_PASSWORD = 'gmail-e2e-fixture-app-password-UNIQUE';
const FIXTURE_ADDRESS = 'user@gmail.com';
const BEARER = 'gmail-e2e-bearer-UNIQUE';
const UNKNOWN_BEARER = 'unknown-bearer-UNIQUE';
const ACCOUNT_ID = 'gmail-e2e-acc-1';
const ATTACHMENT_BYTES = 'ATTACHMENT-BYTES-MUST-NOT-LEAK';

const results = [];

function pass(name, detail) {
  results.push({ name, ok: true, detail });
  console.log(`PASS ${name} — ${detail}`);
}

function fail(name, detail) {
  results.push({ name, ok: false, detail });
  console.error(`FAIL ${name} — ${detail}`);
}

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

function manyMessages(count) {
  const messages = [];
  for (let i = 1; i <= count; i += 1) {
    if (i === 42) {
      messages.push({
        uid: 42,
        from: 'alice@example.test',
        to: FIXTURE_ADDRESS,
        subject: 'With attachment',
        date: 'Mon, 1 Jan 2024 00:00:00 +0000',
        seen: true,
        textBody: 'Readable text body',
        attachmentName: 'file.bin',
        attachmentBytes: ATTACHMENT_BYTES,
      });
      continue;
    }
    messages.push({
      uid: i,
      from: i % 2 === 0 ? 'alice@example.test' : 'bob@example.test',
      to: FIXTURE_ADDRESS,
      subject: `Subject ${String(i)}`,
      date: 'Mon, 1 Jan 2024 00:00:00 +0000',
      seen: i % 3 === 0,
      textBody: `Body ${String(i)}`,
    });
  }
  return messages;
}

function gmailStore() {
  return createMemoryStore({
    accounts: [
      {
        id: ACCOUNT_ID,
        connector: 'gmail',
        label: 'Personal',
        enabled: true,
        values: { address: FIXTURE_ADDRESS, password: FIXTURE_PASSWORD },
      },
    ],
    configurations: [
      {
        id: 'cfg-1',
        name: 'Gmail Config',
        tokenHash: hashToken(BEARER),
        enabled: true,
        accountIds: [ACCOUNT_ID],
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
  return { server, baseUrl: `http://127.0.0.1:${port}`, port };
}

async function withClient(baseUrl, token, run) {
  const headers = {};
  if (token !== undefined) {
    headers.Authorization = `Bearer ${token}`;
  }
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers },
  });
  const client = new Client({ name: 'e2e-connector-gmail', version: '0.0.0' });
  await client.connect(transport);
  try {
    return await run(client);
  } finally {
    await client.close();
  }
}

function toolText(result) {
  const record = result;
  return record.content?.map((part) => part.text ?? '').join('\n') ?? JSON.stringify(result);
}

function errorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function unauthorizedBody(baseUrl, authHeader) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  if (authHeader !== undefined) headers.Authorization = authHeader;
  const response = await fetch(`${baseUrl}/mcp`, {
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
  return { status: response.status, text: await response.text() };
}

const messages = manyMessages(60);
const egressTransport = createGmailFakeEgressTransport({
  imap: {
    user: FIXTURE_ADDRESS,
    password: FIXTURE_PASSWORD,
    messages,
  },
  smtp: { user: FIXTURE_ADDRESS, password: FIXTURE_PASSWORD },
});

const store = gmailStore();
const registry = productionConnectorRegistry;
const mcpApp = createMcpApp({ store, connectorRegistry: registry, egressTransport });
const adminApp = createAdminApp({ store, connectorRegistry: registry, egressTransport });

const mcp = await listen(mcpApp);
const admin = await listen(adminApp);

try {
  // Port separation
  {
    const adminMcp = await fetch(`${admin.baseUrl}/mcp`, { method: 'POST' });
    const mcpApi = await fetch(`${mcp.baseUrl}/api/connectors`);
    if (adminMcp.status === 404 && mcpApi.status === 404) {
      pass('port separation', 'admin /mcp 404; MCP /api/connectors 404');
    } else {
      fail(
        'port separation',
        `admin /mcp ${adminMcp.status}; MCP /api ${mcpApi.status}`,
      );
    }
  }

  // Empty vs unknown bearer
  {
    const empty = await unauthorizedBody(mcp.baseUrl, undefined);
    const unknown = await unauthorizedBody(mcp.baseUrl, `Bearer ${UNKNOWN_BEARER}`);
    if (
      empty.status === 401 &&
      unknown.status === 401 &&
      empty.text === unknown.text &&
      !empty.text.includes(FIXTURE_PASSWORD) &&
      !empty.text.includes(BEARER)
    ) {
      pass('bearer rejection', 'empty and unknown bearer identical 401 Unauthorized');
    } else {
      fail(
        'bearer rejection',
        `empty=${empty.status} unknown=${unknown.status} bodiesEqual=${empty.text === unknown.text}`,
      );
    }
  }

  // tools/list
  await withClient(mcp.baseUrl, BEARER, async (client) => {
    const listed = await client.listTools();
    const names = listed.tools.map((t) => t.name);
    const required = ['gmail_list_messages', 'gmail_search_messages', 'gmail_read_message'];
    const missing = required.filter((n) => !names.includes(n));
    const blob = JSON.stringify(listed);
    if (missing.length === 0 && !blob.includes(FIXTURE_PASSWORD)) {
      pass('tools/list', `lists ${required.join(', ')}; password absent`);
    } else {
      fail('tools/list', `missing=${missing.join(',')} leak=${blob.includes(FIXTURE_PASSWORD)}`);
    }
  });

  // list_messages capped
  await withClient(mcp.baseUrl, BEARER, async (client) => {
    const result = await client.callTool({
      name: 'gmail_list_messages',
      arguments: { account: ACCOUNT_ID, limit: 100 },
    });
    const text = toolText(result);
    const parsed = JSON.parse(text);
    const ok =
      Array.isArray(parsed) &&
      parsed.length <= 50 &&
      parsed.length > 0 &&
      !text.includes(FIXTURE_PASSWORD) &&
      parsed.every(
        (s) =>
          typeof s.uid === 'number' &&
          typeof s.from === 'string' &&
          typeof s.subject === 'string' &&
          typeof s.date === 'string' &&
          typeof s.seen === 'boolean' &&
          typeof s.unread === 'boolean' &&
          !('textBody' in s) &&
          !('body' in s),
      );
    if (ok) {
      pass('gmail_list_messages', `returned ${parsed.length} capped summaries without bodies`);
    } else {
      fail('gmail_list_messages', `len=${parsed?.length} textHasSecret=${text.includes(FIXTURE_PASSWORD)}`);
    }
  });

  // search narrow filter
  await withClient(mcp.baseUrl, BEARER, async (client) => {
    const result = await client.callTool({
      name: 'gmail_search_messages',
      arguments: { account: ACCOUNT_ID, filter: { from: 'alice@example.test' } },
    });
    const text = toolText(result);
    const parsed = JSON.parse(text);
    const ok =
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every((s) => String(s.from).includes('alice@example.test')) &&
      !text.includes(FIXTURE_PASSWORD);
    if (ok) {
      pass('gmail_search_messages filter', `matched ${parsed.length} alice summaries`);
    } else {
      fail('gmail_search_messages filter', text.slice(0, 200));
    }
  });

  // free-form rejected
  await withClient(mcp.baseUrl, BEARER, async (client) => {
    const before = egressTransport.tlsSessionCallCount;
    let rejected = false;
    try {
      await client.callTool({
        name: 'gmail_search_messages',
        arguments: { account: ACCOUNT_ID, filter: 'OR FROM alice SUBJECT secret' },
      });
    } catch (error) {
      rejected = !errorMessage(error).includes(FIXTURE_PASSWORD);
    }
    const noSession = egressTransport.tlsSessionCallCount === before;
    if (rejected && noSession) {
      pass('gmail_search_messages free-form', 'rejected without IMAP session; password absent');
    } else {
      fail(
        'gmail_search_messages free-form',
        `rejected=${rejected} noSession=${noSession} calls=${egressTransport.tlsSessionCallCount - before}`,
      );
    }
  });

  // read_message
  await withClient(mcp.baseUrl, BEARER, async (client) => {
    const result = await client.callTool({
      name: 'gmail_read_message',
      arguments: { account: ACCOUNT_ID, uid: 42 },
    });
    const text = toolText(result);
    const parsed = JSON.parse(text);
    const ok =
      parsed.from === 'alice@example.test' &&
      parsed.to === FIXTURE_ADDRESS &&
      parsed.subject === 'With attachment' &&
      parsed.textBody === 'Readable text body' &&
      !text.includes(FIXTURE_PASSWORD) &&
      !text.includes(ATTACHMENT_BYTES);
    if (ok) {
      pass('gmail_read_message', 'headers and text body; no attachment bytes; password absent');
    } else {
      fail('gmail_read_message', text.slice(0, 300));
    }
  });

  // Admin create success via API (connection check path)
  {
    const emptyStore = createMemoryStore({});
    const okTransport = createGmailFakeEgressTransport({
      imap: { user: FIXTURE_ADDRESS, password: FIXTURE_PASSWORD, acceptLogin: true },
      smtp: { user: FIXTURE_ADDRESS, password: FIXTURE_PASSWORD, acceptAuth: true },
    });
    const app = createAdminApp({
      store: emptyStore,
      connectorRegistry: registry,
      egressTransport: okTransport,
    });
    const { server, baseUrl } = await listen(app);
    try {
      const response = await fetch(`${baseUrl}/api/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connector: 'gmail',
          label: 'Inbox',
          values: { address: FIXTURE_ADDRESS, password: FIXTURE_PASSWORD },
        }),
      });
      const text = await response.text();
      if (response.status === 201 && !text.includes(FIXTURE_PASSWORD)) {
        pass('admin create success', '201; fixture password absent from body');
      } else {
        fail('admin create success', `${response.status} ${text.slice(0, 200)}`);
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  // Admin create IMAP fail
  {
    const emptyStore = createMemoryStore({});
    const failTransport = createGmailFakeEgressTransport({
      imap: { user: FIXTURE_ADDRESS, password: FIXTURE_PASSWORD, acceptLogin: false },
      smtp: { user: FIXTURE_ADDRESS, password: FIXTURE_PASSWORD, acceptAuth: true },
    });
    const app = createAdminApp({
      store: emptyStore,
      connectorRegistry: registry,
      egressTransport: failTransport,
    });
    const { server, baseUrl } = await listen(app);
    try {
      const response = await fetch(`${baseUrl}/api/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connector: 'gmail',
          label: 'Inbox',
          values: { address: FIXTURE_ADDRESS, password: FIXTURE_PASSWORD },
        }),
      });
      const text = await response.text();
      const accounts = emptyStore.read().accounts ?? [];
      if (
        response.status === 400 &&
        text === 'Connection check failed' &&
        !text.includes(FIXTURE_PASSWORD) &&
        accounts.length === 0
      ) {
        pass('admin create IMAP reject', '400 Connection check failed; not saved; no password');
      } else {
        fail('admin create IMAP reject', `${response.status} ${text}`);
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  // Admin create SMTP fail
  {
    const emptyStore = createMemoryStore({});
    const failTransport = createGmailFakeEgressTransport({
      imap: { user: FIXTURE_ADDRESS, password: FIXTURE_PASSWORD, acceptLogin: true },
      smtp: { user: FIXTURE_ADDRESS, password: FIXTURE_PASSWORD, acceptAuth: false },
    });
    const app = createAdminApp({
      store: emptyStore,
      connectorRegistry: registry,
      egressTransport: failTransport,
    });
    const { server, baseUrl } = await listen(app);
    try {
      const response = await fetch(`${baseUrl}/api/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connector: 'gmail',
          label: 'Inbox',
          values: { address: FIXTURE_ADDRESS, password: FIXTURE_PASSWORD },
        }),
      });
      const text = await response.text();
      const accounts = emptyStore.read().accounts ?? [];
      if (
        response.status === 400 &&
        text === 'Connection check failed' &&
        !text.includes(FIXTURE_PASSWORD) &&
        accounts.length === 0
      ) {
        pass('admin create SMTP reject', '400 Connection check failed; not saved; no password');
      } else {
        fail('admin create SMTP reject', `${response.status} ${text}`);
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  // Connectors list includes Gmail fields
  {
    const response = await fetch(`${admin.baseUrl}/api/connectors`);
    const json = await response.json();
    const gmail = json.find((c) => c.id === 'gmail');
    const ok =
      gmail?.name === 'Gmail' &&
      gmail?.kind === 'native' &&
      gmail.fields?.some((f) => f.name === 'address' && f.label === 'Address') &&
      gmail.fields?.some((f) => f.name === 'password' && f.label === 'App password');
    if (ok) {
      pass('connectors list Gmail', 'id gmail, fields Address and App password');
    } else {
      fail('connectors list Gmail', JSON.stringify(gmail));
    }
  }
} finally {
  await new Promise((resolve) => mcp.server.close(resolve));
  await new Promise((resolve) => admin.server.close(resolve));
}

const failed = results.filter((r) => !r.ok);
console.log(`SUMMARY passed=${results.length - failed.length} failed=${failed.length}`);
if (failed.length > 0) {
  process.exitCode = 1;
}
