import type { AccountFieldValues, ConnectorModule, NativeEgressClient } from '../contract.js';
import { createImapClient, createSmtpClient } from '../mail/index.js';

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

/**
 * Native Gmail connector: app-password IMAP/SMTP over egress TLS sessions.
 * Tools are registered in a follow-up task.
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
  tools: [],
};
