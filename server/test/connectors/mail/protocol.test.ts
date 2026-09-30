import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createImapClient,
  createSmtpClient,
  IMAP_LOGIN_FAILED_MESSAGE,
  INVALID_SEARCH_FILTER_MESSAGE,
  SMTP_AUTH_FAILED_MESSAGE,
} from '../../../src/connectors/mail/index.js';
import { createFakeImapDuplex } from './fake-imap.js';
import { createFakeSmtpDuplex } from './fake-smtp.js';

const FIXTURE_USER = 'user@example.test';
const FIXTURE_PASSWORD = 'fixture-mail-password-UNIQUE';
const here = path.dirname(fileURLToPath(import.meta.url));
const mailSrc = path.join(here, '../../../src/connectors/mail');

describe('connector-gmail: Shared mail protocol is separate from the Gmail connector', () => {
  it('Shared module authenticates over a duplex without opening its own TCP socket', async () => {
    const duplex = createFakeImapDuplex({
      user: FIXTURE_USER,
      password: FIXTURE_PASSWORD,
      acceptLogin: true,
    });
    const client = createImapClient(duplex);
    await client.login(FIXTURE_USER, FIXTURE_PASSWORD);
    client.close();

    const sources = await Promise.all(
      ['imap.ts', 'smtp.ts', 'duplex-lines.ts', 'index.ts'].map((name) =>
        readFile(path.join(mailSrc, name), 'utf8'),
      ),
    );
    for (const source of sources) {
      expect(source).not.toMatch(/node:net/);
      expect(source).not.toMatch(/node:tls/);
      expect(source).not.toMatch(/\bcreateConnection\b/);
      expect(source).not.toMatch(/tls\.connect/);
      expect(source).not.toMatch(/\bnet\.connect\b/);
    }
  });
});

describe('mail protocol: IMAP LOGIN over duplex', () => {
  it('LOGIN succeeds with fixture credentials', async () => {
    const duplex = createFakeImapDuplex({
      user: FIXTURE_USER,
      password: FIXTURE_PASSWORD,
    });
    const client = createImapClient(duplex);
    await expect(client.login(FIXTURE_USER, FIXTURE_PASSWORD)).resolves.toBeUndefined();
    client.close();
  });

  it('LOGIN failure when fake IMAP rejects', async () => {
    const duplex = createFakeImapDuplex({
      user: FIXTURE_USER,
      password: FIXTURE_PASSWORD,
      acceptLogin: false,
    });
    const client = createImapClient(duplex);
    await expect(client.login(FIXTURE_USER, FIXTURE_PASSWORD)).rejects.toMatchObject({
      message: IMAP_LOGIN_FAILED_MESSAGE,
    });
    client.close();
  });
});

describe('mail protocol: SMTP AUTH over duplex', () => {
  it('AUTH succeeds with fixture credentials', async () => {
    const duplex = createFakeSmtpDuplex({
      user: FIXTURE_USER,
      password: FIXTURE_PASSWORD,
    });
    const client = createSmtpClient(duplex);
    await expect(client.auth(FIXTURE_USER, FIXTURE_PASSWORD)).resolves.toBeUndefined();
    client.close();
  });

  it('AUTH failure when fake SMTP rejects', async () => {
    const duplex = createFakeSmtpDuplex({
      user: FIXTURE_USER,
      password: FIXTURE_PASSWORD,
      acceptAuth: false,
    });
    const client = createSmtpClient(duplex);
    await expect(client.auth(FIXTURE_USER, FIXTURE_PASSWORD)).rejects.toMatchObject({
      message: SMTP_AUTH_FAILED_MESSAGE,
    });
    client.close();
  });
});

describe('mail protocol: SEARCH rejects free-form syntax at the module API', () => {
  it('rejects a free-form search string', async () => {
    const duplex = createFakeImapDuplex({
      user: FIXTURE_USER,
      password: FIXTURE_PASSWORD,
      messages: [],
    });
    const client = createImapClient(duplex);
    await client.login(FIXTURE_USER, FIXTURE_PASSWORD);
    await client.select('INBOX');
    await expect(
      client.search('OR FROM alice SUBJECT secret' as unknown as { from: string }),
    ).rejects.toMatchObject({
      message: INVALID_SEARCH_FILTER_MESSAGE,
    });
    expect(duplex.searchCommandCount).toBe(0);
    client.close();
  });

  it('rejects unknown filter keys', async () => {
    const duplex = createFakeImapDuplex({
      user: FIXTURE_USER,
      password: FIXTURE_PASSWORD,
    });
    const client = createImapClient(duplex);
    await client.login(FIXTURE_USER, FIXTURE_PASSWORD);
    await client.select('INBOX');
    await expect(
      client.search({ raw: 'BEFORE 1-Jan-2020' } as unknown as { from: string }),
    ).rejects.toMatchObject({
      message: INVALID_SEARCH_FILTER_MESSAGE,
    });
    expect(duplex.searchCommandCount).toBe(0);
    client.close();
  });
});

describe('mail protocol: FETCH returns headers and text without attachment bytes', () => {
  it('FETCH returns headers and text body without attachment bytes', async () => {
    const attachmentBytes = 'ATTACHMENT-BYTES-SHOULD-NOT-APPEAR';
    const duplex = createFakeImapDuplex({
      user: FIXTURE_USER,
      password: FIXTURE_PASSWORD,
      messages: [
        {
          uid: 7,
          from: 'alice@example.test',
          to: 'bob@example.test',
          subject: 'Hello',
          date: 'Mon, 1 Jan 2024 00:00:00 +0000',
          seen: true,
          textBody: 'Plain text body',
          attachmentName: 'file.bin',
          attachmentBytes,
        },
      ],
    });
    const client = createImapClient(duplex);
    await client.login(FIXTURE_USER, FIXTURE_PASSWORD);
    await client.select('INBOX');
    const message = await client.fetchMessage(7);
    expect(message.headers).toEqual({
      from: 'alice@example.test',
      to: 'bob@example.test',
      subject: 'Hello',
      date: 'Mon, 1 Jan 2024 00:00:00 +0000',
    });
    expect(message.textBody).toBe('Plain text body');
    expect(message.attachmentNames).toEqual(['file.bin']);
    expect(JSON.stringify(message)).not.toContain(attachmentBytes);
    client.close();
  });
});
