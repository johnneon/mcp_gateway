import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { StoreCorruptError, StoreDecryptError } from './errors.js';

export const STATE_VERSION = 1;
export const IV_LENGTH = 12;
export const TAG_LENGTH = 16;
export const MIN_FILE_LENGTH = 1 + IV_LENGTH + TAG_LENGTH;

export type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function encryptDocument(key: Buffer, document: JsonObject): Buffer {
  const plaintext = Buffer.from(JSON.stringify(document), 'utf8');
  const iv = randomBytes(IV_LENGTH);
  const version = Buffer.from([STATE_VERSION]);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(version);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([version, iv, ciphertext, tag]);
}

export function decryptDocument(key: Buffer, file: Buffer): JsonObject {
  if (file.length < MIN_FILE_LENGTH) {
    throw new StoreCorruptError();
  }
  const versionByte = file[0];
  if (versionByte !== STATE_VERSION) {
    throw new StoreCorruptError();
  }

  const version = file.subarray(0, 1);
  const iv = file.subarray(1, 1 + IV_LENGTH);
  const tag = file.subarray(file.length - TAG_LENGTH);
  const ciphertext = file.subarray(1 + IV_LENGTH, file.length - TAG_LENGTH);

  let plaintext: Buffer;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(version);
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new StoreDecryptError();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext.toString('utf8')) as unknown;
  } catch {
    throw new StoreCorruptError();
  }

  if (!isJsonObject(parsed)) {
    throw new StoreCorruptError();
  }
  return parsed;
}
