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
  subject: string;
  date: string;
  seen: boolean;
};

export type MessageHeaders = {
  from: string;
  to: string;
  subject: string;
  date: string;
};

export type ReadMessageResult = {
  headers: MessageHeaders;
  textBody: string;
  attachmentNames?: string[];
};

export const INVALID_SEARCH_FILTER_MESSAGE = 'Invalid search filter';
export const IMAP_LOGIN_FAILED_MESSAGE = 'IMAP login failed';
export const SMTP_AUTH_FAILED_MESSAGE = 'SMTP authentication failed';
