/**
 * Throwaway admin and MCP listeners for account-tool-access e2e.
 * Registry is the fake native connector only. It does not contact a live host.
 * Run from the repo root:
 *   node node_modules/vite-node/vite-node.mjs openspec/changes/account-tool-access/e2e/harness.mjs
 */
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildConnectorRegistry } from '../../../../server/src/connectors/registry.js';
import { createAdminApp } from '../../../../server/src/http/createAdminApp.js';
import { createMcpApp } from '../../../../server/src/http/createMcpApp.js';

const callsFile = path.join(mkdtempSync(path.join(tmpdir(), 'account-tool-access-e2e-')), 'calls.json');
const calls = { keep: 0, drop: 0 };

function noteCall(name) {
  calls[name] += 1;
  writeFileSync(callsFile, JSON.stringify(calls));
}

writeFileSync(callsFile, JSON.stringify(calls));

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
  tools: [
    {
      name: 'keep',
      description: 'Keep a row',
      inputSchema: {
        type: 'object',
        properties: { message: { type: 'string' } },
        required: ['message'],
      },
      handler: () => {
        noteCall('keep');
        return { content: [{ type: 'text', text: 'ok' }] };
      },
    },
    {
      name: 'drop',
      description: 'Drop a row',
      inputSchema: {
        type: 'object',
        properties: { message: { type: 'string' } },
        required: ['message'],
      },
      handler: () => {
        noteCall('drop');
        return { content: [{ type: 'text', text: 'ok' }] };
      },
    },
  ],
};

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
const registry = buildConnectorRegistry([fake]);
const adminApp = createAdminApp({ store, connectorRegistry: registry });
const mcpApp = createMcpApp({ store, connectorRegistry: registry });

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
console.log(`CALLS_FILE=${callsFile}`);
console.log('READY');
