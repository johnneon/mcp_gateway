import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it } from 'vitest';
import { gmailConnector } from '../../../src/connectors/gmail/index.js';
import type { EgressTransport } from '../../../src/connectors/native/egress.js';
import { buildConnectorRegistry } from '../../../src/connectors/registry.js';
import { createMcpApp } from '../../../src/http/createMcpApp.js';
import type { JsonObject } from '../../../src/store/codec.js';
import type { EncryptedStore } from '../../../src/store/store.js';
import { hashToken } from '../../../src/token/token.js';
import { createGmailFakeEgressTransport } from './fake-egress.js';
import type { FakeImapMessage, FakeImapOptions } from '../mail/fake-imap.js';

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

const FIXTURE_PASSWORD = 'gmail-tool-fixture-password-UNIQUE';
const FIXTURE_ADDRESS = 'user@gmail.com';
const BEARER = 'gmail-mcp-bearer-UNIQUE';
const ACCOUNT_ID = 'gmail-acc-1';

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

function gmailStore(): EncryptedStore {
  return createMemoryStore({
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

type GmailEgress = EgressTransport & { tlsSessionCallCount: number; searchCommandCount: number };

type GmailImapExtras = Partial<
  Pick<FakeImapOptions, 'mailboxes' | 'deleteNo' | 'moveNo' | 'copyNo' | 'storeNo' | 'attachmentNo'>
>;

function resolveImapExtras(
  extra?: FakeImapOptions['mailboxes'] | GmailImapExtras,
): GmailImapExtras {
  if (extra === undefined) {
    return {};
  }
  if (Array.isArray(extra)) {
    return { mailboxes: extra };
  }
  return extra;
}

async function withGmailMcpClient<T>(
  messages: FakeImapMessage[],
  run: (client: Client, transport: GmailEgress) => Promise<T>,
  extra?: FakeImapOptions['mailboxes'] | GmailImapExtras,
): Promise<T> {
  const registry = buildConnectorRegistry([gmailConnector]);
  const store = gmailStore();
  const egressTransport = createGmailFakeEgressTransport({
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
  const client = new Client({ name: 'gmail-tools-test', version: '0.0.0' });
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
  return {
    messages,
    total: parsed.total,
    offset: parsed.offset,
    limit: parsed.limit,
  };
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

describe('connector-gmail: Gmail list_messages tool', () => {
  it('Default call returns the full newest set inside an envelope', async () => {
    await withGmailMcpClient(defaultNewestInbox(), async (client) => {
      const result = await client.callTool({
        name: 'gmail_list_messages',
        arguments: { account: ACCOUNT_ID },
      });
      const text = toolText(result);
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
    await withGmailMcpClient(messages, async (client) => {
      const newest = parseEnvelope(
        toolText(
          await client.callTool({
            name: 'gmail_list_messages',
            arguments: { account: ACCOUNT_ID, limit: 2, offset: 0, order: 'newest' },
          }),
        ),
      );
      expect(newest).toMatchObject({ total: 4, offset: 0, limit: 2 });
      expect(messageUids(newest)).toEqual([5, 7]);

      const newestPage = parseEnvelope(
        toolText(
          await client.callTool({
            name: 'gmail_list_messages',
            arguments: { account: ACCOUNT_ID, limit: 2, offset: 2, order: 'newest' },
          }),
        ),
      );
      expect(messageUids(newestPage)).toEqual([8, 6]);
      expect(newestPage.total).toBe(4);

      const oldest = parseEnvelope(
        toolText(
          await client.callTool({
            name: 'gmail_list_messages',
            arguments: { account: ACCOUNT_ID, limit: 2, offset: 0, order: 'oldest' },
          }),
        ),
      );
      expect(messageUids(oldest)).toEqual([6, 8]);

      const oldestPage = parseEnvelope(
        toolText(
          await client.callTool({
            name: 'gmail_list_messages',
            arguments: { account: ACCOUNT_ID, limit: 2, offset: 2, order: 'oldest' },
          }),
        ),
      );
      expect(messageUids(oldestPage)).toEqual([7, 5]);
      const text = JSON.stringify(oldestPage);
      expect(text).not.toContain(FIXTURE_PASSWORD);
      for (const message of [...newest.messages, ...oldestPage.messages]) {
        expect(message).toHaveProperty('to');
        expectSummaryShape(message);
      }
    });
  });

  it('List returns capped summaries without bodies on a fake IMAP server', async () => {
    await withGmailMcpClient(sameDateMessages(60), async (client) => {
      const result = await client.callTool({
        name: 'gmail_list_messages',
        arguments: { account: ACCOUNT_ID, limit: 80 },
      });
      const text = toolText(result);
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
    await withGmailMcpClient(sameDateMessages(60), async (client) => {
      const result = await client.callTool({
        name: 'gmail_list_messages',
        arguments: { account: ACCOUNT_ID, limit: 2, offset: 0, order: 'oldest' },
      });
      const text = toolText(result);
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
    await withGmailMcpClient(messages, async (client) => {
      const newest = parseEnvelope(
        toolText(
          await client.callTool({
            name: 'gmail_list_messages',
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
            name: 'gmail_list_messages',
            arguments: { account: ACCOUNT_ID, order: 'oldest' },
          }),
        ),
      );
      expect(messageUids(oldest)).toEqual([1, 3, 2]);
    });
  });

  it('Invalid offset and limit return the full remainder', async () => {
    await withGmailMcpClient([note(1, 'only')], async (client) => {
      const zero = parseEnvelope(
        toolText(
          await client.callTool({
            name: 'gmail_list_messages',
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
            name: 'gmail_list_messages',
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
    await withGmailMcpClient([note(1, 'only')], async (client) => {
      const limited = parseEnvelope(
        toolText(
          await client.callTool({
            name: 'gmail_list_messages',
            arguments: { account: ACCOUNT_ID, offset: 5, limit: 20 },
          }),
        ),
      );
      expect(limited).toMatchObject({ offset: 5, limit: 20, total: 1 });
      expect(limited.messages).toEqual([]);

      const open = parseEnvelope(
        toolText(
          await client.callTool({
            name: 'gmail_list_messages',
            arguments: { account: ACCOUNT_ID, offset: 5 },
          }),
        ),
      );
      expect(open).toMatchObject({ offset: 5, limit: null, total: 1 });
      expect(open.messages).toEqual([]);
    });
  });

  it('Unknown order is rejected', async () => {
    await withGmailMcpClient([note(1, 'only')], async (client, egress) => {
      const before = egress.tlsSessionCallCount;
      const message = await expectCallFailure(() =>
        client.callTool({
          name: 'gmail_list_messages',
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
    await withGmailMcpClient(
      [note(1, 'Inbox note')],
      async (client) => {
        const listedText = toolText(
          await client.callTool({
            name: 'gmail_list_mailboxes',
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
            name: 'gmail_list_messages',
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
            name: 'gmail_list_messages',
            arguments: { account: ACCOUNT_ID, mailbox: byRole('drafts') },
          }),
        );
        expect(draftsText).toContain('Draft note');

        const junkText = toolText(
          await client.callTool({
            name: 'gmail_list_messages',
            arguments: { account: ACCOUNT_ID, mailbox: byRole('junk') },
          }),
        );
        expect(junkText).toContain('Spam note');

        const trashText = toolText(
          await client.callTool({
            name: 'gmail_list_messages',
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

describe('connector-gmail: Gmail search_messages tool', () => {
  it('Narrow filter search returns matching summaries on a fake IMAP server', async () => {
    const messages = manyMessages(6);
    await withGmailMcpClient(messages, async (client) => {
      const result = await client.callTool({
        name: 'gmail_search_messages',
        arguments: {
          account: ACCOUNT_ID,
          filter: { from: 'alice@example.test' },
        },
      });
      const text = toolText(result);
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
      {
        ...note(2, 'bob', '04 Jan 2024 00:00:00 +0000'),
        from: 'bob@example.test',
      },
      note(3, 'alice-1', '01 Jan 2024 00:00:00 +0000'),
      note(4, 'alice-2', '02 Jan 2024 00:00:00 +0000'),
    ];
    await withGmailMcpClient(messages, async (client) => {
      const oldestText = toolText(
        await client.callTool({
          name: 'gmail_search_messages',
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
          name: 'gmail_search_messages',
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
    await withGmailMcpClient([note(1, 'only')], async (client, egress) => {
      const before = egress.tlsSessionCallCount;
      const message = await expectCallFailure(() =>
        client.callTool({
          name: 'gmail_search_messages',
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
    await withGmailMcpClient(messages, async (client, egress) => {
      const before = egress.tlsSessionCallCount;
      const stringError = await expectCallFailure(() =>
        client.callTool({
          name: 'gmail_search_messages',
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
          name: 'gmail_search_messages',
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

describe('connector-gmail: Gmail read_message tool', () => {
  it('Read returns headers and text body without attachment bytes', async () => {
    await withGmailMcpClient([attachedMessage(42)], async (client) => {
      const result = await client.callTool({
        name: 'gmail_read_message',
        arguments: { account: ACCOUNT_ID, uid: 42 },
      });
      const text = toolText(result);
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
    const messages: FakeImapMessage[] = [
      {
        uid: 7,
        from: 'alice@example.test',
        to: 'me@example.test',
        subject: 'Plain',
        date: '01 Jan 2024 00:00:00 +0000',
        seen: false,
        textBody: 'Plain only',
      },
    ];
    await withGmailMcpClient(messages, async (client) => {
      const text = toolText(
        await client.callTool({
          name: 'gmail_read_message',
          arguments: { account: ACCOUNT_ID, uid: 7 },
        }),
      );
      expect(text).not.toContain(FIXTURE_PASSWORD);
      const parsed = parseObject(text);
      expect(parsed.textBody).toBe('Plain only');
      expect(parsed.htmlBody).toBe('');
      expect(parsed.attachments).toEqual([]);
    });
  });
});

describe('connector-gmail: Gmail get_attachment tool', () => {
  it('Attachment is returned as base64', async () => {
    await withGmailMcpClient([attachedMessage(42)], async (client) => {
      const text = toolText(
        await client.callTool({
          name: 'gmail_get_attachment',
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
    const messages: FakeImapMessage[] = [
      {
        uid: 42,
        from: 'alice@example.test',
        to: 'me@example.test',
        subject: 'No file',
        date: '01 Jan 2024 00:00:00 +0000',
        seen: false,
        textBody: 'Plain only',
      },
    ];
    await withGmailMcpClient(messages, async (client) => {
      const message = await expectCallFailure(() =>
        client.callTool({
          name: 'gmail_get_attachment',
          arguments: { account: ACCOUNT_ID, uid: 42, index: 0 },
        }),
      );
      expect(message).toContain('Attachment not found');
      expect(message).not.toContain(FIXTURE_PASSWORD);
    });
  });

  it('Attachment index below 0 is rejected', async () => {
    await withGmailMcpClient([attachedMessage(42)], async (client) => {
      const message = await expectCallFailure(() =>
        client.callTool({
          name: 'gmail_get_attachment',
          arguments: { account: ACCOUNT_ID, uid: 42, index: -1 },
        }),
      );
      expect(message).toContain('Attachment index is required');
      expect(message).not.toContain(FIXTURE_PASSWORD);
    });
  });

  it('Get attachment uid below 1 is rejected', async () => {
    await withGmailMcpClient([attachedMessage(42)], async (client) => {
      const message = await expectCallFailure(() =>
        client.callTool({
          name: 'gmail_get_attachment',
          arguments: { account: ACCOUNT_ID, uid: 0, index: 0 },
        }),
      );
      expect(message).toContain('uid is required');
      expect(message).not.toContain(FIXTURE_PASSWORD);
    });
  });
});

function parseMailboxes(text: string): Array<{ name: string; specialUse: string }> {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new Error('expected a mailbox array');
  }
  return parsed.map((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.name !== 'string' ||
      typeof entry.specialUse !== 'string'
    ) {
      throw new Error('expected a mailbox entry');
    }
    return { name: entry.name, specialUse: entry.specialUse };
  });
}

async function listMailboxText(client: Client): Promise<string> {
  return toolText(
    await client.callTool({
      name: 'gmail_list_mailboxes',
      arguments: { account: ACCOUNT_ID },
    }),
  );
}

function inboxSummary(text: string, uid: number): Record<string, unknown> {
  const found = parseEnvelope(text).messages.find((message) => message.uid === uid);
  if (found === undefined) {
    throw new Error(`missing uid ${String(uid)}`);
  }
  return found;
}

describe('connector-gmail: Gmail update_flags tool', () => {
  it('Set seen and flagged', async () => {
    await withGmailMcpClient([note(7, 'flag me')], async (client) => {
      const text = toolText(
        await client.callTool({
          name: 'gmail_update_flags',
          arguments: { account: ACCOUNT_ID, uid: 7, seen: true, flagged: true },
        }),
      );
      expect(text).not.toContain(FIXTURE_PASSWORD);
      expect(parseObject(text)).toEqual({ uid: 7, seen: true, flagged: true });
      const listed = toolText(
        await client.callTool({
          name: 'gmail_list_messages',
          arguments: { account: ACCOUNT_ID },
        }),
      );
      expect(inboxSummary(listed, 7)).toMatchObject({ seen: true, unread: false });
    });
  });

  it('Clear seen and flagged', async () => {
    await withGmailMcpClient(
      [{ ...note(7, 'clear me'), seen: true, flagged: true }],
      async (client) => {
        const text = toolText(
          await client.callTool({
            name: 'gmail_update_flags',
            arguments: { account: ACCOUNT_ID, uid: 7, seen: false, flagged: false },
          }),
        );
        expect(text).not.toContain(FIXTURE_PASSWORD);
        expect(parseObject(text)).toEqual({ uid: 7, seen: false, flagged: false });
        const listed = toolText(
          await client.callTool({
            name: 'gmail_list_messages',
            arguments: { account: ACCOUNT_ID },
          }),
        );
        expect(inboxSummary(listed, 7)).toMatchObject({ seen: false, unread: true });
      },
    );
  });

  it('Omitted flag stays unchanged', async () => {
    await withGmailMcpClient(
      [{ ...note(7, 'keep seen'), seen: true, flagged: false }],
      async (client) => {
        const flagged = toolText(
          await client.callTool({
            name: 'gmail_update_flags',
            arguments: { account: ACCOUNT_ID, uid: 7, flagged: true },
          }),
        );
        expect(parseObject(flagged)).toMatchObject({ uid: 7, seen: true, flagged: true });
        const cleared = toolText(
          await client.callTool({
            name: 'gmail_update_flags',
            arguments: { account: ACCOUNT_ID, uid: 7, seen: false },
          }),
        );
        expect(cleared).not.toContain(FIXTURE_PASSWORD);
        expect(parseObject(cleared)).toMatchObject({ seen: false, flagged: true });
      },
    );
  });

  it('Flag is required', async () => {
    await withGmailMcpClient(
      [{ ...note(7, 'stay seen'), seen: true, flagged: false }],
      async (client) => {
        const message = await expectCallFailure(() =>
          client.callTool({
            name: 'gmail_update_flags',
            arguments: { account: ACCOUNT_ID, uid: 7 },
          }),
        );
        expect(message).toContain('Flag is required');
        expect(message).not.toContain(FIXTURE_PASSWORD);
        const listed = toolText(
          await client.callTool({
            name: 'gmail_list_messages',
            arguments: { account: ACCOUNT_ID },
          }),
        );
        expect(inboxSummary(listed, 7)).toMatchObject({ seen: true, unread: false });
        const after = toolText(
          await client.callTool({
            name: 'gmail_update_flags',
            arguments: { account: ACCOUNT_ID, uid: 7, seen: true },
          }),
        );
        expect(parseObject(after).flagged).toBe(false);
      },
    );
  });

  it('Update flags uid below 1 is rejected', async () => {
    await withGmailMcpClient([note(7, 'unseen')], async (client) => {
      const message = await expectCallFailure(() =>
        client.callTool({
          name: 'gmail_update_flags',
          arguments: { account: ACCOUNT_ID, uid: 0, seen: true },
        }),
      );
      expect(message).toContain('uid is required');
      expect(message).not.toContain(FIXTURE_PASSWORD);
      const listed = toolText(
        await client.callTool({
          name: 'gmail_list_messages',
          arguments: { account: ACCOUNT_ID },
        }),
      );
      expect(inboxSummary(listed, 7)).toMatchObject({ seen: false });
    });
  });
});

describe('connector-gmail: Gmail list_mailboxes tool', () => {
  it('List mailboxes returns name and special use', async () => {
    await withGmailMcpClient(
      [],
      async (client) => {
        const text = await listMailboxText(client);
        expect(text).not.toContain(FIXTURE_PASSWORD);
        expect(text).not.toContain('imap.gmail.com');
        expect(text).not.toContain('[Gmail]/');
        const listed = parseMailboxes(text);
        expect(listed).toEqual([
          { name: 'INBOX', specialUse: 'inbox' },
          { name: 'Sent Items', specialUse: 'sent' },
          { name: 'Drafts', specialUse: 'drafts' },
          { name: 'Spam', specialUse: 'junk' },
          { name: 'Deleted Items', specialUse: 'trash' },
          { name: 'Old Mail', specialUse: 'archive' },
          { name: 'Starred', specialUse: 'flagged' },
          { name: 'Everything', specialUse: 'all' },
          { name: 'Projects', specialUse: 'none' },
        ]);
      },
      [
        { name: 'Sent Items', attributes: ['\\Sent'], messages: [] },
        { name: 'Drafts', attributes: ['\\Drafts'], messages: [] },
        { name: 'Spam', attributes: ['\\Junk'], messages: [] },
        { name: 'Deleted Items', attributes: ['\\Trash'], messages: [] },
        { name: 'Old Mail', attributes: ['\\Archive'], messages: [] },
        { name: 'Starred', attributes: ['\\Flagged'], messages: [] },
        { name: 'Everything', attributes: ['\\All'], messages: [] },
        { name: 'Projects', attributes: [], messages: [] },
      ],
    );
  });
});

describe('connector-gmail: Gmail create_mailbox tool', () => {
  it('Create mailbox adds a folder', async () => {
    await withGmailMcpClient([], async (client) => {
      const text = toolText(
        await client.callTool({
          name: 'gmail_create_mailbox',
          arguments: { account: ACCOUNT_ID, name: 'Projects' },
        }),
      );
      expect(text).not.toContain(FIXTURE_PASSWORD);
      expect(parseObject(text)).toEqual({ name: 'Projects' });
      const listed = parseMailboxes(await listMailboxText(client));
      expect(listed).toContainEqual({ name: 'Projects', specialUse: 'none' });
    });
  });

  it('Empty mailbox name is rejected', async () => {
    await withGmailMcpClient([], async (client) => {
      const empty = await expectCallFailure(() =>
        client.callTool({
          name: 'gmail_create_mailbox',
          arguments: { account: ACCOUNT_ID, name: '' },
        }),
      );
      expect(empty).toContain('Mailbox name is required');
      expect(empty).not.toContain(FIXTURE_PASSWORD);
      const spaces = await expectCallFailure(() =>
        client.callTool({
          name: 'gmail_create_mailbox',
          arguments: { account: ACCOUNT_ID, name: '   ' },
        }),
      );
      expect(spaces).toContain('Mailbox name is required');
      const names = parseMailboxes(await listMailboxText(client)).map((mailbox) => mailbox.name);
      expect(names).not.toContain('');
      expect(names).not.toContain('   ');
    });
  });
});

describe('connector-gmail: Gmail rename_mailbox tool', () => {
  it('Rename mailbox changes the folder name', async () => {
    await withGmailMcpClient(
      [],
      async (client) => {
        const text = toolText(
          await client.callTool({
            name: 'gmail_rename_mailbox',
            arguments: { account: ACCOUNT_ID, name: 'Projects', newName: 'Archive' },
          }),
        );
        expect(text).not.toContain(FIXTURE_PASSWORD);
        expect(parseObject(text)).toEqual({ name: 'Projects', newName: 'Archive' });
        const names = parseMailboxes(await listMailboxText(client)).map((mailbox) => mailbox.name);
        expect(names).toContain('Archive');
        expect(names).not.toContain('Projects');
        const listed = toolText(
          await client.callTool({
            name: 'gmail_list_messages',
            arguments: { account: ACCOUNT_ID, mailbox: 'Archive' },
          }),
        );
        expect(listed).toContain('Keep me');
      },
      [{ name: 'Projects', attributes: [], messages: [note(1, 'Keep me')] }],
    );
  });

  it('Empty rename is rejected', async () => {
    await withGmailMcpClient(
      [],
      async (client) => {
        const empty = await expectCallFailure(() =>
          client.callTool({
            name: 'gmail_rename_mailbox',
            arguments: { account: ACCOUNT_ID, name: '', newName: 'Archive' },
          }),
        );
        expect(empty).toContain('Mailbox name is required');
        let names = parseMailboxes(await listMailboxText(client)).map((mailbox) => mailbox.name);
        expect(names).toContain('Projects');
        expect(names).not.toContain('Archive');
        const spaces = await expectCallFailure(() =>
          client.callTool({
            name: 'gmail_rename_mailbox',
            arguments: { account: ACCOUNT_ID, name: 'Projects', newName: '   ' },
          }),
        );
        expect(spaces).toContain('Mailbox name is required');
        expect(spaces).not.toContain(FIXTURE_PASSWORD);
        names = parseMailboxes(await listMailboxText(client)).map((mailbox) => mailbox.name);
        expect(names).toContain('Projects');
      },
      [{ name: 'Projects', attributes: [], messages: [] }],
    );
  });

  it('Inbox cannot be renamed', async () => {
    await withGmailMcpClient(
      [],
      async (client) => {
        const inbox = await expectCallFailure(() =>
          client.callTool({
            name: 'gmail_rename_mailbox',
            arguments: { account: ACCOUNT_ID, name: 'INBOX', newName: 'Elsewhere' },
          }),
        );
        expect(inbox).toContain('Inbox cannot be renamed');
        expect(inbox).not.toContain(FIXTURE_PASSWORD);
        let names = parseMailboxes(await listMailboxText(client)).map((mailbox) => mailbox.name);
        expect(names).toContain('INBOX');
        expect(names).not.toContain('Elsewhere');
        const lower = await expectCallFailure(() =>
          client.callTool({
            name: 'gmail_rename_mailbox',
            arguments: { account: ACCOUNT_ID, name: 'inbox', newName: 'Elsewhere' },
          }),
        );
        expect(lower).toContain('Inbox cannot be renamed');
        const incoming = await expectCallFailure(() =>
          client.callTool({
            name: 'gmail_rename_mailbox',
            arguments: { account: ACCOUNT_ID, name: 'Incoming', newName: 'Elsewhere' },
          }),
        );
        expect(incoming).toContain('Inbox cannot be renamed');
        names = parseMailboxes(await listMailboxText(client)).map((mailbox) => mailbox.name);
        expect(names).toContain('Incoming');
      },
      [{ name: 'Incoming', attributes: ['\\Inbox'], messages: [] }],
    );
  });
});

describe('connector-gmail: Gmail delete_mailbox tool', () => {
  it('Delete mailbox removes the folder', async () => {
    await withGmailMcpClient(
      [],
      async (client) => {
        const text = toolText(
          await client.callTool({
            name: 'gmail_delete_mailbox',
            arguments: { account: ACCOUNT_ID, name: 'Projects' },
          }),
        );
        expect(text).not.toContain(FIXTURE_PASSWORD);
        expect(parseObject(text)).toEqual({ name: 'Projects' });
        const names = parseMailboxes(await listMailboxText(client)).map((mailbox) => mailbox.name);
        expect(names).not.toContain('Projects');
        const trash = toolText(
          await client.callTool({
            name: 'gmail_list_messages',
            arguments: { account: ACCOUNT_ID, mailbox: 'Deleted Items' },
          }),
        );
        expect(trash).not.toContain('Gone with the folder');
      },
      [
        { name: 'Projects', attributes: [], messages: [note(1, 'Gone with the folder')] },
        { name: 'Deleted Items', attributes: ['\\Trash'], messages: [] },
      ],
    );
  });

  it('Empty delete name is rejected', async () => {
    await withGmailMcpClient([], async (client) => {
      const empty = await expectCallFailure(() =>
        client.callTool({
          name: 'gmail_delete_mailbox',
          arguments: { account: ACCOUNT_ID, name: '' },
        }),
      );
      expect(empty).toContain('Mailbox name is required');
      expect(empty).not.toContain(FIXTURE_PASSWORD);
      const spaces = await expectCallFailure(() =>
        client.callTool({
          name: 'gmail_delete_mailbox',
          arguments: { account: ACCOUNT_ID, name: '   ' },
        }),
      );
      expect(spaces).toContain('Mailbox name is required');
      const names = parseMailboxes(await listMailboxText(client)).map((mailbox) => mailbox.name);
      expect(names).toContain('INBOX');
    });
  });

  it('Inbox cannot be deleted', async () => {
    await withGmailMcpClient(
      [],
      async (client) => {
        const inbox = await expectCallFailure(() =>
          client.callTool({
            name: 'gmail_delete_mailbox',
            arguments: { account: ACCOUNT_ID, name: 'INBOX' },
          }),
        );
        expect(inbox).toContain('Inbox cannot be deleted');
        expect(inbox).not.toContain(FIXTURE_PASSWORD);
        let names = parseMailboxes(await listMailboxText(client)).map((mailbox) => mailbox.name);
        expect(names).toContain('INBOX');
        const lower = await expectCallFailure(() =>
          client.callTool({
            name: 'gmail_delete_mailbox',
            arguments: { account: ACCOUNT_ID, name: 'inbox' },
          }),
        );
        expect(lower).toContain('Inbox cannot be deleted');
        const incoming = await expectCallFailure(() =>
          client.callTool({
            name: 'gmail_delete_mailbox',
            arguments: { account: ACCOUNT_ID, name: 'Incoming' },
          }),
        );
        expect(incoming).toContain('Inbox cannot be deleted');
        names = parseMailboxes(await listMailboxText(client)).map((mailbox) => mailbox.name);
        expect(names).toContain('Incoming');
      },
      [{ name: 'Incoming', attributes: ['\\Inbox'], messages: [] }],
    );
  });

  it('Server refusal leaves the mailbox', async () => {
    await withGmailMcpClient(
      [],
      async (client) => {
        const message = await expectCallFailure(() =>
          client.callTool({
            name: 'gmail_delete_mailbox',
            arguments: { account: ACCOUNT_ID, name: 'Projects' },
          }),
        );
        expect(message).not.toContain(FIXTURE_PASSWORD);
        const names = parseMailboxes(await listMailboxText(client)).map((mailbox) => mailbox.name);
        expect(names).toContain('Projects');
      },
      {
        mailboxes: [{ name: 'Projects', attributes: [], messages: [] }],
        deleteNo: FIXTURE_PASSWORD,
      },
    );
  });
});

describe('connector-gmail: Password never appears in Gmail tool or admin surfaces', () => {
  it('Fixture password absent from tool result and MCP error', async () => {
    const messages = manyMessages(3);
    await withGmailMcpClient(messages, async (client) => {
      const ok = await client.callTool({
        name: 'gmail_list_messages',
        arguments: { account: ACCOUNT_ID, limit: 2 },
      });
      expect(toolText(ok)).not.toContain(FIXTURE_PASSWORD);
    });

    const registry = buildConnectorRegistry([
      {
        ...gmailConnector,
        tools: gmailConnector.tools.map((tool) =>
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
    const store = gmailStore();
    const egressTransport = createGmailFakeEgressTransport({
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
    const client = new Client({ name: 'gmail-scrub-test', version: '0.0.0' });
    await client.connect(transport);
    try {
      await client.callTool({
        name: 'gmail_list_messages',
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
