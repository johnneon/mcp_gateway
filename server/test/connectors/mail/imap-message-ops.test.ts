import { describe, expect, it } from 'vitest';
import {
  createImapClient,
  DESTINATION_MAILBOX_DOES_NOT_EXIST_MESSAGE,
  FLAG_IS_REQUIRED_MESSAGE,
  MESSAGE_NOT_FOUND_MESSAGE,
  TRASH_MAILBOX_IS_NOT_AVAILABLE_MESSAGE,
  UID_REQUIRED_MESSAGE,
} from '../../../src/connectors/mail/index.js';
import { createFakeImapDuplex, type FakeImapMessage, type FakeImapOptions } from './fake-imap.js';

const FIXTURE_USER = 'user@example.test';
const FIXTURE_PASSWORD = 'fixture-mail-password-UNIQUE';

function note(
  uid: number,
  subject: string,
  fields: Partial<FakeImapMessage> = {},
): FakeImapMessage {
  return {
    from: 'alice@example.test',
    to: 'me@example.test',
    date: '01 Jan 2024 00:00:00 +0000',
    seen: false,
    textBody: subject,
    ...fields,
    uid,
    subject,
  };
}

function sentUid(commands: readonly string[], verb: string): boolean {
  return commands.some((command) => command.toUpperCase().startsWith(`UID ${verb.toUpperCase()} `));
}

async function open(options: Omit<FakeImapOptions, 'user' | 'password'> = {}): Promise<{
  client: ReturnType<typeof createImapClient>;
  commands: () => readonly string[];
  close: () => void;
}> {
  const duplex = createFakeImapDuplex({
    user: FIXTURE_USER,
    password: FIXTURE_PASSWORD,
    ...options,
  });
  const client = createImapClient(duplex);
  await client.login(FIXTURE_USER, FIXTURE_PASSWORD);
  return {
    client,
    commands: () => duplex.commands,
    close: () => {
      client.close();
    },
  };
}

async function subjects(
  client: ReturnType<typeof createImapClient>,
  mailbox: string,
): Promise<string[]> {
  await client.select(mailbox);
  const page = await client.pageMessages();
  return page.messages.map((entry) => entry.subject);
}

