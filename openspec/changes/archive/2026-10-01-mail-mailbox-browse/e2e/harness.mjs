/**
 * Throwaway admin listener for mail-mailbox-browse e2e.
 * Uses the change's fake IMAP/SMTP egress. Does not contact live Gmail or Mail.ru.
 * Run from the repo root:
 *   node node_modules/vite-node/vite-node.mjs openspec/changes/mail-mailbox-browse/e2e/harness.mjs
 */
import { createServer } from 'node:http';
import { productionConnectorRegistry } from '../../../../server/src/connectors/registry.js';
import { createAdminApp } from '../../../../server/src/http/createAdminApp.js';
import { createGmailFakeEgressTransport } from '../../../../server/test/connectors/gmail/fake-egress.js';
import { createMailruFakeEgressTransport } from '../../../../server/test/connectors/mailru/fake-egress.js';

const FIXTURE_PASSWORD = 'mailbox-e2e-fixture-password-UNIQUE';
const GMAIL_ADDRESS = 'user@gmail.com';
const MAILRU_ADDRESS = 'user@mail.ru';

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

function combineEgress(gmail, mailru) {
  return {
    httpsRequest() {
      return Promise.reject(new Error('https not used in mailbox browse e2e'));
    },
    tlsConnect() {
      return Promise.reject(new Error('tlsConnect not used in mailbox browse e2e'));
    },
    tlsSession(params) {
      if (params.host === 'imap.gmail.com' || params.host === 'smtp.gmail.com') {
        return gmail.tlsSession(params);
      }
      if (params.host === 'imap.mail.ru' || params.host === 'smtp.mail.ru') {
        return mailru.tlsSession(params);
      }
      return Promise.reject(new Error(`unexpected host ${params.host}`));
    },
  };
}

const gmailEgress = createGmailFakeEgressTransport({
  imap: {
    user: GMAIL_ADDRESS,
    password: FIXTURE_PASSWORD,
    messages: [
      {
        uid: 1,
        from: 'alice@example.test',
        to: 'me@example.test',
        subject: 'Inbox note',
        date: '01 Jan 2024 00:00:00 +0000',
        seen: true,
        textBody: 'hello',
      },
    ],
  },
  smtp: { user: GMAIL_ADDRESS, password: FIXTURE_PASSWORD },
});
const mailruEgress = createMailruFakeEgressTransport({
  imap: {
    user: MAILRU_ADDRESS,
    password: FIXTURE_PASSWORD,
    messages: [
      {
        uid: 1,
        from: 'alice@example.test',
        to: 'me@example.test',
        subject: 'Inbox note',
        date: '01 Jan 2024 00:00:00 +0000',
        seen: true,
        textBody: 'hello',
      },
    ],
  },
  smtp: { user: MAILRU_ADDRESS, password: FIXTURE_PASSWORD },
});

const adminApp = createAdminApp({
  store: createMemoryStore({
    accounts: [
      {
        id: 'gmail-e2e-1',
        connector: 'gmail',
        label: 'Gmail inbox',
        enabled: true,
        values: { address: GMAIL_ADDRESS, password: FIXTURE_PASSWORD },
      },
      {
        id: 'mailru-e2e-1',
        connector: 'mailru',
        label: 'Mail.ru inbox',
        enabled: true,
        values: { address: MAILRU_ADDRESS, password: FIXTURE_PASSWORD },
      },
    ],
    configurations: [],
  }),
  connectorRegistry: productionConnectorRegistry,
  egressTransport: combineEgress(gmailEgress, mailruEgress),
});

const server = createServer(adminApp);
await new Promise((resolve, reject) => {
  server.listen(0, '127.0.0.1', () => {
    resolve();
  });
  server.once('error', reject);
});
const address = server.address();
console.log(`ADMIN_URL=http://127.0.0.1:${String(address.port)}/`);
console.log('READY');
