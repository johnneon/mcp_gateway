/**
 * Throwaway admin+MCP listen with production Gmail + fake IMAP/SMTP egress.
 * Does not contact live Gmail. Prints ADMIN_URL / MCP_URL / fixture markers.
 * Run from repo root after npm run build: node openspec/changes/connector-gmail/e2e/fake-gmail-harness.mjs
 */
import { createServer } from 'node:http';
import { productionConnectorRegistry } from '../../../../server/dist/connectors/registry.js';
import { createAdminApp } from '../../../../server/dist/http/createAdminApp.js';
import { createMcpApp } from '../../../../server/dist/http/createMcpApp.js';
import { hashToken } from '../../../../server/dist/token/token.js';
import { createGmailFakeEgressTransport } from './fake-mail.mjs';

export const FIXTURE_PASSWORD = 'gmail-e2e-fixture-app-password-UNIQUE';
export const FIXTURE_ADDRESS = 'user@gmail.com';
export const BEARER = 'gmail-e2e-bearer-UNIQUE';
export const ACCOUNT_ID = 'gmail-e2e-acc-1';

const mode = process.argv[1]?.includes('fake-gmail-harness') ? process.env.HARNESS_MODE ?? 'empty' : 'empty';

function createMemoryStore(initial = {}) {
  let document = structuredClone(initial);
  return {
    read() {
      return structuredClone(document);
    },
    async replace(next) {
      document = structuredClone(next);
    },
  };
}

function manyMessages(count) {
  const messages = [];
  for (let i = 1; i <= count; i += 1) {
    messages.push({
      uid: i,
      from: i % 2 === 0 ? 'alice@example.test' : 'bob@example.test',
      to: FIXTURE_ADDRESS,
      subject: `Subject ${String(i)}`,
      date: 'Mon, 1 Jan 2024 00:00:00 +0000',
      seen: i % 3 === 0,
      textBody: `Body ${String(i)}`,
      ...(i === 42
        ? {
            attachmentName: 'file.bin',
            attachmentBytes: 'ATTACHMENT-BYTES-MUST-NOT-LEAK',
          }
        : {}),
    });
  }
  return messages;
}

const imapAccept = process.env.IMAP_ACCEPT !== '0';
const smtpAccept = process.env.SMTP_ACCEPT !== '0';
const withSeededAccount = process.env.SEED_ACCOUNT === '1';

const messages = manyMessages(60);
if (!messages.some((m) => m.uid === 42)) {
  messages.push({
    uid: 42,
    from: 'alice@example.test',
    to: FIXTURE_ADDRESS,
    subject: 'With attachment',
    date: 'Mon, 1 Jan 2024 00:00:00 +0000',
    seen: true,
    textBody: 'Readable text body',
    attachmentName: 'file.bin',
    attachmentBytes: 'ATTACHMENT-BYTES-MUST-NOT-LEAK',
  });
}

const egressTransport = createGmailFakeEgressTransport({
  imap: {
    user: FIXTURE_ADDRESS,
    password: FIXTURE_PASSWORD,
    acceptLogin: imapAccept,
    messages,
  },
  smtp: {
    user: FIXTURE_ADDRESS,
    password: FIXTURE_PASSWORD,
    acceptAuth: smtpAccept,
  },
});

const store = createMemoryStore(
  withSeededAccount
    ? {
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
      }
    : {},
);

const registry = productionConnectorRegistry;
const adminApp = createAdminApp({
  store,
  connectorRegistry: registry,
  egressTransport,
});
const mcpApp = createMcpApp({
  store,
  connectorRegistry: registry,
  egressTransport,
});

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = createServer(app);
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

const admin = await listen(adminApp);
const mcp = await listen(mcpApp);

console.log(`ADMIN_URL=http://127.0.0.1:${admin.port}/`);
console.log(`MCP_URL=http://127.0.0.1:${mcp.port}`);
console.log(`FIXTURE_ADDRESS=${FIXTURE_ADDRESS}`);
console.log(`FIXTURE_PASSWORD_LEN=${FIXTURE_PASSWORD.length}`);
console.log(`BEARER_LEN=${BEARER.length}`);
console.log(`ACCOUNT_ID=${ACCOUNT_ID}`);
console.log(`IMAP_ACCEPT=${imapAccept ? '1' : '0'}`);
console.log(`SMTP_ACCEPT=${smtpAccept ? '1' : '0'}`);
console.log(`SEED_ACCOUNT=${withSeededAccount ? '1' : '0'}`);
console.log(`HARNESS_MODE=${mode}`);
console.log('READY');