describe('mail protocol: move, copy, flags, delete, and restore', () => {
  it('moves and copies a message and rejects a missing destination before the command', async () => {
    const session = await open({
      messages: [note(7, 'Move me')],
      mailboxes: [{ name: 'Archive', attributes: [], messages: [] }],
    });
    try {
      const moved = await session.client.moveMessage(7, 'INBOX', 'Archive');
      expect(moved).toEqual({ uid: 7, source: 'INBOX', destination: 'Archive' });
      expect(await subjects(session.client, 'INBOX')).not.toContain('Move me');
      const archived = await subjects(session.client, 'Archive');
      expect(archived).toContain('Move me');

      await session.client.select('Archive');
      const page = await session.client.pageMessages();
      expect(page.messages[0]).toMatchObject({
        from: 'alice@example.test',
        to: 'me@example.test',
        subject: 'Move me',
      });
    } finally {
      session.close();
    }

    const copySession = await open({
      messages: [note(7, 'Copy me')],
      mailboxes: [{ name: 'Archive', attributes: [], messages: [] }],
    });
    try {
      const copied = await copySession.client.copyMessage(7, 'INBOX', 'Archive');
      expect(copied).toEqual({ uid: 7, source: 'INBOX', destination: 'Archive' });
      await copySession.client.select('INBOX');
      const source = await copySession.client.pageMessages();
      expect(source.messages.map((entry) => entry.uid)).toContain(7);
      expect(await subjects(copySession.client, 'Archive')).toContain('Copy me');

      const before = copySession.commands().length;
      await expect(copySession.client.moveMessage(7, 'INBOX', 'Missing')).rejects.toThrow(
        DESTINATION_MAILBOX_DOES_NOT_EXIST_MESSAGE,
      );
      await expect(copySession.client.copyMessage(7, 'INBOX', 'Missing')).rejects.toThrow(
        DESTINATION_MAILBOX_DOES_NOT_EXIST_MESSAGE,
      );
      await expect(copySession.client.moveMessage(0, 'INBOX', 'Archive')).rejects.toThrow(
        UID_REQUIRED_MESSAGE,
      );
      await expect(copySession.client.copyMessage(0, 'INBOX', 'Archive')).rejects.toThrow(
        UID_REQUIRED_MESSAGE,
      );
      await expect(copySession.client.moveMessage(99, 'INBOX', 'Archive')).rejects.toThrow(
        MESSAGE_NOT_FOUND_MESSAGE,
      );
      const later = copySession.commands().slice(before);
      expect(sentUid(later, 'MOVE')).toBe(false);
      expect(sentUid(later, 'COPY')).toBe(false);
      expect(await subjects(copySession.client, 'INBOX')).toContain('Copy me');
    } finally {
      copySession.close();
    }
  });

  it('adds, removes, and leaves omitted flags, and rejects a call with no flag', async () => {
    const session = await open({
      messages: [note(7, 'Flag me', { seen: false, flagged: false })],
    });
    try {
      const set = await session.client.updateFlags(7, 'INBOX', { seen: true, flagged: true });
      expect(set).toEqual({ uid: 7, seen: true, flagged: true });
      await session.client.select('INBOX');
      let page = await session.client.pageMessages();
      expect(page.messages[0]).toMatchObject({ uid: 7, seen: true, unread: false });

      const cleared = await session.client.updateFlags(7, 'INBOX', { seen: false, flagged: false });
      expect(cleared).toEqual({ uid: 7, seen: false, flagged: false });
      page = await session.client.pageMessages();
      expect(page.messages[0]).toMatchObject({ seen: false, unread: true });

      await session.client.updateFlags(7, 'INBOX', { seen: true });
      const flaggedOnly = await session.client.updateFlags(7, 'INBOX', { flagged: true });
      expect(flaggedOnly).toEqual({ uid: 7, seen: true, flagged: true });
      const seenCleared = await session.client.updateFlags(7, 'INBOX', { seen: false });
      expect(seenCleared).toEqual({ uid: 7, seen: false, flagged: true });

      const before = session.commands().length;
      await expect(session.client.updateFlags(7, 'INBOX', {})).rejects.toThrow(
        FLAG_IS_REQUIRED_MESSAGE,
      );
      expect(sentUid(session.commands().slice(before), 'STORE')).toBe(false);
      const after = await session.client.updateFlags(7, 'INBOX', { seen: false });
      expect(after.flagged).toBe(true);
    } finally {
      session.close();
    }
  });

  it('moves mail into and out of a trash mailbox that is not a provider folder name', async () => {
    const session = await open({
      messages: [note(7, 'Delete me')],
      mailboxes: [
        { name: 'Deleted Items', attributes: ['\\Trash'], messages: [note(9, 'Restore me')] },
      ],
    });
    try {
      const removed = await session.client.deleteMessage(7, 'INBOX');
      expect(removed).toEqual({ uid: 7, source: 'INBOX', destination: 'Deleted Items' });
      expect(JSON.stringify(removed)).not.toContain('[Gmail]/');
      expect(await subjects(session.client, 'INBOX')).not.toContain('Delete me');
      expect(await subjects(session.client, 'Deleted Items')).toEqual(
        expect.arrayContaining(['Delete me', 'Restore me']),
      );
      expect(
        session.commands().some((command) => command.toUpperCase().startsWith('EXPUNGE')),
      ).toBe(false);
      expect(
        session.commands().some((command) => command.toUpperCase().includes('\\DELETED')),
      ).toBe(false);

      const restored = await session.client.restoreMessage(9);
      expect(restored).toEqual({ uid: 9, source: 'Deleted Items', destination: 'INBOX' });
      expect(await subjects(session.client, 'INBOX')).toContain('Restore me');
      expect(await subjects(session.client, 'Deleted Items')).not.toContain('Restore me');

      const before = session.commands().length;
      await expect(session.client.restoreMessage(9, 'Missing')).rejects.toThrow(
        DESTINATION_MAILBOX_DOES_NOT_EXIST_MESSAGE,
      );
      await expect(session.client.restoreMessage(0)).rejects.toThrow(UID_REQUIRED_MESSAGE);
      expect(sentUid(session.commands().slice(before), 'MOVE')).toBe(false);
    } finally {
      session.close();
    }

    const noTrash = await open({ messages: [note(7, 'Stay')] });
    try {
      const before = noTrash.commands().length;
      await expect(noTrash.client.deleteMessage(7, 'INBOX')).rejects.toThrow(
        TRASH_MAILBOX_IS_NOT_AVAILABLE_MESSAGE,
      );
      await expect(noTrash.client.restoreMessage(7)).rejects.toThrow(
        TRASH_MAILBOX_IS_NOT_AVAILABLE_MESSAGE,
      );
      expect(sentUid(noTrash.commands().slice(before), 'MOVE')).toBe(false);
      expect(await subjects(noTrash.client, 'INBOX')).toContain('Stay');
    } finally {
      noTrash.close();
    }
  });

  it('leaves state unchanged when MOVE, COPY, STORE, or attachment fetch replies NO', async () => {
    const moveSession = await open({
      messages: [note(7, 'Stay')],
      mailboxes: [{ name: 'Archive', attributes: [], messages: [] }],
      moveNo: 'move failed',
    });
    try {
      await expect(moveSession.client.moveMessage(7, 'INBOX', 'Archive')).rejects.toThrow(
        /NO move failed/,
      );
      expect(await subjects(moveSession.client, 'INBOX')).toContain('Stay');
      expect(await subjects(moveSession.client, 'Archive')).toEqual([]);
    } finally {
      moveSession.close();
    }

    const copySession = await open({
      messages: [note(7, 'Stay')],
      mailboxes: [{ name: 'Archive', attributes: [], messages: [] }],
      copyNo: 'copy failed',
    });
    try {
      await expect(copySession.client.copyMessage(7, 'INBOX', 'Archive')).rejects.toThrow(
        /NO copy failed/,
      );
      expect(await subjects(copySession.client, 'INBOX')).toContain('Stay');
      expect(await subjects(copySession.client, 'Archive')).toEqual([]);
    } finally {
      copySession.close();
    }

    const storeSession = await open({
      messages: [note(7, 'Stay', { seen: false, flagged: false })],
      storeNo: 'store failed',
    });
    try {
      await expect(storeSession.client.updateFlags(7, 'INBOX', { seen: true })).rejects.toThrow(
        /NO store failed/,
      );
      await storeSession.client.select('INBOX');
      const page = await storeSession.client.pageMessages();
      expect(page.messages[0]).toMatchObject({ seen: false, unread: true });
    } finally {
      storeSession.close();
    }

    const fetchSession = await open({
      messages: [
        note(42, 'File', {
          seen: false,
          attachments: [
            { name: 'file.bin', contentType: 'application/octet-stream', bytes: 'file-bytes' },
          ],
        }),
      ],
      attachmentNo: 'fetch failed',
    });
    try {
      await expect(fetchSession.client.getAttachment(42, 0)).rejects.toThrow(/NO fetch failed/);
      await fetchSession.client.select('INBOX');
      const page = await fetchSession.client.pageMessages();
      expect(page.messages[0]).toMatchObject({ uid: 42, seen: false });
    } finally {
      fetchSession.close();
    }
  });
});
