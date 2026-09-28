/**
 * Throwaway admin+MCP listen with the fake native connector from accounts-api tests.
 * Does not modify production registry. Prints ADMIN_URL / MCP_URL / FIXTURE_SECRET marker only as length.
 */
import { createServer } from 'node:http';
import { buildConnectorRegistry } from '../../../../../server/dist/connectors/registry.js';
import { createAdminApp } from '../../../../../server/dist/http/createAdminApp.js';
import { createMcpApp } from '../../../../../server/dist/http/createMcpApp.js';

const FIXTURE_SECRET = 'fixture-secret-value';

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

const fake = {
  id: 'fake',
  name: 'Fake',
  kind: 'native',
  fields: [
    { name: 'user', label: 'User', type: 'text', required: true },
    { name: 'token', label: 'Token', type: 'secret', required: true },
  ],
  allowedDestinations: [{ host: 'imap.example.test', port: 993 }],
  checkConnection: (values) => {
    if (values.token === 'fail-check') {
      throw new Error('connector-exception-must-not-surface');
    }
  },
};

const store = createMemoryStore({});
const registry = buildConnectorRegistry([fake]);
const adminApp = createAdminApp({ store, connectorRegistry: registry });
const mcpApp = createMcpApp({ store });

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
console.log(`FIXTURE_SECRET_LEN=${FIXTURE_SECRET.length}`);
console.log('READY');
