/**
 * Throwaway fake IMAP/SMTP duplexes for Gmail e2e. Not product code.
 * Mirrors server/test/connectors/mail fakes; does not open TCP.
 */
import { Duplex } from 'node:stream';

export function createFakeSmtpDuplex(options) {
  const acceptAuth = options.acceptAuth !== false;
  let buffer = '';
  let stage = 'ehlo';

  const duplex = new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      processBuffer();
      callback();
    },
  });

  queueMicrotask(() => {
    duplex.push('220 fake.smtp.test ESMTP\r\n');
  });

  function respond(line) {
    duplex.push(`${line}\r\n`);
  }

  function processBuffer() {
    for (;;) {
      const idx = buffer.indexOf('\r\n');
      if (idx < 0) return;
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      handle(line);
    }
  }

  function handle(line) {
    const upper = line.toUpperCase();
    if (stage === 'ehlo' && upper.startsWith('EHLO')) {
      respond('250-fake.smtp.test');
      respond('250-AUTH LOGIN');
      respond('250 OK');
      stage = 'auth';
      return;
    }
    if (stage === 'auth' && upper === 'AUTH LOGIN') {
      respond('334 VXNlcm5hbWU6');
      stage = 'user';
      return;
    }
    if (stage === 'user') {
      const user = Buffer.from(line, 'base64').toString('utf8');
      if (user !== options.user) {
        respond('535 Authentication failed');
        stage = 'done';
        return;
      }
      respond('334 UGFzc3dvcmQ6');
      stage = 'pass';
      return;
    }
    if (stage === 'pass') {
      const password = Buffer.from(line, 'base64').toString('utf8');
      if (!acceptAuth || password !== options.password) {
        respond('535 Authentication failed');
        stage = 'done';
        return;
      }
      respond('235 Authentication successful');
      stage = 'done';
      return;
    }
    if (upper === 'QUIT') {
      respond('221 Bye');
      duplex.push(null);
      return;
    }
    respond('500 unrecognized');
  }

  return duplex;
}

function parseCriteria(criteria) {
  const filter = {};
  if (/\bUNSEEN\b/i.test(criteria)) filter.unseen = true;
  const fromMatch = /FROM\s+"([^"]*)"/i.exec(criteria);
  if (fromMatch?.[1] !== undefined) filter.from = fromMatch[1];
  const subjectMatch = /SUBJECT\s+"([^"]*)"/i.exec(criteria);
  if (subjectMatch?.[1] !== undefined) filter.subject = subjectMatch[1];
  const sinceMatch = /SINCE\s+"([^"]*)"/i.exec(criteria);
  if (sinceMatch?.[1] !== undefined) filter.since = sinceMatch[1];
  return filter;
}

function filterMessages(criteria, messages) {
  const filter = parseCriteria(criteria);
  return messages
    .filter((message) => {
      if (filter.unseen === true && message.seen) return false;
      if (filter.from !== undefined && !message.from.includes(filter.from)) return false;
      if (filter.subject !== undefined && !message.subject.includes(filter.subject)) return false;
      return true;
    })
    .map((message) => message.uid);
}

export function createFakeImapDuplex(options) {
  const acceptLogin = options.acceptLogin !== false;
  const messages = options.messages ?? [];
  let buffer = '';
  let selected = false;
  let loggedIn = false;
  const state = { searchCommandCount: 0, lastSearchCriteria: undefined };

  const duplex = new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
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

  const sendLine = (line) => {
    duplex.push(`${line}\r\n`);
  };

  queueMicrotask(() => {
    sendLine('* OK Fake IMAP ready');
  });

  function respondLiteralPrefixed(prefix, literal, suffix) {
    const size = Buffer.byteLength(literal, 'utf8');
    duplex.push(`${prefix}{${String(size)}}\r\n`);
    duplex.push(literal);
    duplex.push(`${suffix}\r\n`);
  }

  function processBuffer() {
    for (;;) {
      const idx = buffer.indexOf('\r\n');
      if (idx < 0) return;
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      handleCommand(line);
    }
  }

  function emitFetch(message, items) {
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

  function handleCommand(line) {
    const match = /^(\S+)\s+(.*)$/.exec(line);
    if (match === null) return;
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
      selected = true;
      sendLine('* 0 EXISTS');
      sendLine(`${tag} OK SELECT completed`);
      return;
    }

    if (upper.startsWith('UID SEARCH ')) {
      state.searchCommandCount += 1;
      const criteria = rest.slice('UID SEARCH '.length);
      state.lastSearchCriteria = criteria;
      if (!selected) {
        sendLine(`${tag} NO mailbox not selected`);
        return;
      }
      const uids = filterMessages(criteria, messages);
      sendLine(`* SEARCH ${uids.join(' ')}`.trimEnd());
      sendLine(`${tag} OK SEARCH completed`);
      return;
    }

    if (upper.startsWith('UID FETCH ')) {
      if (!selected) {
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
        const message = messages.find((entry) => entry.uid === uid);
        if (message === undefined) continue;
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

  return duplex;
}

export function createGmailFakeEgressTransport(options) {
  const IMAP_HOST = 'imap.gmail.com';
  const IMAP_PORT = 993;
  const SMTP_HOST = 'smtp.gmail.com';
  const SMTP_PORT = 465;
  const state = { tlsSessionCallCount: 0 };

  return {
    get tlsSessionCallCount() {
      return state.tlsSessionCallCount;
    },
    httpsRequest() {
      return Promise.reject(new Error('https not used in gmail e2e'));
    },
    tlsConnect() {
      return Promise.reject(new Error('handshake tlsConnect not used in gmail e2e'));
    },
    tlsSession(params) {
      state.tlsSessionCallCount += 1;
      if (params.host === IMAP_HOST && params.port === IMAP_PORT) {
        return Promise.resolve(createFakeImapDuplex(options.imap));
      }
      if (params.host === SMTP_HOST && params.port === SMTP_PORT) {
        return Promise.resolve(createFakeSmtpDuplex(options.smtp));
      }
      return Promise.reject(new Error(`unexpected host ${params.host}:${String(params.port)}`));
    },
  };
}
