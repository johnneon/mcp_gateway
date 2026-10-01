import type { Duplex } from 'node:stream';
import { DuplexLineSession } from './duplex-lines.js';
import {
  ATTACHMENT_INDEX_REQUIRED_MESSAGE,
  ATTACHMENT_NOT_FOUND_MESSAGE,
  IMAP_LOGIN_FAILED_MESSAGE,
  INVALID_ORDER_MESSAGE,
  INVALID_SEARCH_FILTER_MESSAGE,
  DESTINATION_MAILBOX_DOES_NOT_EXIST_MESSAGE,
  FLAG_IS_REQUIRED_MESSAGE,
  INBOX_CANNOT_BE_DELETED_MESSAGE,
  INBOX_CANNOT_BE_RENAMED_MESSAGE,
  MAILBOX_NAME_REQUIRED_MESSAGE,
  MESSAGE_NOT_FOUND_MESSAGE,
  TRASH_MAILBOX_IS_NOT_AVAILABLE_MESSAGE,
  UID_REQUIRED_MESSAGE,
  type AttachmentDownload,
  type ImapSearchFilter,
  type MailboxInfo,
  type MailboxSpecialUse,
  type MessageAttachment,
  type MessageFlagState,
  type MessageLocation,
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

type ParsedAttachment = MessageAttachment & {
  bytes: Buffer;
};

type ParsedMessageBody = {
  textBody: string;
  htmlBody: string;
  attachments: ParsedAttachment[];
};

function headerField(headers: string, name: string): string {
  const match = new RegExp(`^${name}:\\s*([^\\r\\n]*)`, 'im').exec(headers);
  return match?.[1]?.trim() ?? '';
}

function mediaType(headers: string): string {
  const raw = headerField(headers, 'Content-Type');
  return raw.split(';')[0]?.trim().toLowerCase() ?? '';
}

function contentDisposition(headers: string): string {
  const raw = headerField(headers, 'Content-Disposition');
  return raw.split(';')[0]?.trim().toLowerCase() ?? '';
}

function boundaryOf(headers: string): string | undefined {
  const raw = headerField(headers, 'Content-Type');
  const match = /boundary="?([^";\r\n]+)"?/i.exec(raw);
  return match?.[1];
}

function partName(headers: string): string {
  const filename = /filename\*?=(?:UTF-8''|")?([^";\r\n]+)"?/i.exec(headers);
  if (filename?.[1] !== undefined) {
    return filename[1].replace(/"/g, '');
  }
  const named = /(?:^|[;\s])name="?([^";\r\n]+)"?/im.exec(headers);
  if (named?.[1] !== undefined) {
    return named[1].replace(/"/g, '');
  }
  return '';
}

function splitHeaderBody(raw: string): { headers: string; body: string } {
  const crlf = raw.indexOf('\r\n\r\n');
  const lf = raw.indexOf('\n\n');
  if (crlf >= 0 && (lf < 0 || crlf <= lf)) {
    return { headers: raw.slice(0, crlf), body: raw.slice(crlf + 4) };
  }
  if (lf >= 0) {
    return { headers: raw.slice(0, lf), body: raw.slice(lf + 2) };
  }
  return { headers: '', body: raw };
}

function splitMultipart(body: string, boundary: string): string[] {
  const parts: string[] = [];
  for (const chunk of body.split(`--${boundary}`)) {
    let part = chunk;
    if (part.startsWith('\r\n')) {
      part = part.slice(2);
    } else if (part.startsWith('\n')) {
      part = part.slice(1);
    }
    if (part.endsWith('\r\n')) {
      part = part.slice(0, -2);
    } else if (part.endsWith('\n')) {
      part = part.slice(0, -1);
    }
    const trimmed = part.trim();
    if (trimmed === '' || trimmed === '--' || trimmed.startsWith('--')) {
      continue;
    }
    parts.push(part);
  }
  return parts;
}

