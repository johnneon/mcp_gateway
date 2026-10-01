/**
 * Narrow IMAP search filter. Free-form IMAP search strings are not accepted.
 */
export type ImapSearchFilter = {
  unseen?: boolean;
  from?: string;
  subject?: string;
  since?: string;
};

export type MessageSummary = {
  uid: number;
  from: string;
  to: string;
  subject: string;
  date: string;
  seen: boolean;
};

export type MessageListItem = MessageSummary & {
  unread: boolean;
};

export type MessagePage = {
  messages: MessageListItem[];
  total: number;
  offset: number;
  limit: number | null;
};

export type MessagePageQuery = {
  filter?: ImapSearchFilter;
  offset?: unknown;
  limit?: unknown;
  order?: unknown;
};

export type MessageHeaders = {
  from: string;
  to: string;
  subject: string;
  date: string;
};

export type MessageAttachment = {
  index: number;
  name: string;
  contentType: string;
  size: number;
};

export type AttachmentDownload = MessageAttachment & {
  data: string;
};

export type ReadMessageResult = {
  headers: MessageHeaders;
  textBody: string;
  htmlBody: string;
  attachments: MessageAttachment[];
  attachmentNames?: string[];
};

export const INVALID_SEARCH_FILTER_MESSAGE = 'Invalid search filter';
export const INVALID_ORDER_MESSAGE = 'Invalid order';
export const UID_REQUIRED_MESSAGE = 'uid is required';
export const ATTACHMENT_INDEX_REQUIRED_MESSAGE = 'Attachment index is required';
export const ATTACHMENT_NOT_FOUND_MESSAGE = 'Attachment not found';
export const MESSAGE_NOT_FOUND_MESSAGE = 'Message not found';
export const MAILBOX_NAME_REQUIRED_MESSAGE = 'Mailbox name is required';
export const INBOX_CANNOT_BE_RENAMED_MESSAGE = 'Inbox cannot be renamed';
export const INBOX_CANNOT_BE_DELETED_MESSAGE = 'Inbox cannot be deleted';

export type MailboxSpecialUse =
  'inbox' | 'sent' | 'drafts' | 'junk' | 'trash' | 'archive' | 'flagged' | 'all' | 'none';

export type MailboxInfo = {
  name: string;
  specialUse: MailboxSpecialUse;
};
export const IMAP_LOGIN_FAILED_MESSAGE = 'IMAP login failed';
export const SMTP_AUTH_FAILED_MESSAGE = 'SMTP authentication failed';
