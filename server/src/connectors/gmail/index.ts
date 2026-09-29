import type {
  AccountFieldValues,
  ConnectorModule,
  NativeEgressClient,
  NativeToolHandler,
  NativeToolResult,
} from '../contract.js';
import {
  assertNotFreeFormSearch,
  createImapClient,
  createSmtpClient,
  INVALID_SEARCH_FILTER_MESSAGE,
  type ImapClient,
  type ImapSearchFilter,
  type MessageSummary,
} from '../mail/index.js';

export const GMAIL_IMAP_HOST = 'imap.gmail.com';
export const GMAIL_IMAP_PORT = 993;
export const GMAIL_SMTP_HOST = 'smtp.gmail.com';
export const GMAIL_SMTP_PORT = 465;

export const GMAIL_LIST_DEFAULT_LIMIT = 20;
export const GMAIL_LIST_MAX_LIMIT = 50;

async function gmailCheckConnection(
  accountValues: AccountFieldValues,
  egressClient: NativeEgressClient,
): Promise<void> {
  const address = accountValues.address ?? '';
  const password = accountValues.password ?? '';

  const imapDuplex = await egressClient.tlsSession({
    host: GMAIL_IMAP_HOST,
    port: GMAIL_IMAP_PORT,
  });
  const imap = createImapClient(imapDuplex);
  try {
    await imap.login(address, password);
  } finally {
    imap.close();
    imapDuplex.destroy();
  }

  const smtpDuplex = await egressClient.tlsSession({
    host: GMAIL_SMTP_HOST,
    port: GMAIL_SMTP_PORT,
  });
  const smtp = createSmtpClient(smtpDuplex);
  try {
    await smtp.auth(address, password);
  } finally {
    smtp.close();
    smtpDuplex.destroy();
  }
}

async function withImapSession<T>(
  accountValues: AccountFieldValues,
  egressClient: NativeEgressClient,
  mailbox: string,
  fn: (client: ImapClient) => Promise<T>,
): Promise<T> {
  const duplex = await egressClient.tlsSession({
    host: GMAIL_IMAP_HOST,
    port: GMAIL_IMAP_PORT,
  });
  const imap = createImapClient(duplex);
  try {
    await imap.login(accountValues.address ?? '', accountValues.password ?? '');
    await imap.select(mailbox);
    return await fn(imap);
  } finally {
    imap.close();
    duplex.destroy();
  }
}

function readMailbox(args: Readonly<Record<string, unknown>>): string {
  const value = args.mailbox;
  return typeof value === 'string' && value.length > 0 ? value : 'INBOX';
}

function readLimit(args: Readonly<Record<string, unknown>>): number {
  const value = args.limit;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    return GMAIL_LIST_DEFAULT_LIMIT;
  }
  return Math.min(value, GMAIL_LIST_MAX_LIMIT);
}

function summaryJson(summaries: readonly MessageSummary[]): NativeToolResult {
  const payload = summaries.map((summary) => ({
    uid: summary.uid,
    from: summary.from,
    subject: summary.subject,
    date: summary.date,
    seen: summary.seen,
    unread: !summary.seen,
  }));
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  };
}

const listMessages: NativeToolHandler = async (args, accountValues, egressClient) => {
  const mailbox = readMailbox(args);
  const limit = readLimit(args);
  return await withImapSession(accountValues, egressClient, mailbox, async (imap) => {
    const uids = await imap.search({});
    const capped = uids.slice(-limit);
    const summaries = await imap.fetchSummaries(capped);
    return summaryJson(summaries);
  });
};

const searchMessages: NativeToolHandler = async (args, accountValues, egressClient) => {
  const mailbox = readMailbox(args);
  if ('query' in args || 'search' in args || typeof args.filter === 'string') {
    throw new Error(INVALID_SEARCH_FILTER_MESSAGE);
  }
  const filterRaw = args.filter;
  assertNotFreeFormSearch(filterRaw);
  if (filterRaw === undefined || filterRaw === null || typeof filterRaw !== 'object') {
    throw new Error(INVALID_SEARCH_FILTER_MESSAGE);
  }
  const filter = filterRaw as ImapSearchFilter;
  return await withImapSession(accountValues, egressClient, mailbox, async (imap) => {
    const uids = await imap.search(filter);
    const summaries = await imap.fetchSummaries(uids);
    return summaryJson(summaries);
  });
};

const readMessage: NativeToolHandler = async (args, accountValues, egressClient) => {
  const mailbox = readMailbox(args);
  const uid = args.uid;
  if (typeof uid !== 'number' || !Number.isInteger(uid) || uid < 1) {
    throw new Error('uid is required');
  }
  return await withImapSession(accountValues, egressClient, mailbox, async (imap) => {
    const message = await imap.fetchMessage(uid);
    const payload = {
      from: message.headers.from,
      to: message.headers.to,
      subject: message.headers.subject,
      date: message.headers.date,
      textBody: message.textBody,
      ...(message.attachmentNames !== undefined
        ? { attachmentNames: message.attachmentNames }
        : {}),
    };
    return {
      content: [{ type: 'text', text: JSON.stringify(payload) }],
    };
  });
};

/**
 * Native Gmail connector: app-password IMAP/SMTP over egress TLS sessions.
 */
export const gmailConnector: ConnectorModule = {
  id: 'gmail',
  name: 'Gmail',
  kind: 'native',
  fields: [
    { name: 'address', label: 'Address', type: 'text', required: true },
    { name: 'password', label: 'App password', type: 'secret', required: true },
  ],
  allowedDestinations: [
    { host: GMAIL_IMAP_HOST, port: GMAIL_IMAP_PORT },
    { host: GMAIL_SMTP_HOST, port: GMAIL_SMTP_PORT },
  ],
  checkConnection: gmailCheckConnection,
  tools: [
    {
      name: 'list_messages',
      description:
        'List recent messages in a mailbox as summaries (uid, from, subject, date, seen/unread). Does not return bodies.',
      inputSchema: {
        type: 'object',
        properties: {
          mailbox: { type: 'string', description: 'Mailbox name; defaults to INBOX' },
          limit: {
            type: 'integer',
            minimum: 1,
            description: `Maximum summaries to return (default ${String(GMAIL_LIST_DEFAULT_LIMIT)}, capped at ${String(GMAIL_LIST_MAX_LIMIT)})`,
          },
        },
        additionalProperties: false,
      },
      handler: listMessages,
    },
    {
      name: 'search_messages',
      description:
        'Search messages with a narrow filter (unseen, from, subject, since). Free-form IMAP search is rejected.',
      inputSchema: {
        type: 'object',
        properties: {
          mailbox: { type: 'string', description: 'Mailbox name; defaults to INBOX' },
          filter: {
            type: 'object',
            description: 'Narrow search filter only',
            properties: {
              unseen: { type: 'boolean' },
              from: { type: 'string' },
              subject: { type: 'string' },
              since: { type: 'string' },
            },
            additionalProperties: false,
          },
        },
        required: ['filter'],
        additionalProperties: false,
      },
      handler: searchMessages,
    },
    {
      name: 'read_message',
      description:
        'Read one message by uid: headers (from, to, subject, date) and text body. Does not return attachment bytes.',
      inputSchema: {
        type: 'object',
        properties: {
          mailbox: { type: 'string', description: 'Mailbox name; defaults to INBOX' },
          uid: { type: 'integer', minimum: 1, description: 'IMAP UID of the message' },
        },
        required: ['uid'],
        additionalProperties: false,
      },
      handler: readMessage,
    },
  ],
};
