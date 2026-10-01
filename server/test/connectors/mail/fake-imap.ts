import { Duplex } from 'node:stream';
import type { ImapSearchFilter } from '../../../src/connectors/mail/types.js';

export type FakeImapMessage = {
  uid: number;
  from: string;
  to: string;
  subject: string;
  date: string;
  seen: boolean;
  textBody: string;
  /** When set, TEXT part is multipart with this attachment name (bytes not returned to client). */
  attachmentName?: string;
  attachmentBytes?: string;
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
};

/**
 * In-process fake IMAP server as a Duplex. Client bytes are written into this duplex;
 * server responses are readable from it. Does not open a TCP socket.
 */
export function createFakeImapDuplex(options: FakeImapOptions): Duplex & {
  searchCommandCount: number;
  lastSearchCriteria: string | undefined;
} {
  const acceptLogin = options.acceptLogin !== false;
  const mailboxes = initialMailboxes(options);
  let buffer = '';
  let selected: FakeMailbox | undefined;
  let loggedIn = false;
  const state = {
    searchCommandCount: 0,
    lastSearchCriteria: undefined as string | undefined,
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
      if (selected === undefined) {
        sendLine(`${tag} NO mailbox not selected`);
        return;
      }
      const fetchMatch = /^UID FETCH\s+([\d,]+)\s+\((.*)\)$/i.exec(rest);
      if (fetchMatch === null) {
        sendLine(`${tag} BAD fetch`);
        return;
      }
      const uidList = (fetchMatch[1] ?? '')
        .split(',')
        .map((part) => Number(part))
        .filter((n) => Number.isInteger(n));
      const items = (fetchMatch[2] ?? '').toUpperCase();
      for (const uid of uidList) {
        const message = selected.messages.find((entry) => entry.uid === uid);
        if (message === undefined) {
          continue;
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

  function emitFetch(message: FakeImapMessage, items: string): void {
    const flags = message.seen ? '(\\Seen)' : '()';
    const wantHeaders = items.includes('HEADER.FIELDS');
    const wantText = items.includes('BODY.PEEK[TEXT]') || items.includes('BODY[TEXT]');
    const headerFields = wantHeaders
      ? items.includes('TO')
        ? `From: ${message.from}\r\nTo: ${message.to}\r\nSubject: ${message.subject}\r\nDate: ${message.date}\r\n\r\n`
        : `From: ${message.from}\r\nSubject: ${message.subject}\r\nDate: ${message.date}\r\n\r\n`
      : '';

    let textBody = message.textBody;
    if (message.attachmentName !== undefined) {
      const boundary = 'bound123';
      textBody =
        `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n` +
        `--${boundary}\r\n` +
        `Content-Type: text/plain; charset=utf-8\r\n\r\n` +
        `${message.textBody}\r\n` +
        `--${boundary}\r\n` +
        `Content-Type: application/octet-stream\r\n` +
        `Content-Disposition: attachment; filename="${message.attachmentName}"\r\n\r\n` +
        `${message.attachmentBytes ?? 'ATTACHMENT-BYTES-SECRET'}\r\n` +
        `--${boundary}--\r\n`;
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
  };
}

function cloneMessage(message: FakeImapMessage): FakeImapMessage {
  return { ...message };
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
