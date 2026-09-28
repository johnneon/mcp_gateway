/**
 * Throwaway MCP smoke for accounts-ui verify. Creates its own configuration,
 * never prints the bearer, exits 0 on pass.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const ADMIN = process.env.ADMIN_BASE ?? 'http://127.0.0.1:3872';
const MCP = process.env.MCP_BASE ?? 'http://127.0.0.1:3871';

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

async function main() {
  const createRes = await fetch(`${ADMIN}/api/configurations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'MCP Smoke' }),
  });
  if (!createRes.ok) {
    fail(`create configuration HTTP ${createRes.status}`);
  }
  const created = await createRes.json();
  const token = created.token;
  if (typeof token !== 'string' || token.length === 0) {
    fail('create response missing token');
  }
  if ('tokenHash' in created) {
    fail('create response leaked tokenHash');
  }

  const listRes = await fetch(`${ADMIN}/api/configurations`);
  const list = await listRes.json();
  const listText = JSON.stringify(list);
  if (listText.includes(token)) {
    fail('list JSON contains plaintext token');
  }
  for (const row of list) {
    if (!Array.isArray(row.accountIds)) {
      fail('list row missing accountIds');
    }
  }

  const accountsRes = await fetch(`${ADMIN}/api/accounts`);
  const accounts = await accountsRes.json();
  if (!Array.isArray(accounts) || accounts.length !== 0) {
    fail(`expected empty accounts, got ${JSON.stringify(accounts)}`);
  }

  async function mcpReject(authHeader, label) {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    if (authHeader !== undefined) {
      headers.Authorization = authHeader;
    }
    const res = await fetch(`${MCP}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'accounts-ui-e2e', version: '0.0.0' },
        },
      }),
    });
    if (res.status === 200) {
      fail(`${label}: expected rejection, got 200`);
    }
    const body = await res.text();
    if (body.includes(token)) {
      fail(`${label}: response body contains token`);
    }
    return res.status;
  }

  const emptyStatus = await mcpReject('Bearer ', 'empty bearer');
  const unknownStatus = await mcpReject('Bearer unknown-token-xyz', 'unknown bearer');
  const missingStatus = await mcpReject(undefined, 'missing bearer');
  if (emptyStatus !== unknownStatus) {
    fail(`empty (${emptyStatus}) and unknown (${unknownStatus}) bearer status differ`);
  }
  if (missingStatus !== emptyStatus) {
    console.error(`note: missing bearer status ${missingStatus}, empty ${emptyStatus}`);
  }

  const transport = new StreamableHTTPClientTransport(new URL(`${MCP}/mcp`), {
    requestInit: {
      headers: { Authorization: `Bearer ${token}` },
    },
  });
  const client = new Client({ name: 'accounts-ui-e2e', version: '0.0.0' });
  await client.connect(transport);
  const listed = await client.listTools();
  if (!Array.isArray(listed.tools)) {
    fail('tools/list missing tools array');
  }
  if (listed.tools.length !== 0) {
    fail(`expected empty tools with empty registry, got ${listed.tools.length}`);
  }
  const listedJson = JSON.stringify(listed);
  if (listedJson.includes(token)) {
    fail('tools/list JSON contains token');
  }
  await client.close();

  const mcpAdmin = await fetch(`${MCP}/api/configurations`);
  if (mcpAdmin.status !== 404) {
    fail(`MCP port served /api/configurations with ${mcpAdmin.status}`);
  }
  const adminMcp = await fetch(`${ADMIN}/mcp`);
  if (adminMcp.status !== 404) {
    fail(`admin port served /mcp with ${adminMcp.status}`);
  }

  console.log('PASS: mcp smoke (token never printed)');
  console.log(`empty/unknown bearer status: ${emptyStatus}`);
  console.log(`tools count: ${listed.tools.length}`);
  console.log(`configurations with accountIds: ${list.length}`);
}

main().catch((err) => {
  console.error('FAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
