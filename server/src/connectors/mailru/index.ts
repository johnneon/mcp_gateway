import type { AccountFieldValues, NativeConnectorModule, NativeEgressClient } from '../contract.js';
import { createImapClient, createSmtpClient } from '../mail/index.js';

export const MAILRU_IMAP_HOST = 'imap.mail.ru';
export const MAILRU_IMAP_PORT = 993;
export const MAILRU_SMTP_HOST = 'smtp.mail.ru';
export const MAILRU_SMTP_PORT = 465;

async function mailruCheckConnection(
  accountValues: AccountFieldValues,
  egressClient: NativeEgressClient,
): Promise<void> {
  const address = accountValues.address ?? '';
  const password = accountValues.password ?? '';

  const imapDuplex = await egressClient.tlsSession({
    host: MAILRU_IMAP_HOST,
    port: MAILRU_IMAP_PORT,
  });
  const imap = createImapClient(imapDuplex);
  try {
    await imap.login(address, password);
  } finally {
    imap.close();
    imapDuplex.destroy();
  }

  const smtpDuplex = await egressClient.tlsSession({
    host: MAILRU_SMTP_HOST,
    port: MAILRU_SMTP_PORT,
  });
  const smtp = createSmtpClient(smtpDuplex);
  try {
    await smtp.auth(address, password);
  } finally {
    smtp.close();
    smtpDuplex.destroy();
  }
}

/**
 * Native Mail.ru connector: app-password IMAP/SMTP over egress TLS sessions.
 */
export const mailruConnector: NativeConnectorModule = {
  id: 'mailru',
  name: 'Mail.ru',
  kind: 'native',
  fields: [
    { name: 'address', label: 'Address', type: 'text', required: true },
    { name: 'password', label: 'App password', type: 'secret', required: true },
  ],
  allowedDestinations: [
    { host: MAILRU_IMAP_HOST, port: MAILRU_IMAP_PORT },
    { host: MAILRU_SMTP_HOST, port: MAILRU_SMTP_PORT },
  ],
  checkConnection: mailruCheckConnection,
  tools: [],
};
