export type {
  ImapSearchFilter,
  MessageHeaders,
  MessageSummary,
  ReadMessageResult,
} from './types.js';
export {
  IMAP_LOGIN_FAILED_MESSAGE,
  INVALID_SEARCH_FILTER_MESSAGE,
  SMTP_AUTH_FAILED_MESSAGE,
} from './types.js';
export {
  assertNotFreeFormSearch,
  buildImapSearchCriteria,
  createImapClient,
  extractTextBody,
  type ImapClient,
} from './imap.js';
export { createSmtpClient, type SmtpClient } from './smtp.js';
