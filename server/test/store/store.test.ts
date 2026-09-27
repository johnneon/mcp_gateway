import { mkdtemp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { encryptDocument } from '../../src/store/codec.js';
import { StoreCorruptError, StoreDecryptError } from '../../src/store/errors.js';
import { open } from '../../src/store/store.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const dataRoot = path.join(repoRoot, 'data');

const KEY_A = Buffer.from('store-test-key-a-32b-padded!!!!!');
const KEY_A_B64 = KEY_A.toString('base64');
const KEY_B = Buffer.from('store-test-key-b-32b-padded!!!!!');
const KEY_B_B64 = KEY_B.toString('base64');
const CANARY = 'CANARY-plaintext-UNIQUE-9f3a7b2c';

const tempDirs: string[] = [];

async function makeDataDir(): Promise<string> {
  await mkdir(dataRoot, { recursive: true });
  const dir = await mkdtemp(path.join(dataRoot, 'store-open-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe('encrypted-store: A missing file yields an empty state and does not create the file', () => {
  it('No file — memory is {} and the file is not created', async () => {
    const dataDir = await makeDataDir();
    const store = await open(dataDir, KEY_A);
    expect(store.read()).toEqual({});
    await expect(access(path.join(dataDir, 'state.bin'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});

describe('encrypted-store: A wrong key and a corrupt file are rejected without a leak', () => {
  it('Wrong key — cannot be decrypted', async () => {
    const dataDir = await makeDataDir();
    const filePath = path.join(dataDir, 'state.bin');
    const bytes = encryptDocument(KEY_A, { secret: CANARY });
    await writeFile(filePath, bytes);

    let caught: unknown;
    try {
      await open(dataDir, KEY_B);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(StoreDecryptError);
    const message = caught instanceof Error ? caught.message : String(caught);
    expect(message).toBe('state file cannot be decrypted');
    expect(message).not.toContain(KEY_A_B64);
    expect(message).not.toContain(KEY_B_B64);
    expect(message).not.toContain(CANARY);
    expect(message).not.toContain(KEY_A.toString('utf8'));
    expect(message).not.toContain(KEY_B.toString('utf8'));
  });

  it('Truncated or damaged file — corrupt', async () => {
    const dataDir = await makeDataDir();
    const filePath = path.join(dataDir, 'state.bin');
    const truncated = Buffer.from([1, 2, 3, 4, 5]);
    await writeFile(filePath, truncated);

    let caught: unknown;
    try {
      await open(dataDir, KEY_A);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(StoreCorruptError);
    const message = caught instanceof Error ? caught.message : String(caught);
    expect(message).toBe('state file is corrupt');
    expect(message).not.toContain(KEY_A_B64);
    expect(message).not.toContain(KEY_A.toString('utf8'));
    expect(message).not.toContain(truncated.toString('utf8'));
  });

  it('Version is not 1 — corrupt without a leak', async () => {
    const dataDir = await makeDataDir();
    const filePath = path.join(dataDir, 'state.bin');
    const valid = encryptDocument(KEY_A, { note: CANARY });
    valid[0] = 2;
    await writeFile(filePath, valid);

    let caught: unknown;
    try {
      await open(dataDir, KEY_A);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(StoreCorruptError);
    const message = caught instanceof Error ? caught.message : String(caught);
    expect(message).toBe('state file is corrupt');
    expect(message).not.toContain(CANARY);
    expect(message).not.toContain(KEY_A_B64);
  });

  it('Decrypted non-object JSON — corrupt', async () => {
    const { createCipheriv, randomBytes } = await import('node:crypto');
    const dataDir = await makeDataDir();
    const filePath = path.join(dataDir, 'state.bin');
    const version = Buffer.from([1]);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', KEY_A, iv);
    cipher.setAAD(version);
    const ciphertext = Buffer.concat([
      cipher.update(Buffer.from(JSON.stringify([CANARY]), 'utf8')),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    await writeFile(filePath, Buffer.concat([version, iv, ciphertext, tag]));

    let caught: unknown;
    try {
      await open(dataDir, KEY_A);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(StoreCorruptError);
    const message = caught instanceof Error ? caught.message : String(caught);
    expect(message).toBe('state file is corrupt');
    expect(message).not.toContain(CANARY);
    expect(message).not.toContain(KEY_A_B64);
  });
});

describe('encrypted-store: State file path and format', () => {
  it('The file is at the agreed path', async () => {
    const dataDir = await makeDataDir();
    const filePath = path.join(dataDir, 'state.bin');
    const store = await open(dataDir, KEY_A);
    await store.replace({ ok: true });
    expect(store.read()).toEqual({ ok: true });
    const onDisk = await readFile(filePath);
    expect(onDisk[0]).toBe(1);
    expect(onDisk.length).toBeGreaterThanOrEqual(1 + 12 + 16);
  });
});

describe('encrypted-store: Replace keeps the document for a later open', () => {
  it('Write and reopen with the same key', async () => {
    const dataDir = await makeDataDir();
    const doc = { alpha: 1, nested: { canary: CANARY } };
    const store = await open(dataDir, KEY_A);
    await store.replace(doc);
    const again = await open(dataDir, KEY_A);
    expect(again.read()).toEqual(doc);
  });
});

describe('encrypted-store: Ciphertext does not contain the document plaintext', () => {
  it('Canary is absent from the file bytes', async () => {
    const dataDir = await makeDataDir();
    const store = await open(dataDir, KEY_A);
    await store.replace({ note: CANARY });
    const bytes = await readFile(path.join(dataDir, 'state.bin'));
    expect(bytes.includes(Buffer.from(CANARY, 'utf8'))).toBe(false);
  });
});

describe('encrypted-store: Overlapping replace calls are serialized', () => {
  it('Two overlapping replace calls do not corrupt the file', async () => {
    const dataDir = await makeDataDir();
    const store = await open(dataDir, KEY_A);
    const first = store.replace({ n: 1, mark: 'first' });
    const second = store.replace({ n: 2, mark: 'second' });
    const results = await Promise.allSettled([first, second]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const onDisk = await open(dataDir, KEY_A);
    const doc = onDisk.read();
    expect(doc).toEqual(store.read());
    expect(doc).toEqual({ n: 2, mark: 'second' });
  });
});

describe('encrypted-store: Store programmatic API', () => {
  it('Open, read, and replace are available without a domain model', async () => {
    const dataDir = await makeDataDir();
    const store = await open(dataDir, KEY_A);
    expect(store.read()).toEqual({});
    await store.replace({ only: 'store-api' });
    expect(store.read()).toEqual({ only: 'store-api' });
  });
});

describe('encrypted-store: Project state directory and gitignore', () => {
  it('test DATA_DIR is a subdirectory inside data/', async () => {
    const dataDir = await makeDataDir();
    expect(dataDir.startsWith(dataRoot + path.sep) || dataDir.startsWith(dataRoot + '/')).toBe(
      true,
    );
    const relative = path.relative(repoRoot, dataDir);
    expect(relative.startsWith('data')).toBe(true);
  });

  it('State file path is the project data directory', async () => {
    const projectData = path.join(repoRoot, 'data');
    await mkdir(projectData, { recursive: true });
    const isolated = await mkdtemp(path.join(projectData, 'project-path-'));
    tempDirs.push(isolated);
    const store = await open(isolated, KEY_A);
    await store.replace({ pathCheck: true });
    const expected = path.join(isolated, 'state.bin');
    await access(expected);
    expect(path.relative(projectData, expected).includes('..')).toBe(false);
  });

  it('data/ is in .gitignore', async () => {
    const gitignore = await readFile(path.join(repoRoot, '.gitignore'), 'utf8');
    const lines = gitignore.split(/\r?\n/);
    expect(lines).toContain('data/');
    expect(lines.filter((line) => line === 'data/')).toHaveLength(1);
  });
});
