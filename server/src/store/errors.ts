export class StoreCorruptError extends Error {
  constructor() {
    super('state file is corrupt');
    this.name = 'StoreCorruptError';
  }
}

export class StoreDecryptError extends Error {
  constructor() {
    super('state file cannot be decrypted');
    this.name = 'StoreDecryptError';
  }
}
