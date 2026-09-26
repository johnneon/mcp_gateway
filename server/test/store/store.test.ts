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

describe('encrypted-store: Отсутствие файла даёт пустое состояние без создания файла', () => {
  it('Нет файла — память {} и файл не создан', async () => {
    const dataDir = await makeDataDir();
    const store = await open(dataDir, KEY_A);
    expect(store.read()).toEqual({});
    await expect(access(path.join(dataDir, 'state.bin'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});

describe('encrypted-store: Чужой ключ и битый файл отвергаются без утечки', () => {
  it('Чужой ключ — cannot be decrypted', async () => {
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

  it('Усечённый или повреждённый файл — corrupt', async () => {
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

  it('Версия не 1 — corrupt без утечки', async () => {
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

  it('Расшифрованный не-объект JSON — corrupt', async () => {
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

describe('encrypted-store: Путь и формат файла состояния', () => {
  it('Файл лежит по согласованному пути', async () => {
    const dataDir = await makeDataDir();
    const filePath = path.join(dataDir, 'state.bin');
    await writeFile(filePath, encryptDocument(KEY_A, { ok: true }));
    const store = await open(dataDir, KEY_A);
    expect(store.read()).toEqual({ ok: true });
    const onDisk = await readFile(filePath);
    expect(onDisk[0]).toBe(1);
    expect(onDisk.length).toBeGreaterThanOrEqual(1 + 12 + 16);
  });
});

describe('encrypted-store: Программный API хранилища', () => {
  it('Open и read доступны без доменной модели', async () => {
    const dataDir = await makeDataDir();
    const store = await open(dataDir, KEY_A);
    expect(store.read()).toEqual({});
  });
});

describe('encrypted-store: Каталог состояния в проекте и gitignore', () => {
  it('тестовый DATA_DIR — подкаталог внутри data/', async () => {
    const dataDir = await makeDataDir();
    expect(dataDir.startsWith(dataRoot + path.sep) || dataDir.startsWith(dataRoot + '/')).toBe(
      true,
    );
    const relative = path.relative(repoRoot, dataDir);
    expect(relative.startsWith('data')).toBe(true);
  });
});
