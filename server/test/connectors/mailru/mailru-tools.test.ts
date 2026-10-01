import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it } from 'vitest';
import { mailruConnector } from '../../../src/connectors/mailru/index.js';
import type { EgressTransport } from '../../../src/connectors/native/egress.js';
import { buildConnectorRegistry } from '../../../src/connectors/registry.js';
import { createMcpApp } from '../../../src/http/createMcpApp.js';
import type { JsonObject } from '../../../src/store/codec.js';
import type { EncryptedStore } from '../../../src/store/store.js';
import { hashToken } from '../../../src/token/token.js';
import type { FakeImapMessage, FakeImapOptions } from '../mail/fake-imap.js';
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

type MailruEgress = EgressTransport & {
  tlsSessionCallCount: number;
  searchCommandCount: number;
  messageFlags(mailboxName: string, uid: number): { seen: boolean; flagged: boolean } | undefined;
};

type MailruImapExtras = Partial<
  Pick<FakeImapOptions, 'mailboxes' | 'deleteNo' | 'moveNo' | 'copyNo' | 'storeNo' | 'attachmentNo'>
>;

function resolveImapExtras(
  extra?: FakeImapOptions['mailboxes'] | MailruImapExtras,
): MailruImapExtras {
  if (extra === undefined) {
    return {};
  }
  if (Array.isArray(extra)) {
    return { mailboxes: extra };
  }
  return extra;
}

