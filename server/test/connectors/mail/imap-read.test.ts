import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_INDEX_REQUIRED_MESSAGE,
  ATTACHMENT_NOT_FOUND_MESSAGE,
  createImapClient,
  UID_REQUIRED_MESSAGE,
} from '../../../src/connectors/mail/index.js';
import { createFakeImapDuplex, type FakeImapMessage } from './fake-imap.js';

const FIXTURE_USER = 'user@example.test';
const FIXTURE_PASSWORD = 'fixture-mail-password-UNIQUE';

function message(fields: Partial<FakeImapMessage> & Pick<FakeImapMessage, 'uid'>): FakeImapMessage {
  return {
    uid: fields.uid,
    from: fields.from ?? 'alice@example.test',
    to: fields.to ?? 'me@example.test',
    subject: fields.subject ?? 'With attachment',
    date: fields.date ?? '01 Jan 2024 00:00:00 +0000',
    seen: fields.seen ?? false,
    textBody: fields.textBody ?? 'Readable text body',
    htmlBody: fields.htmlBody,
    attachmentName: fields.attachmentName,
    attachmentBytes: fields.attachmentBytes,
    attachments: fields.attachments,
  };
}

async function openInbox(messages: FakeImapMessage[]): Promise<{
  client: ReturnType<typeof createImapClient>;
  fetchCommandCount: () => number;
  close: () => void;
}> {
  const duplex = createFakeImapDuplex({
    user: FIXTURE_USER,
    password: FIXTURE_PASSWORD,
    messages,
  });
  const client = createImapClient(duplex);
  await client.login(FIXTURE_USER, FIXTURE_PASSWORD);
  await client.select('INBOX');
  return {
    client,
    fetchCommandCount: () => duplex.fetchCommandCount,
    close: () => {
      client.close();
    },
  };
}

describe('mail protocol: MIME fetch and attachment download over the duplex', () => {
  it('returns text, HTML, and attachment metadata without bytes', async () => {
    const session = await openInbox([
      message({
        uid: 42,
        htmlBody: '<p>Readable html</p>',
        attachments: [
          {
            name: 'file.bin',
            contentType: 'application/octet-stream',
            bytes: 'file-bytes',
          },
        ],
      }),
    ]);
    try {
      const read = await session.client.fetchMessage(42);
      expect(read.textBody).toBe('Readable text body');
      expect(read.htmlBody).toBe('<p>Readable html</p>');
      expect(read.attachments).toEqual([
        { index: 0, name: 'file.bin', contentType: 'application/octet-stream', size: 10 },
      ]);
      expect(JSON.stringify(read)).not.toContain('file-bytes');
      const page = await session.client.pageMessages();
      expect(page.messages[0]).toMatchObject({ uid: 42, seen: false, unread: true });
    } finally {
      session.close();
    }
  });

  it('returns an empty htmlBody when the message has no text/html part', async () => {
    const session = await openInbox([
      message({ uid: 7, subject: 'Plain', textBody: 'Plain only', seen: true }),
    ]);
    try {
      const read = await session.client.fetchMessage(7);
      expect(read.textBody).toBe('Plain only');
      expect(read.htmlBody).toBe('');
      expect(read.attachments).toEqual([]);
    } finally {
      session.close();
    }
  });

  it('returns standard base64 of the decoded attachment bytes', async () => {
    const session = await openInbox([
      message({
        uid: 42,
        attachments: [
          {
            name: 'file.bin',
            contentType: 'application/octet-stream',
            bytes: 'file-bytes',
          },
        ],
      }),
    ]);
    try {
      const downloaded = await session.client.getAttachment(42, 0);
      expect(downloaded).toEqual({
        index: 0,
        name: 'file.bin',
        contentType: 'application/octet-stream',
        size: 10,
        data: 'ZmlsZS1ieXRlcw==',
      });
      const page = await session.client.pageMessages();
      expect(page.messages[0]?.seen).toBe(false);
    } finally {
      session.close();
    }
  });

  it('throws Attachment not found when the part is missing', async () => {
    const session = await openInbox([message({ uid: 42, textBody: 'Plain only' })]);
    try {
      await expect(session.client.getAttachment(42, 0)).rejects.toThrow(
        ATTACHMENT_NOT_FOUND_MESSAGE,
      );
    } finally {
      session.close();
    }
  });

  it('rejects a negative attachment index before FETCH', async () => {
    const session = await openInbox([
      message({
        uid: 42,
        attachments: [
          { name: 'file.bin', contentType: 'application/octet-stream', bytes: 'file-bytes' },
        ],
      }),
    ]);
    try {
      await expect(session.client.getAttachment(42, -1)).rejects.toThrow(
        ATTACHMENT_INDEX_REQUIRED_MESSAGE,
      );
      await expect(session.client.getAttachment(42, 1.5)).rejects.toThrow(
        ATTACHMENT_INDEX_REQUIRED_MESSAGE,
      );
      await expect(session.client.getAttachment(42, undefined)).rejects.toThrow(
        ATTACHMENT_INDEX_REQUIRED_MESSAGE,
      );
      expect(session.fetchCommandCount()).toBe(0);
    } finally {
      session.close();
    }
  });

  it('rejects a uid below 1 before FETCH', async () => {
    const session = await openInbox([message({ uid: 42, textBody: 'Plain only' })]);
    try {
      await expect(session.client.fetchMessage(0)).rejects.toThrow(UID_REQUIRED_MESSAGE);
      await expect(session.client.getAttachment(0, 0)).rejects.toThrow(UID_REQUIRED_MESSAGE);
      expect(session.fetchCommandCount()).toBe(0);
    } finally {
      session.close();
    }
  });
});
