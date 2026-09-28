export class AccountNotFoundError extends Error {
  constructor() {
    super('Account not found');
    this.name = 'AccountNotFoundError';
  }
}

export class AccountValidationError extends Error {
  constructor(message = 'Invalid request') {
    super(message);
    this.name = 'AccountValidationError';
  }
}

/** Fixed client-facing text for a failed connector checkConnection. */
export class ConnectionCheckFailedError extends Error {
  constructor() {
    super('Connection check failed');
    this.name = 'ConnectionCheckFailedError';
  }
}
