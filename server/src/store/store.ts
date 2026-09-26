import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { decryptDocument, type JsonObject } from './codec.js';

export type EncryptedStore = {
  read(): JsonObject;
};

/**
 * Open the encrypted state file under dataDir.
 * Missing state.bin yields an in-memory document of {} without creating the file.
 */
export async function open(dataDir: string, key: Buffer): Promise<EncryptedStore> {
  const filePath = path.join(dataDir, 'state.bin');
  let document: JsonObject = {};

  try {
    const bytes = await readFile(filePath);
    document = decryptDocument(key, bytes);
  } catch (error) {
    if (isEnoent(error)) {
      // First start: empty document, no file on disk yet.
    } else {
      throw error;
    }
  }

  return {
    read(): JsonObject {
      return structuredClone(document);
    },
  };
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'ENOENT'
  );
}
