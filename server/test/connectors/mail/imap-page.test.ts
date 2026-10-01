import { describe, expect, it } from 'vitest';
import {
  createImapClient,
  INVALID_ORDER_MESSAGE,
  type MessagePage,
} from '../../../src/connectors/mail/index.js';
import { createFakeImapDuplex, type FakeImapMessage } from './fake-imap.js';

const FIXTURE_USER = 'user@example.test';
const FIXTURE_PASSWORD = 'fixture-mail-password-UNIQUE';

function message(fields: {
  uid: number;
  date: string;
  seen?: boolean;
  to?: string;
  textBody?: string;
}): FakeImapMessage {
  return {
    uid: fields.uid,
    from: 'alice@example.test',
    to: fields.to ?? 'me@example.test',
    subject: `Subject ${String(fields.uid)}`,
    date: fields.date,
    seen: fields.seen ?? false,
    textBody: fields.textBody ?? `body-${String(fields.uid)}`,
  };
}

async function openInbox(messages: FakeImapMessage[]): Promise<{
  client: ReturnType<typeof createImapClient>;
  searchCommandCount: () => number;
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
    searchCommandCount: () => duplex.searchCommandCount,
    close: () => {
      client.close();
    },
  };
}

function uidsOf(page: MessagePage): number[] {
  return page.messages.map((entry) => entry.uid);
}

describe('mail protocol: date-sort paging over the duplex', () => {
  it('pages newest and oldest with an offset cut and includes to', async () => {
    const session = await openInbox([
      message({ uid: 5, date: '04 Jan 2024 00:00:00 +0000', seen: true }),
      message({ uid: 6, date: '01 Jan 2024 00:00:00 +0000' }),
      message({ uid: 7, date: '03 Jan 2024 00:00:00 +0000' }),
      message({ uid: 8, date: '02 Jan 2024 00:00:00 +0000' }),
    ]);
    try {
      const newest = await session.client.pageMessages({ limit: 2, offset: 0, order: 'newest' });
      expect(newest).toMatchObject({ total: 4, offset: 0, limit: 2 });
      expect(uidsOf(newest)).toEqual([5, 7]);
      expect(newest.messages[0]).toMatchObject({
        to: 'me@example.test',
        seen: true,
        unread: false,
      });
      expect(JSON.stringify(newest)).not.toContain('body-5');

      const newestRest = await session.client.pageMessages({
        limit: 2,
        offset: 2,
        order: 'newest',
      });
      expect(uidsOf(newestRest)).toEqual([8, 6]);
      expect(newestRest.total).toBe(4);

      const oldest = await session.client.pageMessages({ limit: 2, offset: 0, order: 'oldest' });
      expect(uidsOf(oldest)).toEqual([6, 8]);

      const oldestRest = await session.client.pageMessages({
        limit: 2,
        offset: 2,
        order: 'oldest',
      });
      expect(uidsOf(oldestRest)).toEqual([7, 5]);
      expect(oldestRest.messages.every((entry) => entry.to === 'me@example.test')).toBe(true);

      const omittedOrder = await session.client.pageMessages({});
      expect(omittedOrder.offset).toBe(0);
      expect(omittedOrder.limit).toBeNull();
      expect(uidsOf(omittedOrder)).toEqual([5, 7, 8, 6]);
    } finally {
      session.close();
    }
  });

  it('returns a null limit for the full remainder', async () => {
    const session = await openInbox([
      message({ uid: 1, date: '01 Jan 2024 00:00:00 +0000', seen: true }),
    ]);
    try {
      const zero = await session.client.pageMessages({ limit: 0, offset: -1 });
      expect(zero.offset).toBe(0);
      expect(zero.limit).toBeNull();
      expect(zero.total).toBe(1);
      expect(zero.messages).toHaveLength(1);

      const fraction = await session.client.pageMessages({ limit: 1.5, offset: -4 });
      expect(fraction.offset).toBe(0);
      expect(fraction.limit).toBeNull();
      expect(fraction.total).toBe(1);
      expect(fraction.messages).toHaveLength(1);
    } finally {
      session.close();
    }
  });

  it('honors a limit of 80 and orders equal dates by uid', async () => {
    const messages: FakeImapMessage[] = [];
    for (let uid = 1; uid <= 60; uid += 1) {
      messages.push(message({ uid, date: '01 Jan 2024 00:00:00 +0000' }));
    }
    const session = await openInbox(messages);
    try {
      const page = await session.client.pageMessages({ limit: 80, offset: 0, order: 'newest' });
      expect(page.limit).toBe(80);
      expect(page.offset).toBe(0);
      expect(page.total).toBe(60);
      expect(page.messages).toHaveLength(60);
      expect(page.messages[0]?.uid).toBe(60);
      expect(page.messages[59]?.uid).toBe(1);
      expect(uidsOf(page)).toEqual(Array.from({ length: 60 }, (_, index) => 60 - index));
    } finally {
      session.close();
    }
  });

  it('sorts unparseable dates as oldest', async () => {
    const session = await openInbox([
      message({ uid: 1, date: 'not-a-date' }),
      message({ uid: 2, date: '02 Jan 2024 00:00:00 +0000' }),
      message({ uid: 3, date: 'not-a-date' }),
    ]);
    try {
      const newest = await session.client.pageMessages({ order: 'newest' });
      expect(newest.limit).toBeNull();
      expect(newest.total).toBe(3);
      expect(uidsOf(newest)).toEqual([2, 3, 1]);

      const oldest = await session.client.pageMessages({ order: 'oldest' });
      expect(uidsOf(oldest)).toEqual([1, 3, 2]);
    } finally {
      session.close();
    }
  });

  it('rejects an unknown order before SEARCH', async () => {
    const session = await openInbox([message({ uid: 1, date: '01 Jan 2024 00:00:00 +0000' })]);
    try {
      await expect(session.client.pageMessages({ order: 'random' })).rejects.toThrow(
        INVALID_ORDER_MESSAGE,
      );
      expect(session.searchCommandCount()).toBe(0);
    } finally {
      session.close();
    }
  });
});
