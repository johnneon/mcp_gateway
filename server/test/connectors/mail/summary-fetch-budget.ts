import { expect } from 'vitest';
import type { FakeImapMessage } from './fake-imap.js';

export const SUMMARY_FETCH_BUDGET_BYTES = 4096;

export function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

export function largeInbox(): FakeImapMessage[] {
  const messages: FakeImapMessage[] = [];
  for (let uid = 1; uid <= 1100; uid += 1) {
    let date = '01 Jan 2024 00:00:00 +0000';
    if (uid === 1100) {
      date = '02 Feb 2024 00:00:00 +0000';
    } else if (uid === 1099) {
      date = '01 Feb 2024 00:00:00 +0000';
    }
    messages.push({
      uid,
      from: 'alice@example.test',
      to: 'me@example.test',
      subject: `Subject ${String(uid)}`,
      date,
      seen: false,
      textBody: `large-body-${String(uid)}`,
    });
  }
  return messages;
}

export function filteredAliceBobInbox(): FakeImapMessage[] {
  const messages: FakeImapMessage[] = [];
  for (let i = 0; i <= 399; i += 1) {
    const aliceUid = 1000000001 + 2 * i;
    const bobUid = 1000000002 + 2 * i;
    let aliceDate = '01 Jan 2024 00:00:00 +0000';
    if (aliceUid === 1000000799) {
      aliceDate = '02 Feb 2024 00:00:00 +0000';
    } else if (aliceUid === 1000000797) {
      aliceDate = '01 Feb 2024 00:00:00 +0000';
    }
    messages.push({
      uid: aliceUid,
      from: 'alice@example.test',
      to: 'me@example.test',
      subject: `Alice ${String(i)}`,
      date: aliceDate,
      seen: false,
      textBody: `alice-body-${String(aliceUid)}`,
    });
    messages.push({
      uid: bobUid,
      from: 'bob@example.test',
      to: 'me@example.test',
      subject: `Neighbor ${String(i)}`,
      date: '01 Jan 2024 00:00:00 +0000',
      seen: false,
      textBody: `bob-body-${String(bobUid)}`,
    });
  }
  return messages;
}

export function newestLargeUids(): number[] {
  const uids = [1100, 1099];
  for (let uid = 1098; uid >= 1; uid -= 1) {
    uids.push(uid);
  }
  return uids;
}

export function aliceUidsInSearchOrder(): number[] {
  const uids: number[] = [];
  for (let i = 0; i <= 399; i += 1) {
    uids.push(1000000001 + 2 * i);
  }
  return uids;
}

export function newestAliceUids(): number[] {
  const uids = [1000000799, 1000000797];
  for (let uid = 1000000795; uid >= 1000000001; uid -= 2) {
    uids.push(uid);
  }
  return uids;
}

function uidSetOf(command: string): string {
  const match = /^UID FETCH\s+(\S+)\s+/i.exec(command);
  if (match?.[1] === undefined) {
    throw new Error('expected UID FETCH to name a set');
  }
  return match[1];
}

export function expectUidFetchesWithinBudget(
  commands: readonly string[],
  expectedUids: readonly number[],
): void {
  const fetches = commands.filter((command) => command.toUpperCase().startsWith('UID FETCH '));
  expect(fetches.length).toBeGreaterThan(1);
  const named: number[] = [];
  for (const command of fetches) {
    expect(utf8Bytes(command)).toBeLessThanOrEqual(SUMMARY_FETCH_BUDGET_BYTES);
    expect(command.includes('1:*')).toBe(false);
    expect(command).not.toMatch(/\d+:/);
    const set = uidSetOf(command);
    expect(set.includes(':')).toBe(false);
    expect(set.includes('*')).toBe(false);
    for (const part of set.split(',')) {
      expect(part).toMatch(/^\d+$/);
      named.push(Number(part));
    }
  }
  expect(named).toEqual([...expectedUids]);
}
