import { open as openFd, closeSync, fsyncSync } from 'node:fs';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { decryptDocument, encryptDocument, type JsonObject } from './codec.js';

export type EncryptedStore = {
  read(): JsonObject;
  replace(document: JsonObject): Promise<void>;
};

/**
 * Open the encrypted state file under dataDir.
 * Missing state.bin yields an in-memory document of {} without creating the file.
 */
export async function open(dataDir: string, key: Buffer): Promise<EncryptedStore> {
  const filePath = path.join(dataDir, 'state.bin');
  const tempPath = path.join(dataDir, 'state.bin.tmp');
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

  let writeChain: Promise<void> = Promise.resolve();

  return {
    read(): JsonObject {
      return structuredClone(document);
    },
    replace(next: JsonObject): Promise<void> {
      const snapshot = structuredClone(next);
      const run = writeChain.then(() => persistReplace(key, filePath, tempPath, snapshot));
      // Keep the queue moving even when a write fails so later replaces still run.
      writeChain = run.then(
        () => undefined,
        () => undefined,
      );
      return run.then(() => {
        document = snapshot;
      });
    },
  };
}

async function persistReplace(
  key: Buffer,
  filePath: string,
  tempPath: string,
  document: JsonObject,
): Promise<void> {
  const payload = encryptDocument(key, document);
  await writeFile(tempPath, payload);
  await fsyncFile(tempPath);
  await renameOverwriting(tempPath, filePath);
}

async function renameOverwriting(tempPath: string, filePath: string): Promise<void> {
  try {
    await rename(tempPath, filePath);
  } catch (error) {
    // Windows rename cannot replace an existing destination.
    if (process.platform === 'win32' && isExistError(error)) {
      await unlink(filePath);
      await rename(tempPath, filePath);
      return;
    }
    throw error;
  }
}

function fsyncFile(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    openFd(filePath, 'r+', (openError, fd) => {
      if (openError) {
        reject(openError);
        return;
      }
      try {
        fsyncSync(fd);
        closeSync(fd);
        resolve();
      } catch (error) {
        try {
          closeSync(fd);
        } catch {
          // ignore close errors after fsync failure
        }
        reject(error);
      }
    });
  });
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'ENOENT'
  );
}

function isExistError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  const code = (error as { code: unknown }).code;
  return code === 'EEXIST' || code === 'EPERM' || code === 'EACCES';
}
