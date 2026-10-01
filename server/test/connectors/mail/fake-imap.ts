import { Duplex } from 'node:stream';
import type { ImapSearchFilter } from '../../../src/connectors/mail/types.js';

export type FakeImapMessage = {
  uid: number;
  from: string;
  to: string;
  subject: string;
  date: string;
  seen: boolean;
  flagged?: boolean;
  textBody: string;
  htmlBody?: string;
  /** When set, TEXT part is multipart with this attachment name (bytes not returned to client). */
  attachmentName?: string;
  attachmentBytes?: string;
  attachments?: Array<{
    name: string;
    contentType: string;
    bytes: string;
  }>;
};

export type FakeMailbox = {
  name: string;
  attributes: string[];
  messages: FakeImapMessage[];
};

export type FakeImapOptions = {
  user: string;
  password: string;
  acceptLogin?: boolean;
  /** Messages placed in INBOX. Existing callers keep passing this list. */
  messages?: FakeImapMessage[];
  /** Extra mailboxes. INBOX is always built from `messages`, not from this list. */
  mailboxes?: Array<Omit<FakeMailbox, 'messages'> & { messages?: FakeImapMessage[] }>;
  /** When set, DELETE replies NO with this text and leaves the mailbox. */
  deleteNo?: string;
  /** When set, UID MOVE replies NO with this text and leaves messages in place. */
  moveNo?: string;
  /** When set, UID COPY replies NO with this text and does not copy. */
  copyNo?: string;
  /** When set, UID STORE replies NO with this text and leaves flags unchanged. */
  storeNo?: string;
  /** When set, a body FETCH replies NO with this text and leaves the message unchanged. */
  attachmentNo?: string;
  /**
   * Mailbox list reused by every duplex created with this array.
   * Omit it to give each duplex its own copy.
   */
  sharedMailboxes?: FakeMailbox[];
};

/**
 * In-process fake IMAP server as a Duplex. Client bytes are written into this duplex;
 * server responses are readable from it. Does not open a TCP socket.
 */
