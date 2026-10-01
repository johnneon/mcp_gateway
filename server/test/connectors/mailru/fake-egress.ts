import type { Duplex } from 'node:stream';
import type { EgressTransport } from '../../../src/connectors/native/egress.js';
import {
  MAILRU_IMAP_HOST,
  MAILRU_IMAP_PORT,
  MAILRU_SMTP_HOST,
  MAILRU_SMTP_PORT,
} from '../../../src/connectors/mailru/index.js';
import {
  createFakeImapDuplex,
  createSharedFakeImapMailboxes,
  type FakeImapOptions,
} from '../mail/fake-imap.js';
import { createFakeSmtpDuplex, type FakeSmtpOptions } from '../mail/fake-smtp.js';

type FakeImapDuplex = ReturnType<typeof createFakeImapDuplex>;

/**
 * Fake egress transport that hands out fake IMAP/SMTP duplexes for Mail.ru hosts.
 */
export function createMailruFakeEgressTransport(options: {
  imap: FakeImapOptions;
  smtp: FakeSmtpOptions;
}): EgressTransport & {
  tlsSessionCallCount: number;
  searchCommandCount: number;
  messageFlags(mailboxName: string, uid: number): { seen: boolean; flagged: boolean } | undefined;
} {
  const state = { tlsSessionCallCount: 0 };
  const imapSessions: FakeImapDuplex[] = [];
  const sharedMailboxes = createSharedFakeImapMailboxes(options.imap);

  return {
    get tlsSessionCallCount() {
      return state.tlsSessionCallCount;
    },
    get searchCommandCount() {
      return imapSessions.reduce((sum, duplex) => sum + duplex.searchCommandCount, 0);
    },
    messageFlags(mailboxName: string, uid: number) {
      const mailbox = sharedMailboxes.find((entry) => entry.name === mailboxName);
      const message = mailbox?.messages.find((entry) => entry.uid === uid);
      if (message === undefined) {
        return undefined;
      }
      return { seen: message.seen, flagged: message.flagged === true };
    },
    httpsRequest() {
      return Promise.reject(new Error('https not used in mailru tests'));
    },
    tlsConnect() {
      return Promise.reject(new Error('handshake tlsConnect not used in mailru tests'));
    },
    tlsSession(params): Promise<Duplex> {
      state.tlsSessionCallCount += 1;
      if (params.host === MAILRU_IMAP_HOST && params.port === MAILRU_IMAP_PORT) {
        const duplex = createFakeImapDuplex({ ...options.imap, sharedMailboxes });
        imapSessions.push(duplex);
        return Promise.resolve(duplex);
      }
      if (params.host === MAILRU_SMTP_HOST && params.port === MAILRU_SMTP_PORT) {
        return Promise.resolve(createFakeSmtpDuplex(options.smtp));
      }
      return Promise.reject(new Error(`unexpected host ${params.host}:${String(params.port)}`));
    },
  };
}