async function withMailruMcpClient<T>(
  messages: FakeImapMessage[],
  run: (client: Client, transport: MailruEgress) => Promise<T>,
  extra?: FakeImapOptions['mailboxes'] | MailruImapExtras,
): Promise<T> {
  const registry = buildConnectorRegistry([mailruConnector]);
  const store = mailruStore();
  const egressTransport = createMailruFakeEgressTransport({
    imap: {
      user: FIXTURE_ADDRESS,
      password: FIXTURE_PASSWORD,
      messages,
      ...resolveImapExtras(extra),
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

type MessageEnvelope = {
  messages: Array<Record<string, unknown>>;
  total: number;
  offset: number;
  limit: number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseEnvelope(text: string): MessageEnvelope {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed) || !Array.isArray(parsed.messages)) {
    throw new Error('expected a JSON object envelope');
  }
  if (typeof parsed.total !== 'number' || typeof parsed.offset !== 'number') {
    throw new Error('expected numeric total and offset');
  }
  if (parsed.limit !== null && typeof parsed.limit !== 'number') {
    throw new Error('expected limit number or null');
  }
  const messages: Array<Record<string, unknown>> = [];
  for (const message of parsed.messages) {
    if (!isRecord(message)) {
      throw new Error('expected message object');
    }
    messages.push(message);
  }
  return { messages, total: parsed.total, offset: parsed.offset, limit: parsed.limit };
}

function messageUids(envelope: MessageEnvelope): unknown[] {
  return envelope.messages.map((message) => message.uid);
}

function expectSummaryShape(message: Record<string, unknown>): void {
  for (const key of ['uid', 'from', 'to', 'subject', 'date', 'seen', 'unread']) {
    expect(message).toHaveProperty(key);
  }
  expect(message).not.toHaveProperty('textBody');
  expect(message).not.toHaveProperty('htmlBody');
  expect(message).not.toHaveProperty('body');
}

function note(uid: number, subject: string, date = '01 Jan 2024 00:00:00 +0000'): FakeImapMessage {
  return {
    uid,
    from: 'alice@example.test',
    to: 'me@example.test',
    subject,
    date,
    seen: false,
    textBody: `body ${subject}`,
  };
}

function sameDateMessages(count: number): FakeImapMessage[] {
  const messages: FakeImapMessage[] = [];
  for (let uid = 1; uid <= count; uid += 1) {
    messages.push(note(uid, `Subject ${String(uid)}`));
  }
  return messages;
}

function defaultNewestInbox(): FakeImapMessage[] {
  const messages: FakeImapMessage[] = [
    {
      uid: 1,
      from: 'alice@example.test',
      to: 'me@example.test',
      subject: 'Subject 1',
      date: '01 Feb 2024 00:00:00 +0000',
      seen: true,
      textBody: 'body 1',
    },
  ];
  for (let uid = 2; uid <= 21; uid += 1) {
    const day = String(uid - 1).padStart(2, '0');
    messages.push({
      uid,
      from: 'alice@example.test',
      to: 'me@example.test',
      subject: `Subject ${String(uid)}`,
      date: `${day} Jan 2024 00:00:00 +0000`,
      seen: false,
      textBody: `body ${String(uid)}`,
    });
  }
  return messages;
}

async function expectCallFailure(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return errorMessage(error);
  }
  expect.fail('expected callTool to throw');
}

describe('connector-mail-ru: Mail.ru list_messages tool', () => {
  it('Default call returns the full newest set inside an envelope', async () => {
    await withMailruMcpClient(defaultNewestInbox(), async (client) => {
      const text = toolText(
        await client.callTool({
          name: 'mailru_list_messages',
          arguments: { account: ACCOUNT_ID },
        }),
      );
      expect(text).not.toContain(FIXTURE_PASSWORD);
      expect(Array.isArray(JSON.parse(text))).toBe(false);
      const envelope = parseEnvelope(text);
      expect(envelope.offset).toBe(0);
      expect(envelope.limit).toBeNull();
      expect(envelope.total).toBe(21);
      expect(envelope.messages).toHaveLength(21);
      expect(envelope.messages[0]).toMatchObject({
        uid: 1,
        to: 'me@example.test',
        seen: true,
        unread: false,
      });
      const last = envelope.messages[envelope.messages.length - 1];
      expect(last).toMatchObject({ uid: 2, seen: false, unread: true });
      for (const message of envelope.messages) {
        expectSummaryShape(message);
      }
    });
  });

  it('Offset and both orders page a mailbox', async () => {
    const messages = [
      note(5, 'five', '04 Jan 2024 00:00:00 +0000'),
      note(6, 'six', '01 Jan 2024 00:00:00 +0000'),
      note(7, 'seven', '03 Jan 2024 00:00:00 +0000'),
      note(8, 'eight', '02 Jan 2024 00:00:00 +0000'),
    ];
    await withMailruMcpClient(messages, async (client) => {
      const newest = parseEnvelope(
        toolText(
          await client.callTool({
            name: 'mailru_list_messages',
            arguments: { account: ACCOUNT_ID, limit: 2, offset: 0, order: 'newest' },
          }),
        ),
      );
      expect(newest).toMatchObject({ total: 4, offset: 0, limit: 2 });
      expect(messageUids(newest)).toEqual([5, 7]);
      const newestPage = parseEnvelope(
        toolText(
          await client.callTool({
            name: 'mailru_list_messages',
            arguments: { account: ACCOUNT_ID, limit: 2, offset: 2, order: 'newest' },
          }),
        ),
      );
      expect(messageUids(newestPage)).toEqual([8, 6]);
      expect(newestPage.total).toBe(4);
      const oldest = parseEnvelope(
        toolText(
          await client.callTool({
            name: 'mailru_list_messages',
            arguments: { account: ACCOUNT_ID, limit: 2, offset: 0, order: 'oldest' },
          }),
        ),
      );
      expect(messageUids(oldest)).toEqual([6, 8]);
      const oldestPage = parseEnvelope(
        toolText(
          await client.callTool({
            name: 'mailru_list_messages',
            arguments: { account: ACCOUNT_ID, limit: 2, offset: 2, order: 'oldest' },
          }),
        ),
      );
      expect(messageUids(oldestPage)).toEqual([7, 5]);
      expect(JSON.stringify(oldestPage)).not.toContain(FIXTURE_PASSWORD);
      for (const message of [...newest.messages, ...oldestPage.messages]) {
        expect(message).toHaveProperty('to');
        expectSummaryShape(message);
      }
    });
  });

  it('List returns capped summaries without bodies on a fake IMAP server', async () => {
    await withMailruMcpClient(sameDateMessages(60), async (client) => {
      const text = toolText(
        await client.callTool({
          name: 'mailru_list_messages',
          arguments: { account: ACCOUNT_ID, limit: 80 },
        }),
      );
      expect(text).not.toContain(FIXTURE_PASSWORD);
      const envelope = parseEnvelope(text);
      expect(envelope.limit).toBe(80);
      expect(envelope.offset).toBe(0);
      expect(envelope.total).toBe(60);
      expect(envelope.messages).toHaveLength(60);
      expect(envelope.messages[0]?.uid).toBe(60);
      expect(envelope.messages[envelope.messages.length - 1]?.uid).toBe(1);
      for (const message of envelope.messages) {
        expectSummaryShape(message);
      }
    });
  });

  it('Provided limit is honored with no maximum', async () => {
    await withMailruMcpClient(sameDateMessages(60), async (client) => {
      const text = toolText(
        await client.callTool({
          name: 'mailru_list_messages',
          arguments: { account: ACCOUNT_ID, limit: 2, offset: 0, order: 'oldest' },
        }),
      );
      expect(text).not.toContain(FIXTURE_PASSWORD);
      const envelope = parseEnvelope(text);
      expect(envelope).toMatchObject({ limit: 2, offset: 0, total: 60 });
      expect(messageUids(envelope)).toEqual([1, 2]);
      for (const message of envelope.messages) {
        expectSummaryShape(message);
      }
    });
  });

  it('Unparseable dates sort as oldest', async () => {
    const messages = [
      note(1, 'bad-1', 'not-a-date'),
      note(2, 'good', '02 Jan 2024 00:00:00 +0000'),
      note(3, 'bad-3', 'not-a-date'),
    ];
    await withMailruMcpClient(messages, async (client) => {
      const newest = parseEnvelope(
        toolText(
          await client.callTool({
            name: 'mailru_list_messages',
            arguments: { account: ACCOUNT_ID, order: 'newest' },
          }),
        ),
      );
      expect(messageUids(newest)).toEqual([2, 3, 1]);
      expect(newest.limit).toBeNull();
      expect(newest.total).toBe(3);
      const oldest = parseEnvelope(
        toolText(
          await client.callTool({
            name: 'mailru_list_messages',
            arguments: { account: ACCOUNT_ID, order: 'oldest' },
          }),
        ),
      );
      expect(messageUids(oldest)).toEqual([1, 3, 2]);
    });
  });

  it('Invalid offset and limit return the full remainder', async () => {
    await withMailruMcpClient([note(1, 'only')], async (client) => {
      const zero = parseEnvelope(
        toolText(
          await client.callTool({
            name: 'mailru_list_messages',
            arguments: { account: ACCOUNT_ID, limit: 0, offset: -1 },
          }),
        ),
      );
      expect(zero.offset).toBe(0);
      expect(zero.limit).toBeNull();
      expect(zero.total).toBe(1);
      expect(zero.messages).toHaveLength(1);
      const fractional = parseEnvelope(
        toolText(
          await client.callTool({
            name: 'mailru_list_messages',
            arguments: { account: ACCOUNT_ID, limit: 1.5, offset: -4 },
          }),
        ),
      );
      expect(fractional.offset).toBe(0);
      expect(fractional.limit).toBeNull();
      expect(fractional.total).toBe(1);
      expect(fractional.messages).toHaveLength(1);
    });
  });

  it('Offset past the end returns an empty page', async () => {
    await withMailruMcpClient([note(1, 'only')], async (client) => {
      const limited = parseEnvelope(
        toolText(
          await client.callTool({
            name: 'mailru_list_messages',
            arguments: { account: ACCOUNT_ID, offset: 5, limit: 20 },
          }),
        ),
      );
      expect(limited).toMatchObject({ offset: 5, limit: 20, total: 1 });
      expect(limited.messages).toEqual([]);
      const open = parseEnvelope(
        toolText(
          await client.callTool({
            name: 'mailru_list_messages',
            arguments: { account: ACCOUNT_ID, offset: 5 },
          }),
        ),
      );
      expect(open).toMatchObject({ offset: 5, limit: null, total: 1 });
      expect(open.messages).toEqual([]);
    });
  });

  it('Unknown order is rejected', async () => {
    await withMailruMcpClient([note(1, 'only')], async (client, egress) => {
      const before = egress.tlsSessionCallCount;
      const message = await expectCallFailure(() =>
        client.callTool({
          name: 'mailru_list_messages',
          arguments: { account: ACCOUNT_ID, order: 'random' },
        }),
      );
      expect(message).toContain('Invalid order');
      expect(message).not.toContain(FIXTURE_PASSWORD);
      expect(egress.searchCommandCount).toBe(0);
      expect(egress.tlsSessionCallCount).toBe(before);
    });
  });

  it('Sent, Drafts, Spam, and Trash are listed by server mailbox name', async () => {
    await withMailruMcpClient(
      [note(1, 'Inbox note')],
      async (client) => {
        const listedText = toolText(
          await client.callTool({
            name: 'mailru_list_mailboxes',
            arguments: { account: ACCOUNT_ID },
          }),
        );
        const listed: unknown = JSON.parse(listedText);
        expect(Array.isArray(listed)).toBe(true);
        const mailboxes = listed as Array<Record<string, unknown>>;
        const byRole = (role: string): string => {
          const match = mailboxes.find((mailbox) => mailbox.specialUse === role);
          expect(match).toBeDefined();
          return String(match?.name);
        };
        expect(byRole('sent')).toBe('Sent Items');
        const sentText = toolText(
          await client.callTool({
            name: 'mailru_list_messages',
            arguments: { account: ACCOUNT_ID, mailbox: byRole('sent') },
          }),
        );
        expect(sentText).toContain('Sent note');
        expect(sentText).not.toContain('Inbox note');
        expect(sentText).not.toContain(FIXTURE_PASSWORD);
        expect(sentText).not.toContain('[Gmail]/');
        for (const message of parseEnvelope(sentText).messages) {
          expectSummaryShape(message);
        }
        const draftsText = toolText(
          await client.callTool({
            name: 'mailru_list_messages',
            arguments: { account: ACCOUNT_ID, mailbox: byRole('drafts') },
          }),
        );
        expect(draftsText).toContain('Draft note');
        const junkText = toolText(
          await client.callTool({
            name: 'mailru_list_messages',
            arguments: { account: ACCOUNT_ID, mailbox: byRole('junk') },
          }),
        );
        expect(junkText).toContain('Spam note');
        const trashText = toolText(
          await client.callTool({
            name: 'mailru_list_messages',
            arguments: { account: ACCOUNT_ID, mailbox: byRole('trash') },
          }),
        );
        expect(trashText).toContain('Trash note');
        expect(trashText).not.toContain(FIXTURE_PASSWORD);
        expect(trashText).not.toContain('[Gmail]/');
      },
      [
        { name: 'Sent Items', attributes: ['\\Sent'], messages: [note(1, 'Sent note')] },
        { name: 'Drafts', attributes: ['\\Drafts'], messages: [note(1, 'Draft note')] },
        { name: 'Spam', attributes: ['\\Junk'], messages: [note(1, 'Spam note')] },
        { name: 'Deleted Items', attributes: ['\\Trash'], messages: [note(1, 'Trash note')] },
      ],
    );
  });
});

describe('connector-mail-ru: Mail.ru search_messages tool', () => {
  it('Narrow filter search returns matching summaries on a fake IMAP server', async () => {
    const messages = manyMessages(6);
    await withMailruMcpClient(messages, async (client) => {
      const text = toolText(
        await client.callTool({
          name: 'mailru_search_messages',
          arguments: {
            account: ACCOUNT_ID,
            filter: { from: 'alice@example.test' },
          },
        }),
      );
      expect(text).not.toContain(FIXTURE_PASSWORD);
      const envelope = parseEnvelope(text);
      expect(envelope.offset).toBe(0);
      expect(envelope.limit).toBeNull();
      expect(envelope.messages.length).toBeGreaterThan(0);
      expect(envelope.total).toBe(envelope.messages.length);
      for (const summary of envelope.messages) {
        expect(String(summary.from)).toContain('alice@example.test');
        expectSummaryShape(summary);
      }
    });
  });

  it('Search applies paging and order after the filter', async () => {
    const messages = [
      note(1, 'alice-3', '03 Jan 2024 00:00:00 +0000'),
      { ...note(2, 'bob', '04 Jan 2024 00:00:00 +0000'), from: 'bob@example.test' },
      note(3, 'alice-1', '01 Jan 2024 00:00:00 +0000'),
      note(4, 'alice-2', '02 Jan 2024 00:00:00 +0000'),
    ];
    await withMailruMcpClient(messages, async (client) => {
      const oldestText = toolText(
        await client.callTool({
          name: 'mailru_search_messages',
          arguments: {
            account: ACCOUNT_ID,
            filter: { from: 'alice@example.test' },
            order: 'oldest',
            limit: 2,
            offset: 0,
          },
        }),
      );
      const oldest = parseEnvelope(oldestText);
      expect(oldest).toMatchObject({ total: 3, offset: 0, limit: 2 });
      expect(messageUids(oldest)).toEqual([3, 4]);
      expect(oldestText).not.toContain('bob@example.test');
      const newestText = toolText(
        await client.callTool({
          name: 'mailru_search_messages',
          arguments: {
            account: ACCOUNT_ID,
            filter: { from: 'alice@example.test' },
            order: 'newest',
            limit: 2,
            offset: 2,
          },
        }),
      );
      const newest = parseEnvelope(newestText);
      expect(newest.total).toBe(3);
      expect(messageUids(newest)).toEqual([3]);
      expect(newestText).not.toContain(FIXTURE_PASSWORD);
      for (const message of newest.messages) {
        expectSummaryShape(message);
      }
    });
  });

  it('Unknown search order is rejected', async () => {
    await withMailruMcpClient([note(1, 'only')], async (client, egress) => {
      const before = egress.tlsSessionCallCount;
      const message = await expectCallFailure(() =>
        client.callTool({
          name: 'mailru_search_messages',
          arguments: {
            account: ACCOUNT_ID,
            order: 'random',
            filter: { from: 'alice@example.test' },
          },
        }),
      );
      expect(message).toContain('Invalid order');
      expect(message).not.toContain(FIXTURE_PASSWORD);
      expect(egress.searchCommandCount).toBe(0);
      expect(egress.tlsSessionCallCount).toBe(before);
    });
  });

  it('Free-form IMAP search syntax is rejected', async () => {
    const messages = manyMessages(2);
    await withMailruMcpClient(messages, async (client, egress) => {
      const before = egress.tlsSessionCallCount;
      const stringError = await expectCallFailure(() =>
        client.callTool({
          name: 'mailru_search_messages',
          arguments: {
            account: ACCOUNT_ID,
            filter: 'OR FROM alice SUBJECT secret',
          },
        }),
      );
      expect(stringError).not.toContain(FIXTURE_PASSWORD);
      expect(egress.tlsSessionCallCount).toBe(before);
      expect(egress.searchCommandCount).toBe(0);
      const rawError = await expectCallFailure(() =>
        client.callTool({
          name: 'mailru_search_messages',
          arguments: {
            account: ACCOUNT_ID,
            filter: { raw: 'BEFORE 1-Jan-2020' },
          },
        }),
      );
      expect(rawError).not.toContain(FIXTURE_PASSWORD);
      expect(egress.tlsSessionCallCount).toBe(before);
      expect(egress.searchCommandCount).toBe(0);
    });
  });
});

function attachedMessage(uid: number): FakeImapMessage {
  return {
    uid,
    from: 'alice@example.test',
    to: 'me@example.test',
    subject: 'With attachment',
    date: '01 Jan 2024 00:00:00 +0000',
    seen: true,
    textBody: 'Readable text body',
    htmlBody: '<p>Readable html</p>',
    attachments: [
      { name: 'file.bin', contentType: 'application/octet-stream', bytes: 'file-bytes' },
    ],
  };
}

function parseObject(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) {
    throw new Error('expected a JSON object');
  }
  return parsed;
}

describe('connector-mail-ru: Mail.ru read_message tool', () => {
  it('Read returns headers and text body without attachment bytes', async () => {
    await withMailruMcpClient([attachedMessage(42)], async (client) => {
      const text = toolText(
        await client.callTool({
          name: 'mailru_read_message',
          arguments: { account: ACCOUNT_ID, uid: 42 },
        }),
      );
      expect(text).not.toContain(FIXTURE_PASSWORD);
      expect(text).not.toContain('file-bytes');
      expect(text).not.toContain('attachmentNames');
      const parsed = parseObject(text);
      expect(parsed).toEqual({
        from: 'alice@example.test',
        to: 'me@example.test',
        subject: 'With attachment',
        date: '01 Jan 2024 00:00:00 +0000',
        textBody: 'Readable text body',
        htmlBody: '<p>Readable html</p>',
        attachments: [
          { index: 0, name: 'file.bin', contentType: 'application/octet-stream', size: 10 },
        ],
      });
      expect(parsed).not.toHaveProperty('data');
    });
  });

  it('Missing HTML part yields an empty string', async () => {
    await withMailruMcpClient(
      [
        {
          uid: 7,
          from: 'alice@example.test',
          to: 'me@example.test',
          subject: 'Plain',
          date: '01 Jan 2024 00:00:00 +0000',
          seen: false,
          textBody: 'Plain only',
        },
      ],
      async (client) => {
        const text = toolText(
          await client.callTool({
            name: 'mailru_read_message',
            arguments: { account: ACCOUNT_ID, uid: 7 },
          }),
        );
        expect(text).not.toContain(FIXTURE_PASSWORD);
        const parsed = parseObject(text);
        expect(parsed.textBody).toBe('Plain only');
        expect(parsed.htmlBody).toBe('');
        expect(parsed.attachments).toEqual([]);
      },
    );
  });
});

describe('connector-mail-ru: Mail.ru get_attachment tool', () => {
  it('Attachment is returned as base64', async () => {
    await withMailruMcpClient([attachedMessage(42)], async (client) => {
      const text = toolText(
        await client.callTool({
          name: 'mailru_get_attachment',
          arguments: { account: ACCOUNT_ID, uid: 42, index: 0 },
        }),
      );
      expect(text).not.toContain(FIXTURE_PASSWORD);
      expect(parseObject(text)).toEqual({
        index: 0,
        name: 'file.bin',
        contentType: 'application/octet-stream',
        size: 10,
        data: 'ZmlsZS1ieXRlcw==',
      });
    });
  });

  it('Missing attachment is not found', async () => {
    await withMailruMcpClient([note(42, 'No file')], async (client) => {
      const message = await expectCallFailure(() =>
        client.callTool({
          name: 'mailru_get_attachment',
          arguments: { account: ACCOUNT_ID, uid: 42, index: 0 },
        }),
      );
      expect(message).toContain('Attachment not found');
      expect(message).not.toContain(FIXTURE_PASSWORD);
    });
  });

  it('Attachment index below 0 is rejected', async () => {
    await withMailruMcpClient([attachedMessage(42)], async (client) => {
      const message = await expectCallFailure(() =>
        client.callTool({
          name: 'mailru_get_attachment',
          arguments: { account: ACCOUNT_ID, uid: 42, index: -1 },
        }),
      );
      expect(message).toContain('Attachment index is required');
      expect(message).not.toContain(FIXTURE_PASSWORD);
    });
  });

  it('Get attachment uid below 1 is rejected', async () => {
    await withMailruMcpClient([attachedMessage(42)], async (client) => {
      const message = await expectCallFailure(() =>
        client.callTool({
          name: 'mailru_get_attachment',
          arguments: { account: ACCOUNT_ID, uid: 0, index: 0 },
        }),
      );
      expect(message).toContain('uid is required');
      expect(message).not.toContain(FIXTURE_PASSWORD);
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