function decodePartBody(headers: string, body: string): Buffer {
  const encoding = headerField(headers, 'Content-Transfer-Encoding').toLowerCase();
  if (encoding === 'base64') {
    return Buffer.from(body.replace(/\s+/g, ''), 'base64');
  }
  return Buffer.from(body, 'utf8');
}

function parseMessageBody(raw: string): ParsedMessageBody {
  const parsed: ParsedMessageBody = { textBody: '', htmlBody: '', attachments: [] };
  let textTaken = false;
  let htmlTaken = false;

  const walk = (entity: string): void => {
    const { headers, body } = splitHeaderBody(entity);
    const type = mediaType(headers);
    if (type.startsWith('multipart/')) {
      const boundary = boundaryOf(headers);
      if (boundary === undefined) {
        return;
      }
      for (const part of splitMultipart(body, boundary)) {
        walk(part);
      }
      return;
    }
    const bytes = decodePartBody(headers, body);
    const disposition = contentDisposition(headers);
    if (disposition !== 'attachment' && (type === 'text/plain' || type === '') && !textTaken) {
      parsed.textBody = bytes.toString('utf8').trim();
      textTaken = true;
      return;
    }
    if (disposition !== 'attachment' && type === 'text/html' && !htmlTaken) {
      parsed.htmlBody = bytes.toString('utf8').trim();
      htmlTaken = true;
      return;
    }
    const contentType = type.length > 0 ? type : 'application/octet-stream';
    parsed.attachments.push({
      index: parsed.attachments.length,
      name: partName(headers),
      contentType,
      size: bytes.length,
      bytes,
    });
  };

  if (!/^content-type:/im.test(raw)) {
    parsed.textBody = raw.trim();
    return parsed;
  }
  walk(raw);
  return parsed;
}

/**
 * Extract a text/plain body from a simple message body; skip attachment payloads.
 */
export function extractTextBody(rawBody: string): { textBody: string; attachmentNames: string[] } {
  const parsed = parseMessageBody(rawBody);
  return {
    textBody: parsed.textBody,
    attachmentNames: parsed.attachments.map((part) => part.name).filter((name) => name.length > 0),
  };
}

function requireUid(uid: unknown): number {
  if (typeof uid !== 'number' || !Number.isInteger(uid) || uid < 1) {
    throw new Error(UID_REQUIRED_MESSAGE);
  }
  return uid;
}

function requireAttachmentIndex(index: unknown): number {
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
    throw new Error(ATTACHMENT_INDEX_REQUIRED_MESSAGE);
  }
  return index;
}

const SPECIAL_USE_FLAGS: ReadonlyArray<readonly [string, MailboxSpecialUse]> = [
  ['\\Inbox', 'inbox'],
  ['\\Sent', 'sent'],
  ['\\Drafts', 'drafts'],
  ['\\Junk', 'junk'],
  ['\\Trash', 'trash'],
  ['\\Archive', 'archive'],
  ['\\Flagged', 'flagged'],
  ['\\All', 'all'],
];

function specialUseFromAttributes(attributes: readonly string[]): MailboxSpecialUse {
  const folded = attributes.map((attribute) => attribute.toLowerCase());
  for (const [flag, use] of SPECIAL_USE_FLAGS) {
    if (folded.includes(flag.toLowerCase())) {
      return use;
    }
  }
  return 'none';
}

function isBlankMailboxName(name: string): boolean {
  return name.trim().length === 0;
}

function isInboxMailboxName(name: string): boolean {
  return name.toUpperCase() === 'INBOX';
}

function unquoteImap(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return trimmed;
}

function parseListLine(line: string): { name: string; attributes: string[] } | undefined {
  const match = /^\* LIST \(([^)]*)\)\s+\S+\s+(.+)$/.exec(line);
  if (match === null) {
    return undefined;
  }
  const attributes = (match[1] ?? '').split(/\s+/).filter((part) => part.length > 0);
  return { name: unquoteImap(match[2] ?? ''), attributes };
}