export function createFakeImapDuplex(options: FakeImapOptions): Duplex & {
  searchCommandCount: number;
  lastSearchCriteria: string | undefined;
  fetchCommandCount: number;
  commands: readonly string[];
} {
  const acceptLogin = options.acceptLogin !== false;
  const mailboxes = options.sharedMailboxes ?? initialMailboxes(options);
  let buffer = '';
  let selected: FakeMailbox | undefined;
  let loggedIn = false;
  const state = {
    searchCommandCount: 0,
    lastSearchCriteria: undefined as string | undefined,
    fetchCommandCount: 0,
    commands: [] as string[],
  };

  const duplex = new Duplex({
    read() {
      // push-driven
    },
    write(chunk: Buffer | string, _encoding, callback) {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      processBuffer();
      callback();
    },
  });

  Object.defineProperty(duplex, 'searchCommandCount', {
    get: () => state.searchCommandCount,
  });
  Object.defineProperty(duplex, 'lastSearchCriteria', {
    get: () => state.lastSearchCriteria,
  });
  Object.defineProperty(duplex, 'fetchCommandCount', {
    get: () => state.fetchCommandCount,
  });
  Object.defineProperty(duplex, 'commands', {
    get: () => state.commands,
  });

  const sendLine = (line: string): void => {
    duplex.push(`${line}\r\n`);
  };

  queueMicrotask(() => {
    sendLine('* OK Fake IMAP ready');
  });

  function respondLiteralPrefixed(prefix: string, literal: string, suffix: string): void {
    const size = Buffer.byteLength(literal, 'utf8');
    duplex.push(`${prefix}{${String(size)}}\r\n`);
    duplex.push(literal);
    duplex.push(`${suffix}\r\n`);
  }

  function processBuffer(): void {
    for (;;) {
      const idx = buffer.indexOf('\r\n');
      if (idx < 0) {
        return;
      }
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      handleCommand(line);
    }
  }

  function handleCommand(line: string): void {
    const match = /^(\S+)\s+(.*)$/.exec(line);
    if (match === null) {
      return;
    }
    const tag = match[1] ?? '';
    const rest = match[2] ?? '';
    const upper = rest.toUpperCase();
    state.commands.push(rest);

    if (upper.startsWith('LOGIN ')) {
      if (!acceptLogin) {
        sendLine(`${tag} NO LOGIN failed`);
        return;
      }
      const loginMatch = /^LOGIN\s+"([^"]*)"\s+"([^"]*)"$/i.exec(rest);
      const user = loginMatch?.[1];
      const password = loginMatch?.[2];
      if (user === options.user && password === options.password) {
        loggedIn = true;
        sendLine(`${tag} OK LOGIN completed`);
      } else {
        sendLine(`${tag} NO LOGIN failed`);
      }
      return;
    }

    if (!loggedIn && !upper.startsWith('LOGOUT')) {
      sendLine(`${tag} NO not authenticated`);
      return;
    }

    if (upper.startsWith('SELECT ')) {
      const name = unquoteAtom(rest.slice('SELECT '.length));
      const mailbox = findMailbox(mailboxes, name);
      if (mailbox === undefined) {
        sendLine(`${tag} NO mailbox not found`);
        return;
      }
      selected = mailbox;
      sendLine(`* ${String(mailbox.messages.length)} EXISTS`);
      sendLine(`${tag} OK SELECT completed`);
      return;
    }

    if (upper.startsWith('LIST ')) {
      for (const mailbox of mailboxes) {
        sendLine(`* LIST (${mailbox.attributes.join(' ')}) "/" ${quoteImap(mailbox.name)}`);
      }
      sendLine(`${tag} OK LIST completed`);
      return;
    }

    if (upper.startsWith('CREATE ')) {
      const name = unquoteAtom(rest.slice('CREATE '.length));
      if (findMailbox(mailboxes, name) !== undefined) {
        sendLine(`${tag} NO mailbox exists`);
        return;
      }
      mailboxes.push({ name, attributes: [], messages: [] });
      sendLine(`${tag} OK CREATE completed`);
      return;
    }

    if (upper.startsWith('RENAME ')) {
      const pair = readQuotedPair(rest.slice('RENAME '.length));
      if (pair === undefined) {
        sendLine(`${tag} BAD rename`);
        return;
      }
      const [fromName, toName] = pair;
      const source = findMailbox(mailboxes, fromName);
      if (source === undefined) {
        sendLine(`${tag} NO mailbox not found`);
        return;
      }
      if (findMailbox(mailboxes, toName) !== undefined) {
        sendLine(`${tag} NO mailbox exists`);
        return;
      }
      source.name = toName;
      sendLine(`${tag} OK RENAME completed`);
      return;
    }

    if (upper.startsWith('DELETE ')) {
      const name = unquoteAtom(rest.slice('DELETE '.length));
      if (options.deleteNo !== undefined) {
        sendLine(`${tag} NO ${options.deleteNo}`);
        return;
      }
      const index = mailboxes.findIndex((mailbox) => mailbox.name === name);
      if (index < 0) {
        sendLine(`${tag} NO mailbox not found`);
        return;
      }
      mailboxes.splice(index, 1);
      sendLine(`${tag} OK DELETE completed`);
      return;
    }

    if (upper.startsWith('UID MOVE ')) {
      if (options.moveNo !== undefined) {
        sendLine(`${tag} NO ${options.moveNo}`);
        return;
      }
      transferMessage(tag, rest, 'MOVE', true);
      return;
    }

    if (upper.startsWith('UID COPY ')) {
      if (options.copyNo !== undefined) {
        sendLine(`${tag} NO ${options.copyNo}`);
        return;
      }
      transferMessage(tag, rest, 'COPY', false);
      return;
    }

    if (upper.startsWith('UID STORE ')) {
      if (options.storeNo !== undefined) {
        sendLine(`${tag} NO ${options.storeNo}`);
        return;
      }
      const storeMatch = /^UID STORE\s+(\d+)\s+([+-])FLAGS\s+\(([^)]*)\)$/i.exec(rest);
      if (storeMatch === null || selected === undefined) {
        sendLine(`${tag} NO store failed`);
        return;
      }
      const uid = Number(storeMatch[1]);
      const message = selected.messages.find((entry) => entry.uid === uid);
      if (message === undefined) {
        sendLine(`${tag} NO message not found`);
        return;
      }
      const add = storeMatch[2] === '+';
      for (const flag of (storeMatch[3] ?? '').split(/\s+/)) {
        if (/^\\Seen$/i.test(flag)) {
          message.seen = add;
        } else if (/^\\Flagged$/i.test(flag)) {
          message.flagged = add;
        }
      }
      sendLine(`${tag} OK STORE completed`);
      return;
    }

    if (upper.startsWith('UID SEARCH ')) {
      state.searchCommandCount += 1;
      const criteria = rest.slice('UID SEARCH '.length);
      state.lastSearchCriteria = criteria;
      if (selected === undefined) {
        sendLine(`${tag} NO mailbox not selected`);
        return;
      }
      const uids = filterMessages(criteria, selected.messages);
      sendLine(`* SEARCH ${uids.join(' ')}`.trimEnd());
      sendLine(`${tag} OK SEARCH completed`);
      return;
    }

    if (upper.startsWith('UID FETCH ')) {
      state.fetchCommandCount += 1;
      const fetchMatch = /^UID FETCH\s+([\d,]+)\s+\((.*)\)$/i.exec(rest);
      const items = (fetchMatch?.[2] ?? '').toUpperCase();
      if (
        options.attachmentNo !== undefined &&
        (items.includes('BODY.PEEK[TEXT]') || items.includes('BODY[TEXT]'))
      ) {
        sendLine(`${tag} NO ${options.attachmentNo}`);
        return;
      }
      if (selected === undefined) {
        sendLine(`${tag} NO mailbox not selected`);
        return;
      }
      if (fetchMatch === null) {
        sendLine(`${tag} BAD fetch`);
        return;
      }
      const uidList = (fetchMatch[1] ?? '')
        .split(',')
        .map((part) => Number(part))
        .filter((n) => Number.isInteger(n));
      for (const uid of uidList) {
        const message = selected.messages.find((entry) => entry.uid === uid);
        if (message === undefined) {
          continue;
        }
        if (fetchMarksSeen(items)) {
          message.seen = true;
        }
        emitFetch(message, items);
      }
      sendLine(`${tag} OK FETCH completed`);
      return;
    }

    if (upper.startsWith('LOGOUT')) {
      sendLine('* BYE');
      sendLine(`${tag} OK LOGOUT completed`);
      duplex.push(null);
      return;
    }

    sendLine(`${tag} BAD unknown command`);
  }

  function transferMessage(
    commandTag: string,
    commandRest: string,
    verb: 'MOVE' | 'COPY',
    removeSource: boolean,
  ): void {
    const match = new RegExp(`^UID ${verb}\\s+(\\d+)\\s+(.+)$`, 'i').exec(commandRest);
    if (match === null || selected === undefined) {
      sendLine(`${commandTag} NO ${verb.toLowerCase()} failed`);
      return;
    }
    const uid = Number(match[1]);
    const destination = findMailbox(mailboxes, unquoteAtom(match[2] ?? ''));
    const index = selected.messages.findIndex((entry) => entry.uid === uid);
    const message = index >= 0 ? selected.messages[index] : undefined;
    if (destination === undefined || message === undefined) {
      sendLine(`${commandTag} NO ${verb.toLowerCase()} failed`);
      return;
    }
    if (removeSource) {
      selected.messages.splice(index, 1);
    }
    const nextUid = destination.messages.reduce((max, entry) => Math.max(max, entry.uid), 0) + 1;
    const copy = cloneMessage(message);
    copy.uid = nextUid;
    destination.messages.push(copy);
    sendLine(`${commandTag} OK ${verb} completed`);
  }

  function emitFetch(message: FakeImapMessage, items: string): void {
    const flags = formatFlags(message);
    const wantHeaders = items.includes('HEADER.FIELDS');
    const wantText = items.includes('BODY.PEEK[TEXT]') || items.includes('BODY[TEXT]');
    const headerFields = wantHeaders
      ? items.includes('TO')
        ? `From: ${message.from}\r\nTo: ${message.to}\r\nSubject: ${message.subject}\r\nDate: ${message.date}\r\n\r\n`
        : `From: ${message.from}\r\nSubject: ${message.subject}\r\nDate: ${message.date}\r\n\r\n`
      : '';

    const textBody = renderMessageText(message);

    if (!wantHeaders && !wantText && items.includes('FLAGS')) {
      sendLine(`* 1 FETCH (UID ${String(message.uid)} FLAGS ${flags})`);
      return;
    }

    if (wantHeaders && wantText) {
      const headerSize = Buffer.byteLength(headerFields, 'utf8');
      const textSize = Buffer.byteLength(textBody, 'utf8');
      duplex.push(
        `* 1 FETCH (UID ${String(message.uid)} FLAGS ${flags} BODY[HEADER.FIELDS (FROM TO SUBJECT DATE)] {${String(headerSize)}}\r\n`,
      );
      duplex.push(headerFields);
      duplex.push(` BODY[TEXT] {${String(textSize)}}\r\n`);
      duplex.push(textBody);
      duplex.push(`)\r\n`);
      return;
    }

    if (wantHeaders) {
      respondLiteralPrefixed(
        `* 1 FETCH (UID ${String(message.uid)} FLAGS ${flags} BODY[HEADER.FIELDS (FROM SUBJECT DATE)] `,
        headerFields,
        ')',
      );
    }
  }

  return duplex as Duplex & {
    searchCommandCount: number;
    lastSearchCriteria: string | undefined;
    fetchCommandCount: number;
    commands: readonly string[];
  };
}

