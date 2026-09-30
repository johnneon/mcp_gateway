/**
 * Throwaway admin listener for connector-mail-ru e2e.
 * Uses the change's fake IMAP/SMTP egress. Does not contact live Mail.ru.
 * Run from the repo root:
 *   node node_modules/vite-node/vite-node.mjs openspec/changes/connector-mail-ru/e2e/harness.mjs
 */
import { createServer } from 'node:http';
import { productionConnectorRegistry } from '../../../../server/src/connectors/registry.js';
import { createAdminApp } from '../../../../server/src/http/createAdminApp.js';
import { createMailruFakeEgressTransport } from '../../../../server/test/connectors/mailru/fake-egress.js';
const FIXTURE_PASSWORD = 'mailru-e2e-fixture-app-password-UNIQUE';
const FIXTURE_ADDRESS = 'user@mail.ru';
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
const imapAccept = process.env.IMAP_ACCEPT !== '0';
const smtpAccept = process.env.SMTP_ACCEPT !== '0';
const egressTransport = createMailruFakeEgressTransport({
    imap: {
        user: FIXTURE_ADDRESS,
        password: FIXTURE_PASSWORD,
        acceptLogin: imapAccept,
    },
    smtp: {
        user: FIXTURE_ADDRESS,
        password: FIXTURE_PASSWORD,
        acceptAuth: smtpAccept,
    },
});
const adminApp = createAdminApp({
    store: createMemoryStore({}),
    connectorRegistry: productionConnectorRegistry,
    egressTransport,
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
console.log(`IMAP_ACCEPT=${imapAccept ? '1' : '0'}`);
console.log(`SMTP_ACCEPT=${smtpAccept ? '1' : '0'}`);
console.log('READY');