function attachmentMetadata(part: ParsedAttachment): MessageAttachment {
  return {
    index: part.index,
    name: part.name,
    contentType: part.contentType,
    size: part.size,
  };
}

export type ImapClient = {
  login(user: string, password: string): Promise<void>;
  select(mailbox: string): Promise<void>;
  search(filter: ImapSearchFilter): Promise<number[]>;
  fetchSummaries(uids: readonly number[]): Promise<MessageSummary[]>;
  pageMessages(query?: MessagePageQuery): Promise<MessagePage>;
  fetchMessage(uid: unknown): Promise<ReadMessageResult>;
  getAttachment(uid: unknown, index: unknown): Promise<AttachmentDownload>;
  listMailboxes(): Promise<MailboxInfo[]>;
  createMailbox(name: string): Promise<{ name: string }>;
  renameMailbox(name: string, newName: string): Promise<{ name: string; newName: string }>;
  deleteMailbox(name: string): Promise<{ name: string }>;
  moveMessage(uid: unknown, source: string, destination: string): Promise<MessageLocation>;
  copyMessage(uid: unknown, source: string, destination: string): Promise<MessageLocation>;
  deleteMessage(uid: unknown, source: string): Promise<MessageLocation>;
  restoreMessage(uid: unknown, destination?: string): Promise<MessageLocation>;
  updateFlags(
    uid: unknown,
    mailbox: string,
    flags: { seen?: unknown; flagged?: unknown },
  ): Promise<MessageFlagState>;
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

type ListedMailbox = {
  name: string;
  attributes: string[];
};

type TaggedResult = {
  fetches: ParsedFetch[];
  listed: ListedMailbox[];
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

  async function runTagged(command: string): Promise<TaggedResult> {
    await ensureGreeting();
    const tag = nextTag();
    session.writeLine(`${tag} ${command}`);
    const fetches: ParsedFetch[] = [];
    const listed: ListedMailbox[] = [];
    const searchUids: number[] = [];
    let searchSeen = false;

    for (;;) {
      const { line, literals } = await readResponseLine();
      if (line.startsWith(`${tag} `)) {
        if (line.startsWith(`${tag} OK`)) {
          if (searchSeen) {
            return {
              fetches: searchUids.map((uid) => ({ uid, flags: '', sections: [] })),
              listed,
            };
          }
          return { fetches, listed };
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
      if (line.startsWith('* LIST ')) {
        const parsed = parseListLine(line);
        if (parsed !== undefined) {
          listed.push(parsed);
        }
        continue;
      }
      if (line.startsWith('* ') && line.includes('FETCH')) {
        fetches.push(parseFetchLine(line, literals));
      }
    }
  }

  async function loadParsed(uid: number): Promise<{
    headers: MessageHeaders;
    textBody: string;
    htmlBody: string;
    attachments: ParsedAttachment[];
  }> {
    const { fetches } = await runTagged(
      `UID FETCH ${String(uid)} (BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE)] BODY.PEEK[TEXT])`,
    );
    const fetch = fetches[0];
    if (fetch === undefined) {
      throw new Error(MESSAGE_NOT_FOUND_MESSAGE);
    }
    const headerSection = fetch.sections.find((section) =>
      section.name.startsWith('BODY[HEADER.FIELDS'),
    );
    const textSection = fetch.sections.find((section) => section.name === 'BODY[TEXT]');
    const body = parseMessageBody(textSection?.data ?? '');
    return {
      headers: parseHeaderBlock(headerSection?.data ?? ''),
      textBody: body.textBody,
      htmlBody: body.htmlBody,
      attachments: body.attachments,
    };
  }

  async function listMailboxes(): Promise<MailboxInfo[]> {
    const { listed } = await runTagged('LIST "" "*"');
    return listed.map((entry) => ({
      name: entry.name,
      specialUse: specialUseFromAttributes(entry.attributes),
    }));
  }

  async function createMailbox(name: string): Promise<{ name: string }> {
    if (isBlankMailboxName(name)) {
      throw new Error(MAILBOX_NAME_REQUIRED_MESSAGE);
    }
    await runTagged(`CREATE ${quoteAtom(name)}`);
    return { name };
  }

  async function renameMailbox(
    name: string,
    newName: string,
  ): Promise<{ name: string; newName: string }> {
    if (isBlankMailboxName(name) || isBlankMailboxName(newName)) {
      throw new Error(MAILBOX_NAME_REQUIRED_MESSAGE);
    }
    if (isInboxMailboxName(name)) {
      throw new Error(INBOX_CANNOT_BE_RENAMED_MESSAGE);
    }
    const listed = await listMailboxes();
    const source = listed.find((mailbox) => mailbox.name === name);
    if (source?.specialUse === 'inbox') {
      throw new Error(INBOX_CANNOT_BE_RENAMED_MESSAGE);
    }
    await runTagged(`RENAME ${quoteAtom(name)} ${quoteAtom(newName)}`);
    return { name, newName };
  }

  async function deleteMailbox(name: string): Promise<{ name: string }> {
    if (isBlankMailboxName(name)) {
      throw new Error(MAILBOX_NAME_REQUIRED_MESSAGE);
    }
    if (isInboxMailboxName(name)) {
      throw new Error(INBOX_CANNOT_BE_DELETED_MESSAGE);
    }
    const listed = await listMailboxes();
    const source = listed.find((mailbox) => mailbox.name === name);
    if (source?.specialUse === 'inbox') {
      throw new Error(INBOX_CANNOT_BE_DELETED_MESSAGE);
    }
    await runTagged(`DELETE ${quoteAtom(name)}`);
    return { name };
  }

  async function selectMailbox(mailbox: string): Promise<void> {
    await runTagged(`SELECT ${quoteAtom(mailbox)}`);
  }

  async function uidsInSelected(): Promise<number[]> {
    const result = await runTagged('UID SEARCH ALL');
    return result.fetches.map((entry) => entry.uid);
  }

  async function requirePresent(uid: number): Promise<void> {
    const uids = await uidsInSelected();
    if (!uids.includes(uid)) {
      throw new Error(MESSAGE_NOT_FOUND_MESSAGE);
    }
  }

  async function requireDestination(name: string): Promise<void> {
    const listed = await listMailboxes();
    if (!listed.some((mailbox) => mailbox.name === name)) {
      throw new Error(DESTINATION_MAILBOX_DOES_NOT_EXIST_MESSAGE);
    }
  }

  async function trashMailbox(): Promise<MailboxInfo | undefined> {
    const listed = await listMailboxes();
    return listed.find((mailbox) => mailbox.specialUse === 'trash');
  }

  async function moveMessage(
    uid: unknown,
    source: string,
    destination: string,
  ): Promise<MessageLocation> {
    const parsedUid = requireUid(uid);
    await requireDestination(destination);
    await selectMailbox(source);
    await requirePresent(parsedUid);
    await runTagged(`UID MOVE ${String(parsedUid)} ${quoteAtom(destination)}`);
    return { uid: parsedUid, source, destination };
  }

  async function copyMessage(
    uid: unknown,
    source: string,
    destination: string,
  ): Promise<MessageLocation> {
    const parsedUid = requireUid(uid);
    await requireDestination(destination);
    await selectMailbox(source);
    await requirePresent(parsedUid);
    await runTagged(`UID COPY ${String(parsedUid)} ${quoteAtom(destination)}`);
    return { uid: parsedUid, source, destination };
  }

  async function deleteMessage(uid: unknown, source: string): Promise<MessageLocation> {
    requireUid(uid);
    const trash = await trashMailbox();
    if (trash === undefined) {
      throw new Error(TRASH_MAILBOX_IS_NOT_AVAILABLE_MESSAGE);
    }
    return moveMessage(uid, source, trash.name);
  }

  async function restoreMessage(uid: unknown, destination?: string): Promise<MessageLocation> {
    requireUid(uid);
    const trash = await trashMailbox();
    if (trash === undefined) {
      throw new Error(TRASH_MAILBOX_IS_NOT_AVAILABLE_MESSAGE);
    }
    const target =
      destination === undefined || destination.trim().length === 0 ? 'INBOX' : destination;
    const listed = await listMailboxes();
    if (!listed.some((mailbox) => mailbox.name === target)) {
      throw new Error(DESTINATION_MAILBOX_DOES_NOT_EXIST_MESSAGE);
    }
    return moveMessage(uid, trash.name, target);
  }

  async function readFlags(uid: number): Promise<{ seen: boolean; flagged: boolean }> {
    const { fetches } = await runTagged(`UID FETCH ${String(uid)} (FLAGS)`);
    const fetch = fetches[0];
    if (fetch === undefined) {
      throw new Error(MESSAGE_NOT_FOUND_MESSAGE);
    }
    return {
      seen: hasImapFlag(fetch.flags, 'Seen'),
      flagged: hasImapFlag(fetch.flags, 'Flagged'),
    };
  }

  async function updateFlags(
    uid: unknown,
    mailbox: string,
    flags: { seen?: unknown; flagged?: unknown },
  ): Promise<MessageFlagState> {
    const parsedUid = requireUid(uid);
    const seen = flags.seen;
    const flagged = flags.flagged;
    if (typeof seen !== 'boolean' && typeof flagged !== 'boolean') {
      throw new Error(FLAG_IS_REQUIRED_MESSAGE);
    }
    await selectMailbox(mailbox);
    await requirePresent(parsedUid);
    if (typeof seen === 'boolean') {
      const op = seen ? '+' : '-';
      await runTagged(`UID STORE ${String(parsedUid)} ${op}FLAGS (\\Seen)`);
    }
    if (typeof flagged === 'boolean') {
      const op = flagged ? '+' : '-';
      await runTagged(`UID STORE ${String(parsedUid)} ${op}FLAGS (\\Flagged)`);
    }
    const current = await readFlags(parsedUid);
    return { uid: parsedUid, seen: current.seen, flagged: current.flagged };
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
      return result.fetches.map((entry) => entry.uid);
    },

    async fetchSummaries(uids) {
      if (uids.length === 0) {
        return [];
      }
      const set = uids.join(',');
      const { fetches } = await runTagged(
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
      const parsedUid = requireUid(uid);
      const loaded = await loadParsed(parsedUid);
      const attachmentNames = loaded.attachments
        .map((part) => part.name)
        .filter((name) => name.length > 0);
      return {
        headers: loaded.headers,
        textBody: loaded.textBody,
        htmlBody: loaded.htmlBody,
        attachments: loaded.attachments.map(attachmentMetadata),
        ...(attachmentNames.length > 0 ? { attachmentNames } : {}),
      } satisfies ReadMessageResult;
    },

    async getAttachment(uid, index) {
      const parsedUid = requireUid(uid);
      const parsedIndex = requireAttachmentIndex(index);
      const loaded = await loadParsed(parsedUid);
      const part = loaded.attachments.find((entry) => entry.index === parsedIndex);
      if (part === undefined) {
        throw new Error(ATTACHMENT_NOT_FOUND_MESSAGE);
      }
      return {
        index: part.index,
        name: part.name,
        contentType: part.contentType,
        size: part.size,
        data: part.bytes.toString('base64'),
      } satisfies AttachmentDownload;
    },

    listMailboxes,
    createMailbox,
    renameMailbox,
    deleteMailbox,
    moveMessage,
    copyMessage,
    deleteMessage,
    restoreMessage,
    updateFlags,

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