function formatFlags(message: FakeImapMessage): string {
  const names: string[] = [];
  if (message.seen) {
    names.push('\\Seen');
  }
  if (message.flagged === true) {
    names.push('\\Flagged');
  }
  return names.length === 0 ? '()' : `(${names.join(' ')})`;
}

function quoteImap(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function readQuotedPair(input: string): [string, string] | undefined {
  const first = readQuoted(input.trim());
  if (first === undefined) {
    return undefined;
  }
  const second = readQuoted(first.rest);
  if (second === undefined) {
    return undefined;
  }
  return [first.value, second.value];
}

function readQuoted(input: string): { value: string; rest: string } | undefined {
  if (!input.startsWith('"')) {
    return undefined;
  }
  let value = '';
  for (let index = 1; index < input.length; index += 1) {
    const ch = input[index];
    if (ch === '\\') {
      value += input[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (ch === '"') {
      return { value, rest: input.slice(index + 1).trim() };
    }
    value += ch ?? '';
  }
  return undefined;
}

function fetchMarksSeen(items: string): boolean {
  const withoutPeek = items.replace(/BODY\.PEEK\[/g, '');
  return /BODY\[/.test(withoutPeek);
}

function renderMessageText(message: FakeImapMessage): string {
  const files = [
    ...(message.attachments ?? []),
    ...(message.attachmentName !== undefined
      ? [
          {
            name: message.attachmentName,
            contentType: 'application/octet-stream',
            bytes: message.attachmentBytes ?? 'ATTACHMENT-BYTES-SECRET',
          },
        ]
      : []),
  ];
  if (message.htmlBody === undefined && files.length === 0) {
    return message.textBody;
  }
  const boundary = 'bound123';
  const parts = [
    `Content-Type: text/plain; charset=utf-8\r\n\r\n${message.textBody}`,
    ...(message.htmlBody !== undefined
      ? [`Content-Type: text/html; charset=utf-8\r\n\r\n${message.htmlBody}`]
      : []),
    ...files.map(
      (file) =>
        `Content-Type: ${file.contentType}\r\nContent-Disposition: attachment; filename="${file.name}"\r\n\r\n${file.bytes}`,
    ),
  ];
  const body = parts.map((part) => `--${boundary}\r\n${part}\r\n`).join('');
  return `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n${body}--${boundary}--\r\n`;
}

function cloneMessage(message: FakeImapMessage): FakeImapMessage {
  return {
    ...message,
    ...(message.attachments !== undefined
      ? { attachments: message.attachments.map((part) => ({ ...part })) }
      : {}),
  };
}

export function createSharedFakeImapMailboxes(options: FakeImapOptions): FakeMailbox[] {
  return initialMailboxes(options);
}

function initialMailboxes(options: FakeImapOptions): FakeMailbox[] {
  const extras = (options.mailboxes ?? [])
    .filter((mailbox) => mailbox.name.toUpperCase() !== 'INBOX')
    .map((mailbox) => ({
      name: mailbox.name,
      attributes: [...mailbox.attributes],
      messages: (mailbox.messages ?? []).map(cloneMessage),
    }));
  return [
    {
      name: 'INBOX',
      attributes: ['\\Inbox'],
      messages: (options.messages ?? []).map(cloneMessage),
    },
    ...extras,
  ];
}

function findMailbox(mailboxes: readonly FakeMailbox[], name: string): FakeMailbox | undefined {
  return mailboxes.find((mailbox) => mailbox.name === name);
}

function unquoteAtom(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return trimmed;
}

function filterMessages(criteria: string, messages: FakeImapMessage[]): number[] {
  const filter = parseCriteria(criteria);
  return messages
    .filter((message) => {
      if (filter.unseen === true && message.seen) {
        return false;
      }
      if (filter.from !== undefined && !message.from.includes(filter.from)) {
        return false;
      }
      if (filter.subject !== undefined && !message.subject.includes(filter.subject)) {
        return false;
      }
      return true;
    })
    .map((message) => message.uid);
}

function parseCriteria(criteria: string): ImapSearchFilter {
  const filter: ImapSearchFilter = {};
  if (/\bUNSEEN\b/i.test(criteria)) {
    filter.unseen = true;
  }
  const fromMatch = /FROM\s+"([^"]*)"/i.exec(criteria);
  if (fromMatch?.[1] !== undefined) {
    filter.from = fromMatch[1];
  }
  const subjectMatch = /SUBJECT\s+"([^"]*)"/i.exec(criteria);
  if (subjectMatch?.[1] !== undefined) {
    filter.subject = subjectMatch[1];
  }
  const sinceMatch = /SINCE\s+"([^"]*)"/i.exec(criteria);
  if (sinceMatch?.[1] !== undefined) {
    filter.since = sinceMatch[1];
  }
  return filter;
}
