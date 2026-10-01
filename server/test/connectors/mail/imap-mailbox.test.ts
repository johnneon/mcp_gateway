import { describe, expect, it } from 'vitest';
import {
  createImapClient,
  INBOX_CANNOT_BE_DELETED_MESSAGE,
  INBOX_CANNOT_BE_RENAMED_MESSAGE,
  MAILBOX_NAME_REQUIRED_MESSAGE,
  type MailboxInfo,
} from '../../../src/connectors/mail/index.js';
import { createFakeImapDuplex, type FakeImapMessage, type FakeImapOptions } from './fake-imap.js';

const FIXTURE_USER = 'user@example.test';
const FIXTURE_PASSWORD = 'fixture-mail-password-UNIQUE';

function note(uid: number, subject: string): FakeImapMessage {
  return {
    uid,
    from: 'alice@example.test',
    to: 'me@example.test',
    subject,
    date: '01 Jan 2024 00:00:00 +0000',
    seen: false,
    textBody: subject,
  };
}

function sent(commands: readonly string[], verb: string): boolean {
  const prefix = `${verb.toUpperCase()} `;
  return commands.some((command) => command.toUpperCase().startsWith(prefix));
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

function useOf(listed: readonly MailboxInfo[], name: string): string | undefined {
  return listed.find((mailbox) => mailbox.name === name)?.specialUse;
}

describe('mail protocol: mailbox list, create, rename, and delete', () => {
  it('maps LIST attributes to special use and ignores other flags', async () => {
    const session = await open({
      mailboxes: [
        { name: 'Sent Items', attributes: ['\\Sent'] },
        { name: 'Drafts', attributes: ['\\Drafts'] },
        { name: 'Spam', attributes: ['\\Junk', '\\HasNoChildren'] },
        { name: 'Deleted Items', attributes: ['\\Trash'] },
        { name: 'Old Mail', attributes: ['\\Archive'] },
        { name: 'Starred', attributes: ['\\Flagged'] },
        { name: 'Everything', attributes: ['\\All'] },
        { name: 'Projects', attributes: [] },
        { name: 'Mixed', attributes: ['\\Trash', '\\Inbox'] },
      ],
    });
    try {
      const listed = await session.client.listMailboxes();
      const names = listed.map((mailbox) => mailbox.name);
      expect(new Set(names).size).toBe(names.length);
      expect(useOf(listed, 'INBOX')).toBe('inbox');
      expect(useOf(listed, 'Sent Items')).toBe('sent');
      expect(useOf(listed, 'Drafts')).toBe('drafts');
      expect(useOf(listed, 'Spam')).toBe('junk');
      expect(useOf(listed, 'Deleted Items')).toBe('trash');
      expect(useOf(listed, 'Old Mail')).toBe('archive');
      expect(useOf(listed, 'Starred')).toBe('flagged');
      expect(useOf(listed, 'Everything')).toBe('all');
      expect(useOf(listed, 'Projects')).toBe('none');
      expect(useOf(listed, 'Mixed')).toBe('inbox');
      expect(JSON.stringify(listed)).not.toContain('[Gmail]/');
    } finally {
      session.close();
    }
  });

  it('creates a mailbox and rejects an empty name before CREATE', async () => {
    const session = await open();
    try {
      const created = await session.client.createMailbox('Projects');
      expect(created).toEqual({ name: 'Projects' });
      const listed = await session.client.listMailboxes();
      expect(useOf(listed, 'Projects')).toBe('none');

      await expect(session.client.createMailbox('')).rejects.toThrow(MAILBOX_NAME_REQUIRED_MESSAGE);
      await expect(session.client.createMailbox('   ')).rejects.toThrow(
        MAILBOX_NAME_REQUIRED_MESSAGE,
      );
      const creates = session.commands().filter((command) => sent([command], 'CREATE'));
      expect(creates).toEqual(['CREATE "Projects"']);
      const after = await session.client.listMailboxes();
      expect(after.some((mailbox) => mailbox.name.trim().length === 0)).toBe(false);
    } finally {
      session.close();
    }
  });

  it('renames a mailbox and refuses inbox before RENAME', async () => {
    const session = await open({
      mailboxes: [
        { name: 'Projects', attributes: [], messages: [note(1, 'Keep me')] },
        { name: 'Incoming', attributes: ['\\Inbox'] },
      ],
    });
    try {
      const renamed = await session.client.renameMailbox('Projects', 'Archive');
      expect(renamed).toEqual({ name: 'Projects', newName: 'Archive' });
      const listed = await session.client.listMailboxes();
      expect(listed.some((mailbox) => mailbox.name === 'Archive')).toBe(true);
      expect(listed.some((mailbox) => mailbox.name === 'Projects')).toBe(false);
      await session.client.select('Archive');
      const page = await session.client.pageMessages();
      expect(page.messages.map((entry) => entry.subject)).toContain('Keep me');

      const beforeGuards = session.commands().length;
      await expect(session.client.renameMailbox('INBOX', 'Elsewhere')).rejects.toThrow(
        INBOX_CANNOT_BE_RENAMED_MESSAGE,
      );
      await expect(session.client.renameMailbox('inbox', 'Elsewhere')).rejects.toThrow(
        INBOX_CANNOT_BE_RENAMED_MESSAGE,
      );
      await expect(session.client.renameMailbox('Incoming', 'Elsewhere')).rejects.toThrow(
        INBOX_CANNOT_BE_RENAMED_MESSAGE,
      );
      await expect(session.client.renameMailbox('', 'Archive')).rejects.toThrow(
        MAILBOX_NAME_REQUIRED_MESSAGE,
      );
      await expect(session.client.renameMailbox('Archive', '   ')).rejects.toThrow(
        MAILBOX_NAME_REQUIRED_MESSAGE,
      );
      const later = session.commands().slice(beforeGuards);
      expect(sent(later, 'RENAME')).toBe(false);
      const names = (await session.client.listMailboxes()).map((mailbox) => mailbox.name);
      expect(names).toContain('INBOX');
      expect(names).toContain('Incoming');
      expect(names).not.toContain('Elsewhere');
    } finally {
      session.close();
    }
  });

  it('deletes a folder without moving its messages and leaves it on NO', async () => {
    const session = await open({
      mailboxes: [
        { name: 'Projects', attributes: [], messages: [note(3, 'Gone with the folder')] },
        { name: 'Deleted Items', attributes: ['\\Trash'], messages: [] },
      ],
    });
    try {
      const removed = await session.client.deleteMailbox('Projects');
      expect(removed).toEqual({ name: 'Projects' });
      const listed = await session.client.listMailboxes();
      expect(listed.some((mailbox) => mailbox.name === 'Projects')).toBe(false);
      await session.client.select('Deleted Items');
      const trash = await session.client.pageMessages();
      expect(trash.messages.map((entry) => entry.subject)).not.toContain('Gone with the folder');
      expect(sent(session.commands(), 'EXPUNGE')).toBe(false);

      await expect(session.client.deleteMailbox('INBOX')).rejects.toThrow(
        INBOX_CANNOT_BE_DELETED_MESSAGE,
      );
      await expect(session.client.deleteMailbox('inbox')).rejects.toThrow(
        INBOX_CANNOT_BE_DELETED_MESSAGE,
      );
      await expect(session.client.deleteMailbox('')).rejects.toThrow(MAILBOX_NAME_REQUIRED_MESSAGE);
      await expect(session.client.deleteMailbox('   ')).rejects.toThrow(
        MAILBOX_NAME_REQUIRED_MESSAGE,
      );
    } finally {
      session.close();
    }
  });

  it('does not rename or delete an inbox alias and leaves a folder when DELETE is NO', async () => {
    const refused = await open({
      deleteNo: 'cannot delete',
      mailboxes: [
        { name: 'Projects', attributes: [], messages: [note(1, 'Stay')] },
        { name: 'Incoming', attributes: ['\\Inbox'] },
      ],
    });
    try {
      const before = refused.commands().length;
      await expect(refused.client.deleteMailbox('Incoming')).rejects.toThrow(
        INBOX_CANNOT_BE_DELETED_MESSAGE,
      );
      expect(sent(refused.commands().slice(before), 'DELETE')).toBe(false);
      await expect(refused.client.deleteMailbox('Projects')).rejects.toThrow(/NO cannot delete/);
      const listed = await refused.client.listMailboxes();
      expect(listed.some((mailbox) => mailbox.name === 'Projects')).toBe(true);
      expect(listed.some((mailbox) => mailbox.name === 'Incoming')).toBe(true);
    } finally {
      refused.close();
    }
  });
});
