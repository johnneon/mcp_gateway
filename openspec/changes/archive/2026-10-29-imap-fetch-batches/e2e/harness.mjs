/**
 * Throwaway admin and MCP listeners for imap-fetch-batches e2e.
 * Encrypted temp store, fake IMAP/SMTP only. Does not contact live Gmail or Mail.ru.
 * Run from the repo root:
 *   node node_modules/vite-node/vite-node.mjs openspec/changes/imap-fetch-batches/e2e/harness.mjs
 */
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { productionConnectorRegistry } from '../../../../server/src/connectors/registry.ts';
import { createAdminApp } from '../../../../server/src/http/createAdminApp.ts';
import { createMcpApp } from '../../../../server/src/http/createMcpApp.ts';
import { open } from '../../../../server/src/store/store.ts';
import { createGmailFakeEgressTransport } from '../../../../server/test/connectors/gmail/fake-egress.ts';
import { createMailruFakeEgressTransport } from '../../../../server/test/connectors/mailru/fake-egress.ts';

const GMAIL_ADDRESS = 'user@gmail.com';
const GMAIL_PASSWORD = 'gmail-tool-fixture-password-UNIQUE';
const MAILRU_ADDRESS = 'user@mail.ru';
const MAILRU_PASSWORD = 'mailru-tool-fixture-password-UNIQUE';

const ALLOWED_HOSTS = new Set([
  'imap.gmail.com:993',
  'smtp.gmail.com:465',
  'imap.mail.ru:993',
  'smtp.mail.ru:465',
]);

function guardEgress(egress) {
  const inner = egress.tlsSession.bind(egress);
  egress.tlsSession = (params) => {
    const target = `${params.host}:${String(params.port)}`;
    if (!ALLOWED_HOSTS.has(target)) {
      console.error(`UNEXPECTED_HOST ${target}`);
      return Promise.reject(new Error(`unexpected host ${target}`));
    }
    console.log(`TLS ${target}`);
    return inner(params);
  };
  return egress;
}

function combineEgress(gmail, mailru) {
  return {
    httpsRequest() {
      return Promise.reject(new Error('https not used in imap-fetch-batches e2e'));
    },
    tlsConnect() {
      return Promise.reject(new Error('tlsConnect not used in imap-fetch-batches e2e'));
    },
    tlsSession(params) {
      const target = `${params.host}:${String(params.port)}`;
      if (params.host === 'imap.gmail.com' || params.host === 'smtp.gmail.com') {
        return gmail.tlsSession(params);
      }
      if (params.host === 'imap.mail.ru' || params.host === 'smtp.mail.ru') {
        return mailru.tlsSession(params);
      }
      console.error(`UNEXPECTED_HOST ${target}`);
      return Promise.reject(new Error(`unexpected host ${target}`));
    },
  };
}

const gmailEgress = guardEgress(
  createGmailFakeEgressTransport({
    imap: { user: GMAIL_ADDRESS, password: GMAIL_PASSWORD, messages: [] },
    smtp: { user: GMAIL_ADDRESS, password: GMAIL_PASSWORD },
  }),
);
const mailruEgress = guardEgress(
  createMailruFakeEgressTransport({
    imap: { user: MAILRU_ADDRESS, password: MAILRU_PASSWORD, messages: [] },
    smtp: { user: MAILRU_ADDRESS, password: MAILRU_PASSWORD },
  }),
);

const dataDir = await mkdtemp(join(tmpdir(), 'imap-fetch-batches-e2e-'));
const store = await open(dataDir, randomBytes(32));
const egress = combineEgress(gmailEgress, mailruEgress);
const adminApp = createAdminApp({
  store,
  connectorRegistry: productionConnectorRegistry,
  egressTransport: egress,
});
const mcpApp = createMcpApp({
  store,
  connectorRegistry: productionConnectorRegistry,
  egressTransport: egress,
});

function listen(app) {
  const server = createServer(app);
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, port: address.port });
    });
    server.once('error', reject);
  });
}

const admin = await listen(adminApp);
const mcp = await listen(mcpApp);

console.log(`ADMIN_URL=http://127.0.0.1:${String(admin.port)}/`);
console.log(`MCP_URL=http://127.0.0.1:${String(mcp.port)}/`);
console.log('READY');

async function shutdown() {
  await new Promise((resolve) => {
    admin.server.close(() => {
      resolve();
    });
  });
  await new Promise((resolve) => {
    mcp.server.close(() => {
      resolve();
    });
  });
  await rm(dataDir, { recursive: true, force: true });
}

process.on('SIGINT', () => {
  void shutdown().then(() => {
    process.exit(0);
  });
});
process.on('SIGTERM', () => {
  void shutdown().then(() => {
    process.exit(0);
  });
});
