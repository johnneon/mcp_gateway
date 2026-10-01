import type { Duplex } from 'node:stream';
import type { EgressTransport } from '../../../src/connectors/native/egress.js';
import {
  MAILRU_IMAP_HOST,
  MAILRU_IMAP_PORT,
  MAILRU_SMTP_HOST,
  MAILRU_SMTP_PORT,
} from '../../../src/connectors/mailru/index.js';
import { createFakeImapDuplex, type FakeImapOptions } from '../mail/fake-imap.js';
import { createFakeSmtpDuplex, type FakeSmtpOptions } from '../mail/fake-smtp.js';

/**
 * Fake egress transport that hands out fake IMAP/SMTP duplexes for Mail.ru hosts.
 */
export function createMailruFakeEgressTransport(options: {
  imap: FakeImapOptions;
  smtp: FakeSmtpOptions;
}): EgressTransport & { tlsSessionCallCount: number } {
  const state = { tlsSessionCallCount: 0 };

  return {
    get tlsSessionCallCount() {
      return state.tlsSessionCallCount;
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
        return Promise.resolve(createFakeImapDuplex(options.imap));
      }
      if (params.host === MAILRU_SMTP_HOST && params.port === MAILRU_SMTP_PORT) {
        return Promise.resolve(createFakeSmtpDuplex(options.smtp));
      }
      return Promise.reject(new Error(`unexpected host ${params.host}:${String(params.port)}`));
    },
  };
}
