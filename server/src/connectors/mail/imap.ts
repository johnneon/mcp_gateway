import type { Duplex } from 'node:stream';
import { DuplexLineSession } from './duplex-lines.js';
import {
  IMAP_LOGIN_FAILED_MESSAGE,
  INVALID_ORDER_MESSAGE,
  INVALID_SEARCH_FILTER_MESSAGE,
  type ImapSearchFilter,
  type MessageHeaders,
  type MessagePage,
  type MessagePageQuery,
  type MessageSummary,
  type ReadMessageResult,
} from './types.js';

const ALLOWED_FILTER_KEYS = new Set(['unseen', 'from', 'subject', 'since']);

let tagCounter = 0;

function nextTag(): string {
  tagCounter += 1;
  return `A${String(tagCounter)}`;
}

function quoteAtom(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Validate and build IMAP SEARCH criteria from a narrow filter struct.
 * Rejects unknown keys and free-form search strings.
 */
export function buildImapSearchCriteria(filter: unknown): string {
  if (typeof filter !== 'object' || filter === null || Array.isArray(filter)) {
    throw new Error(INVALID_SEARCH_FILTER_MESSAGE);
  }
  for (const key of Object.keys(filter)) {
    if (!ALLOWED_FILTER_KEYS.has(key)) {
      throw new Error(INVALID_SEARCH_FILTER_MESSAGE);
    }
  }

  const typed = filter as ImapSearchFilter;
  const parts: string[] = [];
  if (typed.unseen === true) {
    parts.push('UNSEEN');
  }
  if (typeof typed.from === 'string' && typed.from.length > 0) {
    parts.push('FROM', quoteAtom(typed.from));
  }
  if (typeof typed.subject === 'string' && typed.subject.length > 0) {
    parts.push('SUBJECT', quoteAtom(typed.subject));
  }
  if (typeof typed.since === 'string' && typed.since.length > 0) {
    parts.push('SINCE', quoteAtom(typed.since));
  }
  if (parts.length === 0) {
    parts.push('ALL');
  }
  return parts.join(' ');
}

/**
 * Reject a free-form IMAP search string at the module API boundary.
 */
export function assertNotFreeFormSearch(value: unknown): void {
  if (typeof value === 'string') {
    throw new Error(INVALID_SEARCH_FILTER_MESSAGE);
  }
}

type MessageOrder = 'newest' | 'oldest';

function resolveMessageOrder(order: unknown): MessageOrder {
  if (order === undefined) {
    return 'newest';
  }
  if (order === 'newest' || order === 'oldest') {
    return order;
  }
  throw new Error(INVALID_ORDER_MESSAGE);
}

function resolveOffset(offset: unknown): number {
  if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0) {
    return 0;
  }
  return offset;
}

function resolveLimit(limit: unknown): number | null {
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1) {
    return null;
  }
  return limit;
}

function parsedDate(value: string): number | null {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return parsed;
}

function hasImapFlag(flags: string, name: string): boolean {
  const target = `\\${name}`.toLowerCase();
  return flags.split(/\s+/).some((flag) => flag.toLowerCase() === target);
}

function compareUid(order: MessageOrder, leftUid: number, rightUid: number): number {
  return order === 'newest' ? rightUid - leftUid : leftUid - rightUid;
}

/**
 * Unparseable dates are older than every date that parses.
 * Equal dates, including two unparseable dates, break by uid.
 */
function compareSummaries(
  order: MessageOrder,
  left: MessageSummary,
  right: MessageSummary,
): number {
  const leftDate = parsedDate(left.date);
  const rightDate = parsedDate(right.date);
  if (leftDate === null && rightDate === null) {
    return compareUid(order, left.uid, right.uid);
  }
  if (leftDate === null) {
    return order === 'newest' ? 1 : -1;
  }
  if (rightDate === null) {
    return order === 'newest' ? -1 : 1;
  }
  if (leftDate !== rightDate) {
    return order === 'newest' ? rightDate - leftDate : leftDate - rightDate;
  }
  return compareUid(order, left.uid, right.uid);
}

function parseHeaderBlock(raw: string): MessageHeaders {
  const headers: MessageHeaders = { from: '', to: '', subject: '', date: '' };
  const lines = raw.replace(/\r\n[ \t]/g, ' ').split(/\r?\n/);
  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon <= 0) {
      continue;
    }
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (name === 'from') {
      headers.from = value;
    } else if (name === 'to') {
      headers.to = value;
    } else if (name === 'subject') {
      headers.subject = value;
    } else if (name === 'date') {
      headers.date = value;
    }
  }
  return headers;
}

