import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it } from 'vitest';
import { MAILRU_LIST_MAX_LIMIT, mailruConnector } from '../../../src/connectors/mailru/index.js';
import type { EgressTransport } from '../../../src/connectors/native/egress.js';
import { buildConnectorRegistry } from '../../../src/connectors/registry.js';
import { createMcpApp } from '../../../src/http/createMcpApp.js';
import type { JsonObject } from '../../../src/store/codec.js';
import type { EncryptedStore } from '../../../src/store/store.js';
import { hashToken } from '../../../src/token/token.js';
import type { FakeImapMessage } from '../mail/fake-imap.js';
import { createMailruFakeEgressTransport } from './fake-egress.js';

const openServers: http.Server[] = [];

afterEach(async () => {
  while (openServers.length > 0) {
    const server = openServers.pop();
    if (!server) {
      continue;
    }
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
});

const FIXTURE_PASSWORD = 'mailru-tool-fixture-password-UNIQUE';
const FIXTURE_ADDRESS = 'user@mail.ru';
const BEARER = 'mailru-mcp-bearer-UNIQUE';
const ACCOUNT_ID = 'mailru-acc-1';

function createMemoryStore(initial: JsonObject = {}): EncryptedStore {
  let document: JsonObject = structuredClone(initial);
  return {
    read(): JsonObject {
      return structuredClone(document);
    },
    replace(next: JsonObject): Promise<void> {
      document = structuredClone(next);
      return Promise.resolve();
    },
  };
}

function mailruStore(): EncryptedStore {
  return createMemoryStore({
    accounts: [
      {
        id: ACCOUNT_ID,
        connector: 'mailru',
        label: 'Personal',
        enabled: true,
        values: { address: FIXTURE_ADDRESS, password: FIXTURE_PASSWORD },
      },
    ],
    configurations: [
      {
        id: 'cfg-1',
        name: 'Mail.ru Config',
        tokenHash: hashToken(BEARER),
        enabled: true,
        accountIds: [ACCOUNT_ID],
      },
    ],
  });
}

function manyMessages(count: number): FakeImapMessage[] {
  const messages: FakeImapMessage[] = [];
  for (let i = 1; i <= count; i += 1) {
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

async function withMailruMcpClient<T>(
  messages: FakeImapMessage[],
  run: (client: Client, transport: EgressTransport & { tlsSessionCallCount: number }) => Promise<T>,
): Promise<T> {
  const registry = buildConnectorRegistry([mailruConnector]);
  const store = mailruStore();
  const egressTransport = createMailruFakeEgressTransport({
    imap: {
      user: FIXTURE_ADDRESS,
      password: FIXTURE_PASSWORD,
      messages,
    },
    smtp: { user: FIXTURE_ADDRESS, password: FIXTURE_PASSWORD },
  });

  const app = createMcpApp({ store, connectorRegistry: registry, egressTransport });
  const server = http.createServer(app);
  openServers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
    server.once('error', reject);
  });
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${String(address.port)}`;

  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: {
      headers: { Authorization: `Bearer ${BEARER}` },
    },
  });
  const client = new Client({ name: 'mailru-tools-test', version: '0.0.0' });
  await client.connect(transport);
  try {
    return await run(client, egressTransport);
  } finally {
    await client.close();
  }
}

function toolText(result: unknown): string {
  const record = result as { content?: Array<{ type?: string; text?: string }> };
  return record.content?.map((part) => part.text ?? '').join('\n') ?? JSON.stringify(result);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

describe('connector-mail-ru: Mail.ru list_messages tool', () => {
  it('List returns capped summaries without bodies on a fake IMAP server', async () => {
    const messages = manyMessages(MAILRU_LIST_MAX_LIMIT + 10);
    await withMailruMcpClient(messages, async (client) => {
      const result = await client.callTool({
        name: 'mailru_list_messages',
        arguments: { account: ACCOUNT_ID, limit: MAILRU_LIST_MAX_LIMIT + 5 },
      });
      const text = toolText(result);
      expect(text).not.toContain(FIXTURE_PASSWORD);
      const parsed = JSON.parse(text) as Array<Record<string, unknown>>;
      expect(parsed.length).toBeLessThanOrEqual(MAILRU_LIST_MAX_LIMIT);
      expect(parsed.length).toBeGreaterThan(0);
      for (const summary of parsed) {
        expect(summary).toEqual(
          expect.objectContaining({
            uid: expect.any(Number) as number,
            from: expect.any(String) as string,
            subject: expect.any(String) as string,
            date: expect.any(String) as string,
            seen: expect.any(Boolean) as boolean,
            unread: expect.any(Boolean) as boolean,
          }),
        );
        expect(summary).not.toHaveProperty('textBody');
        expect(summary).not.toHaveProperty('body');
      }
    });
  });
});

describe('connector-mail-ru: Mail.ru search_messages tool', () => {
  it('Narrow filter search returns matching summaries on a fake IMAP server', async () => {
    const messages = manyMessages(6);
    await withMailruMcpClient(messages, async (client) => {
      const result = await client.callTool({
        name: 'mailru_search_messages',
        arguments: {
          account: ACCOUNT_ID,
          filter: { from: 'alice@example.test' },
        },
      });
      const text = toolText(result);
      expect(text).not.toContain(FIXTURE_PASSWORD);
      const parsed = JSON.parse(text) as Array<Record<string, unknown>>;
      expect(parsed.length).toBeGreaterThan(0);
      for (const summary of parsed) {
        expect(String(summary.from)).toContain('alice@example.test');
        expect(summary).toEqual(
          expect.objectContaining({
            uid: expect.any(Number) as number,
            from: expect.any(String) as string,
            subject: expect.any(String) as string,
            date: expect.any(String) as string,
            seen: expect.any(Boolean) as boolean,
            unread: expect.any(Boolean) as boolean,
          }),
        );
        expect(summary).not.toHaveProperty('textBody');
        expect(summary).not.toHaveProperty('body');
      }
    });
  });

  it('Free-form IMAP search syntax is rejected', async () => {
    const messages = manyMessages(2);
    await withMailruMcpClient(messages, async (client, egress) => {
      const before = egress.tlsSessionCallCount;
      try {
        await client.callTool({
          name: 'mailru_search_messages',
          arguments: {
            account: ACCOUNT_ID,
            filter: 'OR FROM alice SUBJECT secret',
          },
        });
        expect.fail('expected callTool to throw');
      } catch (error) {
        expect(errorMessage(error)).not.toContain(FIXTURE_PASSWORD);
      }
      expect(egress.tlsSessionCallCount).toBe(before);

      try {
        await client.callTool({
          name: 'mailru_search_messages',
          arguments: {
            account: ACCOUNT_ID,
            filter: { raw: 'BEFORE 1-Jan-2020' },
          },
        });
        expect.fail('expected callTool to throw');
      } catch (error) {
        expect(errorMessage(error)).not.toContain(FIXTURE_PASSWORD);
      }
      expect(egress.tlsSessionCallCount).toBe(before);
    });
  });
});

describe('connector-mail-ru: Mail.ru read_message tool', () => {
  it('Read returns headers and text body without attachment bytes', async () => {
    const attachmentBytes = 'ATTACHMENT-BYTES-MUST-NOT-LEAK';
    const messages: FakeImapMessage[] = [
      {
        uid: 42,
        from: 'alice@example.test',
        to: FIXTURE_ADDRESS,
        subject: 'With attachment',
        date: 'Mon, 1 Jan 2024 00:00:00 +0000',
        seen: true,
        textBody: 'Readable text body',
        attachmentName: 'file.bin',
        attachmentBytes,
      },
    ];
    await withMailruMcpClient(messages, async (client) => {
      const result = await client.callTool({
        name: 'mailru_read_message',
        arguments: { account: ACCOUNT_ID, uid: 42 },
      });
      const text = toolText(result);
      expect(text).not.toContain(FIXTURE_PASSWORD);
      expect(text).not.toContain(attachmentBytes);
      const parsed = JSON.parse(text) as Record<string, unknown>;
      expect(parsed).toEqual(
        expect.objectContaining({
          from: 'alice@example.test',
          to: FIXTURE_ADDRESS,
          subject: 'With attachment',
          date: 'Mon, 1 Jan 2024 00:00:00 +0000',
          textBody: 'Readable text body',
        }),
      );
    });
  });
});

describe('connector-mail-ru: Password never appears in Mail.ru tool or admin surfaces', () => {
  it('Fixture password absent from tool result and MCP error', async () => {
    const messages = manyMessages(3);
    await withMailruMcpClient(messages, async (client) => {
      const ok = await client.callTool({
        name: 'mailru_list_messages',
        arguments: { account: ACCOUNT_ID, limit: 2 },
      });
      expect(toolText(ok)).not.toContain(FIXTURE_PASSWORD);
    });

    const registry = buildConnectorRegistry([
      {
        ...mailruConnector,
        tools: mailruConnector.tools.map((tool) =>
          tool.name === 'list_messages'
            ? {
                ...tool,
                handler: () => {
                  throw new Error(`provider boom ${FIXTURE_PASSWORD}`);
                },
              }
            : tool,
        ),
      },
    ]);
    const store = mailruStore();
    const egressTransport = createMailruFakeEgressTransport({
      imap: { user: FIXTURE_ADDRESS, password: FIXTURE_PASSWORD, messages },
      smtp: { user: FIXTURE_ADDRESS, password: FIXTURE_PASSWORD },
    });
    const app = createMcpApp({ store, connectorRegistry: registry, egressTransport });
    const server = http.createServer(app);
    openServers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => {
        resolve();
      });
      server.once('error', reject);
    });
    const address = server.address() as AddressInfo;
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${String(address.port)}/mcp`),
      {
        requestInit: { headers: { Authorization: `Bearer ${BEARER}` } },
      },
    );
    const client = new Client({ name: 'mailru-scrub-test', version: '0.0.0' });
    await client.connect(transport);
    try {
      await client.callTool({
        name: 'mailru_list_messages',
        arguments: { account: ACCOUNT_ID },
      });
      expect.fail('expected callTool to throw');
    } catch (error) {
      expect(errorMessage(error)).not.toContain(FIXTURE_PASSWORD);
    } finally {
      await client.close();
    }
  });
});
