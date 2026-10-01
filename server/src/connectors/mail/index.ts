export type {
  AttachmentDownload,
  ImapSearchFilter,
  MailboxInfo,
  MailboxSpecialUse,
  MessageAttachment,
  MessageHeaders,
  MessageListItem,
  MessagePage,
  MessagePageQuery,
  MessageSummary,
  ReadMessageResult,
} from './types.js';
export {
  ATTACHMENT_INDEX_REQUIRED_MESSAGE,
  ATTACHMENT_NOT_FOUND_MESSAGE,
  IMAP_LOGIN_FAILED_MESSAGE,
  INBOX_CANNOT_BE_DELETED_MESSAGE,
  INBOX_CANNOT_BE_RENAMED_MESSAGE,
  INVALID_ORDER_MESSAGE,
  INVALID_SEARCH_FILTER_MESSAGE,
  MAILBOX_NAME_REQUIRED_MESSAGE,
  MESSAGE_NOT_FOUND_MESSAGE,
  SMTP_AUTH_FAILED_MESSAGE,
  UID_REQUIRED_MESSAGE,
} from './types.js';
export {
  assertNotFreeFormSearch,
  buildImapSearchCriteria,
  createImapClient,
  extractTextBody,
  type ImapClient,
} from './imap.js';
export { createSmtpClient, type SmtpClient } from './smtp.js';