/**
 * Extract a text/plain body from a simple message body; skip attachment payloads.
 */
export function extractTextBody(rawBody: string): { textBody: string; attachmentNames: string[] } {
  const attachmentNames: string[] = [];
  const contentTypeMatch = /^Content-Type:\s*([^\r\n;]+)/im.exec(rawBody);
  const contentType = contentTypeMatch?.[1]?.trim().toLowerCase() ?? '';

  if (contentType.startsWith('multipart/')) {
    const boundaryMatch = /boundary="?([^";\r\n]+)"?/i.exec(rawBody);
    const boundary = boundaryMatch?.[1];
    if (boundary === undefined) {
      return { textBody: '', attachmentNames };
    }
    const parts = rawBody.split(`--${boundary}`);
    let textBody = '';
    for (const part of parts) {
      if (part.trim() === '' || part.trim() === '--') {
        continue;
      }
      const headerEnd = part.indexOf('\r\n\r\n');
      const headerEndAlt = part.indexOf('\n\n');
      const splitAt = headerEnd >= 0 ? headerEnd : headerEndAlt;
      if (splitAt < 0) {
        continue;
      }
      const partHeaders = part.slice(0, splitAt);
      let partBody = part.slice(splitAt);
      partBody = partBody.replace(/^\r?\n\r?\n/, '').replace(/\r?\n--\s*$/, '');
      const partType = /^Content-Type:\s*([^\r\n;]+)/im
        .exec(partHeaders)?.[1]
        ?.trim()
        .toLowerCase();
      const disposition = /^Content-Disposition:\s*([^\r\n;]+)/im
        .exec(partHeaders)?.[1]
        ?.trim()
        .toLowerCase();
      const filenameMatch =
        /filename\*?=(?:UTF-8''|")?([^";\r\n]+)"?/i.exec(partHeaders) ??
        /name="?([^";\r\n]+)"?/i.exec(partHeaders);
      if (disposition === 'attachment' || (filenameMatch !== null && partType !== 'text/plain')) {
        if (filenameMatch?.[1] !== undefined) {
          attachmentNames.push(filenameMatch[1].replace(/"/g, ''));
        }
        continue;
      }
      if ((partType === 'text/plain' || partType === undefined) && textBody.length === 0) {
        textBody = partBody.trim();
      }
    }
    return { textBody, attachmentNames };
  }

  return { textBody: rawBody.trim(), attachmentNames };
}

export type ImapClient = {
  login(user: string, password: string): Promise<void>;
  select(mailbox: string): Promise<void>;
  search(filter: ImapSearchFilter): Promise<number[]>;
  fetchSummaries(uids: readonly number[]): Promise<MessageSummary[]>;
  pageMessages(query?: MessagePageQuery): Promise<MessagePage>;
  fetchMessage(uid: number): Promise<ReadMessageResult>;
  logout(): Promise<void>;
  close(): void;
};

type FetchSection = {
  name: string;
  data: string;
};

type ParsedFetch = {
  uid: number;
  flags: string;
  sections: FetchSection[];
};

/**
 * IMAP client that speaks only over a provided duplex (no own TCP/TLS).
 */
