import type {
  AccountFieldValues,
  NativeConnectorModule,
  NativeEgressClient,
  NativeToolHandler,
  NativeToolResult,
} from '../contract.js';
import { ToolFailure } from '../tool-failure.js';
import {
  assertNotFreeFormSearch,
  createImapClient,
  createSmtpClient,
  ATTACHMENT_INDEX_REQUIRED_MESSAGE,
  FLAG_IS_REQUIRED_MESSAGE,
  INVALID_ORDER_MESSAGE,
  INVALID_SEARCH_FILTER_MESSAGE,
  UID_REQUIRED_MESSAGE,
  type ImapClient,
  type ImapSearchFilter,
} from '../mail/index.js';

export const GMAIL_IMAP_HOST = 'imap.gmail.com';
export const GMAIL_IMAP_PORT = 993;
export const GMAIL_SMTP_HOST = 'smtp.gmail.com';
export const GMAIL_SMTP_PORT = 465;

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

function jsonResult(value: unknown): NativeToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(value) }],
  };
}

function assertKnownOrder(order: unknown): void {
  if (order === undefined || order === 'newest' || order === 'oldest') {
    return;
  }
  throw new ToolFailure(INVALID_ORDER_MESSAGE);
}

function readSearchFilter(args: Readonly<Record<string, unknown>>): ImapSearchFilter {
  if ('query' in args || 'search' in args || typeof args.filter === 'string') {
    throw new ToolFailure(INVALID_SEARCH_FILTER_MESSAGE);
  }
  const filterRaw = args.filter;
  assertNotFreeFormSearch(filterRaw);
  if (
    filterRaw === undefined ||
    filterRaw === null ||
    typeof filterRaw !== 'object' ||
    Array.isArray(filterRaw)
  ) {
    throw new ToolFailure(INVALID_SEARCH_FILTER_MESSAGE);
  }
  const filter: ImapSearchFilter = {};
  if ('unseen' in filterRaw && typeof filterRaw.unseen === 'boolean') {
    filter.unseen = filterRaw.unseen;
  }
  if ('from' in filterRaw && typeof filterRaw.from === 'string') {
    filter.from = filterRaw.from;
  }
  if ('subject' in filterRaw && typeof filterRaw.subject === 'string') {
    filter.subject = filterRaw.subject;
  }
  if ('since' in filterRaw && typeof filterRaw.since === 'string') {
    filter.since = filterRaw.since;
  }
  return filter;
}

const listMessages: NativeToolHandler = async (args, accountValues, egressClient) => {
  assertKnownOrder(args.order);
  const mailbox = readMailbox(args);
  return await withImapSession(accountValues, egressClient, mailbox, async (imap) => {
    const page = await imap.pageMessages({
      offset: args.offset,
      limit: args.limit,
      order: args.order,
    });
    return jsonResult(page);
  });
};

const searchMessages: NativeToolHandler = async (args, accountValues, egressClient) => {
  assertKnownOrder(args.order);
  const filter = readSearchFilter(args);
  const mailbox = readMailbox(args);
  return await withImapSession(accountValues, egressClient, mailbox, async (imap) => {
    const page = await imap.pageMessages({
      filter,
      offset: args.offset,
      limit: args.limit,
      order: args.order,
    });
    return jsonResult(page);
  });
};

const listMailboxes: NativeToolHandler = async (_args, accountValues, egressClient) => {
  return await withImapSession(accountValues, egressClient, 'INBOX', async (imap) => {
    return jsonResult(await imap.listMailboxes());
  });
};

function assertUid(uid: unknown): void {
  if (typeof uid !== 'number' || !Number.isInteger(uid) || uid < 1) {
    throw new ToolFailure(UID_REQUIRED_MESSAGE);
  }
}

function assertAttachmentIndex(index: unknown): void {
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
    throw new ToolFailure(ATTACHMENT_INDEX_REQUIRED_MESSAGE);
  }
}

const readMessage: NativeToolHandler = async (args, accountValues, egressClient) => {
  assertUid(args.uid);
  const mailbox = readMailbox(args);
  return await withImapSession(accountValues, egressClient, mailbox, async (imap) => {
    const message = await imap.fetchMessage(args.uid);
    return jsonResult({
      from: message.headers.from,
      to: message.headers.to,
      subject: message.headers.subject,
      date: message.headers.date,
      textBody: message.textBody,
      htmlBody: message.htmlBody,
      attachments: message.attachments,
    });
  });
};

