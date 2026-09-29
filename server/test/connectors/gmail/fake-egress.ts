import type { Duplex } from 'node:stream';
import type { EgressTransport } from '../../../src/connectors/native/egress.js';
import {
  GMAIL_IMAP_HOST,
  GMAIL_IMAP_PORT,
  GMAIL_SMTP_HOST,
  GMAIL_SMTP_PORT,
} from '../../../src/connectors/gmail/index.js';
import { createFakeImapDuplex, type FakeImapOptions } from '../mail/fake-imap.js';
import { createFakeSmtpDuplex, type FakeSmtpOptions } from '../mail/fake-smtp.js';

/**
 * Fake egress transport that hands out fake IMAP/SMTP duplexes for Gmail hosts.
 */
export function createGmailFakeEgressTransport(options: {
  imap: FakeImapOptions;
  smtp: FakeSmtpOptions;
}): EgressTransport & { tlsSessionCallCount: number } {
  const state = { tlsSessionCallCount: 0 };

  return {
    get tlsSessionCallCount() {
      return state.tlsSessionCallCount;
    },
    httpsRequest() {
      return Promise.reject(new Error('https not used in gmail tests'));
    },
    tlsConnect() {
      return Promise.reject(new Error('handshake tlsConnect not used in gmail tests'));
    },
    tlsSession(params): Promise<Duplex> {
      state.tlsSessionCallCount += 1;
      if (params.host === GMAIL_IMAP_HOST && params.port === GMAIL_IMAP_PORT) {
        return Promise.resolve(createFakeImapDuplex(options.imap));
      }
      if (params.host === GMAIL_SMTP_HOST && params.port === GMAIL_SMTP_PORT) {
        return Promise.resolve(createFakeSmtpDuplex(options.smtp));
      }
      return Promise.reject(new Error(`unexpected host ${params.host}:${String(params.port)}`));
    },
  };
}