export function createImapClient(duplex: Duplex): ImapClient {
  const session = new DuplexLineSession(duplex);
  let greetingDone = false;

  async function ensureGreeting(): Promise<void> {
    if (greetingDone) {
      return;
    }
    const line = await session.readLine();
    if (!line.startsWith('* OK') && !line.startsWith('* PREAUTH')) {
      throw new Error('Unexpected IMAP greeting');
    }
    greetingDone = true;
  }

  async function readResponseLine(): Promise<{ line: string; literals: string[] }> {
    const literals: string[] = [];
    let line = await session.readLine();
    const parts = [line];
    for (;;) {
      const literalMatch = /\{(\d+)\}$/.exec(line);
      if (literalMatch === null) {
        return { line: parts.join('\n'), literals };
      }
      const size = Number(literalMatch[1]);
      const data = await session.readExact(size);
      literals.push(data.toString('utf8'));
      line = await session.readLine();
      parts.push(line);
    }
  }

  async function runTagged(command: string): Promise<ParsedFetch[]> {
    await ensureGreeting();
    const tag = nextTag();
    session.writeLine(`${tag} ${command}`);
    const fetches: ParsedFetch[] = [];
    const searchUids: number[] = [];
    let searchSeen = false;

    for (;;) {
      const { line, literals } = await readResponseLine();
      if (line.startsWith(`${tag} `)) {
        if (line.startsWith(`${tag} OK`)) {
          if (searchSeen) {
            return searchUids.map((uid) => ({ uid, flags: '', sections: [] }));
          }
          return fetches;
        }
        if (line.startsWith(`${tag} NO`) || line.startsWith(`${tag} BAD`)) {
          throw new Error(line.slice(tag.length + 1));
        }
        throw new Error(line);
      }
      if (line.startsWith('* SEARCH')) {
        searchSeen = true;
        const rest = line.slice('* SEARCH'.length).trim();
        if (rest.length > 0) {
          for (const part of rest.split(/\s+/)) {
            const n = Number(part);
            if (Number.isInteger(n) && n > 0) {
              searchUids.push(n);
            }
          }
        }
        continue;
      }
      if (line.startsWith('* ') && line.includes('FETCH')) {
        fetches.push(parseFetchLine(line, literals));
      }
    }
  }

  return {
    async login(user, password) {
      try {
        await runTagged(`LOGIN ${quoteAtom(user)} ${quoteAtom(password)}`);
      } catch {
        throw new Error(IMAP_LOGIN_FAILED_MESSAGE);
      }
    },

    async select(mailbox) {
      await runTagged(`SELECT ${quoteAtom(mailbox)}`);
    },

    async search(filter) {
      assertNotFreeFormSearch(filter);
      const criteria = buildImapSearchCriteria(filter);
      const result = await runTagged(`UID SEARCH ${criteria}`);
      return result.map((entry) => entry.uid);
    },

    async fetchSummaries(uids) {
      if (uids.length === 0) {
        return [];
      }
      const set = uids.join(',');
      const fetches = await runTagged(
        `UID FETCH ${set} (FLAGS BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE)])`,
      );
      return fetches.map((fetch) => {
        const headerSection = fetch.sections.find((section) =>
          section.name.startsWith('BODY[HEADER.FIELDS'),
        );
        const headers = parseHeaderBlock(headerSection?.data ?? '');
        return {
          uid: fetch.uid,
          from: headers.from,
          to: headers.to,
          subject: headers.subject,
          date: headers.date,
          seen: hasImapFlag(fetch.flags, 'Seen'),
        } satisfies MessageSummary;
      });
    },

    async pageMessages(query = {}) {
      const order = resolveMessageOrder(query.order);
      const offset = resolveOffset(query.offset);
      const limit = resolveLimit(query.limit);
      const uids = await this.search(query.filter ?? {});
      const summaries = await this.fetchSummaries(uids);
      const sorted = [...summaries].sort((left, right) => compareSummaries(order, left, right));
      const page = limit === null ? sorted.slice(offset) : sorted.slice(offset, offset + limit);
      return {
        messages: page.map((summary) => ({ ...summary, unread: !summary.seen })),
        total: sorted.length,
        offset,
        limit,
      };
    },

    async fetchMessage(uid) {
      const fetches = await runTagged(
        `UID FETCH ${String(uid)} (BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE)] BODY.PEEK[TEXT])`,
      );
      const fetch = fetches[0];
      if (fetch === undefined) {
        throw new Error('Message not found');
      }
      const headerSection = fetch.sections.find((section) =>
        section.name.startsWith('BODY[HEADER.FIELDS'),
      );
      const textSection = fetch.sections.find((section) => section.name === 'BODY[TEXT]');
      const headers = parseHeaderBlock(headerSection?.data ?? '');
      const { textBody, attachmentNames } = extractTextBody(textSection?.data ?? '');
      return {
        headers,
        textBody,
        ...(attachmentNames.length > 0 ? { attachmentNames } : {}),
      } satisfies ReadMessageResult;
    },

    async logout() {
      try {
        await runTagged('LOGOUT');
      } catch {
        // ignore logout failures
      }
      session.close();
    },

    close() {
      session.close();
    },
  };
}

function parseFetchLine(line: string, literals: readonly string[]): ParsedFetch {
  const uidMatch = /UID (\d+)/.exec(line);
  const uid = uidMatch !== null ? Number(uidMatch[1]) : 0;
  const flagsMatch = /FLAGS \(([^)]*)\)/.exec(line);
  const flags = flagsMatch?.[1] ?? '';
  const sections: FetchSection[] = [];
  let literalIndex = 0;
  const sectionRegex = /BODY\[([^\]]*)\]\s*\{(\d+)\}/g;
  let match = sectionRegex.exec(line);
  while (match !== null) {
    const name = `BODY[${match[1] ?? ''}]`;
    const data = literals[literalIndex] ?? '';
    literalIndex += 1;
    sections.push({ name, data });
    match = sectionRegex.exec(line);
  }
  return { uid, flags, sections };
}