const updateFlags: NativeToolHandler = async (args, accountValues, egressClient) => {
  assertUid(args.uid);
  if (typeof args.seen !== 'boolean' && typeof args.flagged !== 'boolean') {
    throw new ToolFailure(FLAG_IS_REQUIRED_MESSAGE);
  }
  const mailbox = readMailbox(args);
  return await withImapSession(accountValues, egressClient, mailbox, async (imap) => {
    const state = await imap.updateFlags(args.uid, mailbox, {
      seen: args.seen,
      flagged: args.flagged,
    });
    return jsonResult(state);
  });
};

const getAttachment: NativeToolHandler = async (args, accountValues, egressClient) => {
  assertUid(args.uid);
  assertAttachmentIndex(args.index);
  const mailbox = readMailbox(args);
  return await withImapSession(accountValues, egressClient, mailbox, async (imap) => {
    return jsonResult(await imap.getAttachment(args.uid, args.index));
  });
};

/**
 * Native Gmail connector: app-password IMAP/SMTP over egress TLS sessions.
 */
export const gmailConnector: NativeConnectorModule = {
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
        'List messages in a mailbox as summaries (uid, from, to, subject, date, seen, unread). Does not return bodies. Optional offset, limit, and order (newest or oldest).',
      inputSchema: {
        type: 'object',
        properties: {
          mailbox: { type: 'string', description: 'Mailbox name; defaults to INBOX' },
          offset: {
            type: 'number',
            description: 'Summaries to skip. Omitted, non-integer, or negative becomes 0',
          },
          limit: {
            type: 'number',
            description:
              'Maximum summaries to return. Omitted, non-integer, or below 1 returns the remainder',
          },
          order: {
            type: 'string',
            description: 'newest or oldest. Defaults to newest',
          },
        },
        additionalProperties: false,
      },
      handler: listMessages,
    },
    {
      name: 'search_messages',
      description:
        'Search messages with a narrow filter (unseen, from, subject, since) and return the same summary envelope as list. Free-form IMAP search is rejected.',
      inputSchema: {
        type: 'object',
        properties: {
          mailbox: { type: 'string', description: 'Mailbox name; defaults to INBOX' },
          offset: {
            type: 'number',
            description: 'Summaries to skip. Omitted, non-integer, or negative becomes 0',
          },
          limit: {
            type: 'number',
            description:
              'Maximum summaries to return. Omitted, non-integer, or below 1 returns the remainder',
          },
          order: {
            type: 'string',
            description: 'newest or oldest. Defaults to newest',
          },
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
      name: 'list_mailboxes',
      description: 'List mailbox names and special-use roles. Does not return message bodies.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      handler: listMailboxes,
    },
    {
      name: 'read_message',
      description:
        'Read one message by uid: headers, text body, HTML body, and attachment metadata. Does not return attachment bytes.',
      inputSchema: {
        type: 'object',
        properties: {
          mailbox: { type: 'string', description: 'Mailbox name; defaults to INBOX' },
          uid: { type: 'number', description: 'IMAP UID of the message' },
        },
        required: ['uid'],
        additionalProperties: false,
      },
      handler: readMessage,
    },
    {
      name: 'get_attachment',
      description:
        'Download one attachment by message uid and part index. Returns standard base64 of the decoded bytes.',
      inputSchema: {
        type: 'object',
        properties: {
          mailbox: { type: 'string', description: 'Mailbox name; defaults to INBOX' },
          uid: { type: 'number', description: 'IMAP UID of the message' },
          index: { type: 'number', description: 'Attachment index starting at 0' },
        },
        required: ['uid', 'index'],
        additionalProperties: false,
      },
      handler: getAttachment,
    },
    {
      name: 'update_flags',
      description:
        'Set or clear the seen and flagged flags on one message. Omitted flags stay unchanged. Does not return a body.',
      inputSchema: {
        type: 'object',
        properties: {
          mailbox: { type: 'string', description: 'Mailbox name; defaults to INBOX' },
          uid: { type: 'number', description: 'IMAP UID of the message' },
          seen: { type: 'boolean', description: 'True adds Seen, false removes it' },
          flagged: { type: 'boolean', description: 'True adds Flagged, false removes it' },
        },
        required: ['uid'],
        additionalProperties: false,
      },
      handler: updateFlags,
    },
  ],
};
