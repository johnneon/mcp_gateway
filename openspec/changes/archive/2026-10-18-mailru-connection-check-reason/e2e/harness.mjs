/**
 * Throwaway admin and MCP listeners for mailru-connection-check-reason e2e.
 * Fake IMAP speaks LOGIN. Fake SMTP would reject AUTH and must not be opened.
 * Does not contact a live Mail.ru host.
 * Run from the repo root:
 *   node node_modules/vite-node/vite-node.mjs openspec/changes/mailru-connection-check-reason/e2e/harness.mjs
 */
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { productionConnectorRegistry } from '../../../../server/src/connectors/registry.js';
import { createAdminApp } from '../../../../server/src/http/createAdminApp.js';
import { createMcpApp } from '../../../../server/src/http/createMcpApp.js';
import { createMailruFakeEgressTransport } from '../../../../server/test/connectors/mailru/fake-egress.js';

const FIXTURE_PASSWORD = 'mailru-e2e-fixture-app-password-UNIQUE';
const NEXT_PASSWORD = 'mailru-e2e-fixture-app-password-NEXT';
const FIXTURE_ADDRESS = 'user@mail.ru';

const imap = {
  user: FIXTURE_ADDRESS,
  password: FIXTURE_PASSWORD,
  acceptLogin: true,
};

const egressTransport = createMailruFakeEgressTransport({
  imap,
  smtp: { user: FIXTURE_ADDRESS, password: FIXTURE_PASSWORD, acceptAuth: false },
});

const sessionsFile = path.join(
  mkdtempSync(path.join(tmpdir(), 'mailru-check-reason-e2e-')),
  'sessions.json',
);

function writeSessions() {
  writeFileSync(sessionsFile, JSON.stringify(egressTransport.tlsSessions));
}

const innerTls = egressTransport.tlsSession.bind(egressTransport);
egressTransport.tlsSession = (params) => {
  const result = innerTls(params);
  return Promise.resolve(result).finally(() => {
    writeSessions();
  });
};
writeSessions();

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

const store = createMemoryStore({});
const adminApp = createAdminApp({
  store,
  connectorRegistry: productionConnectorRegistry,
  egressTransport,
});
const mcpApp = createMcpApp({
  store,
  connectorRegistry: productionConnectorRegistry,
  egressTransport,
});

function listen(handler) {
  return new Promise((resolve, reject) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr === null || typeof addr === 'string') {
        reject(new Error('no address'));
        return;
      }
      resolve({ server, port: addr.port });
    });
    server.on('error', reject);
  });
}

function accountFlags() {
  const accounts = store.read().accounts;
  const rows = Array.isArray(accounts) ? accounts : [];
  return rows.map((row) => {
    const values =
      row !== null && typeof row === 'object' && 'values' in row ? row.values : undefined;
    const password =
      values !== null && typeof values === 'object' && 'password' in values
        ? values.password
        : undefined;
    return {
      id: row.id,
      label: row.label,
      connector: row.connector,
      enabled: row.enabled,
      address: values !== null && typeof values === 'object' ? values.address : undefined,
      hasFixturePassword: password === FIXTURE_PASSWORD,
      hasNextPassword: password === NEXT_PASSWORD,
    };
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => {
      chunks.push(chunk);
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

const control = await listen(async (req, res) => {
  const url = req.url ?? '/';
  if (req.method === 'GET' && url === '/state') {
    const body = JSON.stringify({
      tlsSessions: egressTransport.tlsSessions,
      accounts: accountFlags(),
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(body);
    return;
  }
  if (req.method === 'POST' && url === '/imap') {
    const raw = await readBody(req);
    const parsed = JSON.parse(raw);
    if (typeof parsed.acceptLogin === 'boolean') {
      imap.acceptLogin = parsed.acceptLogin;
    }
    if (typeof parsed.password === 'string') {
      imap.password = parsed.password;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        acceptLogin: imap.acceptLogin,
        passwordIsFixture: imap.password === FIXTURE_PASSWORD,
        passwordIsNext: imap.password === NEXT_PASSWORD,
      }),
    );
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

const admin = await listen(adminApp);
const mcp = await listen(mcpApp);

console.log(`ADMIN_URL=http://127.0.0.1:${String(admin.port)}/`);
console.log(`MCP_URL=http://127.0.0.1:${String(mcp.port)}`);
console.log(`CONTROL_URL=http://127.0.0.1:${String(control.port)}`);
console.log(`SESSIONS_FILE=${sessionsFile}`);
console.log('READY');
