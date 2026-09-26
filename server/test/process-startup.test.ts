import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { encryptDocument } from '../src/store/codec.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');
const repoRoot = path.resolve(serverRoot, '..');
const mainJs = path.join(serverRoot, 'dist', 'main.js');
const dataRoot = path.join(repoRoot, 'data');

/** Valid standard base64 of exactly 32 bytes; must not appear in process output. */
const ENCRYPTION_KEY = 'c3Bhd24tdGVzdC1rZXktMzItYnl0ZXMtcGFkZGVkISE=';
const ENCRYPTION_KEY_BYTES = Buffer.from(ENCRYPTION_KEY, 'base64');
const OTHER_KEY = Buffer.from('spawn-other-key-32-bytes-padded!');
const OTHER_KEY_B64 = OTHER_KEY.toString('base64');
const CANARY = 'SPAWN-CANARY-plaintext-UNIQUE-7e2c';

type RunningProcess = {
  child: ChildProcessWithoutNullStreams;
  stdout: string;
  stderr: string;
};

const running: RunningProcess[] = [];
const tempDirs: string[] = [];

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to allocate a free port'));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.on('error', reject);
  });
}

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    socket.once('connect', () => {
      socket.end();
      resolve(true);
    });
    socket.once('error', () => {
      resolve(false);
    });
  });
}

async function waitForPort(host: string, port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canConnect(host, port)) {
      return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timed out waiting for ${host}:${String(port)}`);
}

async function makeDataDir(): Promise<string> {
  await mkdir(dataRoot, { recursive: true });
  const dir = await mkdtemp(path.join(dataRoot, 'spawn-test-'));
  tempDirs.push(dir);
  return dir;
}

async function spawnGateway(options: {
  dataDir: string;
  encryptionKey?: string;
  envOverrides?: Record<string, string | undefined>;
}): Promise<
  RunningProcess & {
    mcpHost: string;
    mcpPort: number;
    adminHost: string;
    adminPort: number;
  }
> {
  const mcpPort = await getFreePort();
  const adminPort = await getFreePort();
  const mcpHost = '127.0.0.1';
  const envOverrides = options.envOverrides ?? {};
  const adminHost =
    envOverrides.ADMIN_HOST === undefined || envOverrides.ADMIN_HOST === ''
      ? '127.0.0.1'
      : envOverrides.ADMIN_HOST;

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MCP_HOST: mcpHost,
    MCP_PORT: String(mcpPort),
    ADMIN_PORT: String(adminPort),
    DATA_DIR: options.dataDir,
    ENCRYPTION_KEY: options.encryptionKey ?? ENCRYPTION_KEY,
  };

  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) {
      Reflect.deleteProperty(env, key);
    } else {
      env[key] = value;
    }
  }

  const child = spawn(process.execPath, [mainJs], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const state: RunningProcess = { child, stdout: '', stderr: '' };
  child.stdout.on('data', (chunk: Buffer) => {
    state.stdout += chunk.toString('utf8');
  });
  child.stderr.on('data', (chunk: Buffer) => {
    state.stderr += chunk.toString('utf8');
  });
  running.push(state);

  return Object.assign(state, { mcpHost, mcpPort, adminHost, adminPort });
}

async function startGateway(
  envOverrides: Record<string, string | undefined> = {},
  dataDir?: string,
): Promise<
  RunningProcess & { mcpHost: string; mcpPort: number; adminHost: string; adminPort: number }
> {
  const dir = dataDir ?? (await makeDataDir());
  const proc = await spawnGateway({ dataDir: dir, envOverrides });
  await waitForPort(proc.mcpHost, proc.mcpPort, 10_000);
  await waitForPort(proc.adminHost, proc.adminPort, 10_000);
  return proc;
}

async function waitForExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Timed out waiting for process exit'));
    }, timeoutMs);
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

async function stopAll(): Promise<void> {
  while (running.length > 0) {
    const state = running.pop();
    if (!state) {
      continue;
    }
    if (!state.child.killed && state.child.exitCode === null) {
      state.child.kill('SIGTERM');
    }
    await new Promise<void>((resolve) => {
      if (state.child.exitCode !== null) {
        resolve();
        return;
      }
      state.child.once('exit', () => {
        resolve();
      });
      setTimeout(() => {
        state.child.kill('SIGKILL');
        resolve();
      }, 2000);
    });
  }
}

beforeAll(async () => {
  const { execFileSync } = await import('node:child_process');
  const webRoot = path.join(repoRoot, 'web');
  const viteCli = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  const tscCli = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');

  execFileSync(process.execPath, [viteCli, 'build'], {
    cwd: webRoot,
    stdio: 'pipe',
  });
  execFileSync(process.execPath, [tscCli], {
    cwd: serverRoot,
    stdio: 'pipe',
  });

  await access(mainJs);
  await access(path.join(webRoot, 'dist', 'index.html'));
}, 120_000);

afterEach(async () => {
  await stopAll();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe('process-startup: Два HTTP-слушателя при полном окружении', () => {
  it('Оба слушателя принимают соединение', async () => {
    const dataDir = await makeDataDir();
    const proc = await startGateway({ ADMIN_HOST: '127.0.0.1' }, dataDir);

    expect(await canConnect(proc.mcpHost, proc.mcpPort)).toBe(true);
    expect(await canConnect(proc.adminHost, proc.adminPort)).toBe(true);

    const combined = `${proc.stdout}${proc.stderr}`;
    expect(combined).not.toContain(ENCRYPTION_KEY);
    expect(combined).not.toContain(dataDir);
  });
});

describe('process-startup: ENCRYPTION_KEY — base64 ровно 32 байта', () => {
  it('Фикстуры старта используют валидный ключ без утечки', async () => {
    const dataDir = await makeDataDir();
    const proc = await startGateway({ ADMIN_HOST: '127.0.0.1' }, dataDir);
    const combined = `${proc.stdout}${proc.stderr}`;
    expect(combined).not.toContain(ENCRYPTION_KEY);
    expect(ENCRYPTION_KEY_BYTES.length).toBe(32);
  });
});

describe('process-startup: ADMIN_HOST по умолчанию 127.0.0.1', () => {
  it('ADMIN_HOST не задана — listens on 127.0.0.1', async () => {
    const proc = await startGateway({ ADMIN_HOST: undefined });
    expect(await canConnect('127.0.0.1', proc.adminPort)).toBe(true);
    expect(proc.child.exitCode).toBeNull();
  });

  it('ADMIN_HOST задана явно — listens on that host', async () => {
    const proc = await startGateway({ ADMIN_HOST: '127.0.0.1' });
    expect(await canConnect('127.0.0.1', proc.adminPort)).toBe(true);
  });
});

describe('process-startup: Admin раздаёт production-сборку web', () => {
  it('Корень admin отдаёт HTML оболочки', async () => {
    const proc = await startGateway({ ADMIN_HOST: '127.0.0.1' });
    const response = await fetch(`http://${proc.adminHost}:${String(proc.adminPort)}/`);
    expect(response.ok).toBe(true);
    const body = await response.text();
    expect(body.toLowerCase()).toContain('<!doctype html');
    expect(body).toContain('MCP Gateway');
  });
});

describe('process-startup: Старт с валидным или отсутствующим файлом состояния', () => {
  it('Нет state.bin — процесс слушает', async () => {
    const dataDir = await makeDataDir();
    const statePath = path.join(dataDir, 'state.bin');
    const proc = await startGateway({ ADMIN_HOST: '127.0.0.1' }, dataDir);
    expect(await canConnect(proc.mcpHost, proc.mcpPort)).toBe(true);
    expect(await canConnect(proc.adminHost, proc.adminPort)).toBe(true);
    await expect(access(statePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('Валидный state.bin — процесс слушает', async () => {
    const dataDir = await makeDataDir();
    await writeFile(
      path.join(dataDir, 'state.bin'),
      encryptDocument(ENCRYPTION_KEY_BYTES, { hello: true }),
    );
    const proc = await startGateway({ ADMIN_HOST: '127.0.0.1' }, dataDir);
    expect(await canConnect(proc.mcpHost, proc.mcpPort)).toBe(true);
    expect(await canConnect(proc.adminHost, proc.adminPort)).toBe(true);
  });
});

describe('process-startup: Отказ хранилища не открывает порты', () => {
  it('Чужой ключ — порты закрыты', async () => {
    const dataDir = await makeDataDir();
    await writeFile(
      path.join(dataDir, 'state.bin'),
      encryptDocument(OTHER_KEY, { secret: CANARY }),
    );
    const mcpPort = await getFreePort();
    const adminPort = await getFreePort();
    const proc = await spawnGateway({
      dataDir,
      encryptionKey: ENCRYPTION_KEY,
      envOverrides: {
        ADMIN_HOST: '127.0.0.1',
        MCP_PORT: String(mcpPort),
        ADMIN_PORT: String(adminPort),
      },
    });

    const exitCode = await waitForExit(proc.child, 10_000);
    expect(exitCode).toBe(1);
    expect(await canConnect('127.0.0.1', mcpPort)).toBe(false);
    expect(await canConnect('127.0.0.1', adminPort)).toBe(false);
    const combined = `${proc.stdout}${proc.stderr}`;
    expect(combined).toContain('state file cannot be decrypted');
    expect(combined).not.toContain(ENCRYPTION_KEY);
    expect(combined).not.toContain(OTHER_KEY_B64);
    expect(combined).not.toContain(CANARY);
  });

  it('Битый файл — порты закрыты', async () => {
    const dataDir = await makeDataDir();
    const truncated = Buffer.from([1, 2, 3, 4, 5]);
    await writeFile(path.join(dataDir, 'state.bin'), truncated);
    const mcpPort = await getFreePort();
    const adminPort = await getFreePort();
    const proc = await spawnGateway({
      dataDir,
      encryptionKey: ENCRYPTION_KEY,
      envOverrides: {
        ADMIN_HOST: '127.0.0.1',
        MCP_PORT: String(mcpPort),
        ADMIN_PORT: String(adminPort),
      },
    });

    const exitCode = await waitForExit(proc.child, 10_000);
    expect(exitCode).toBe(1);
    expect(await canConnect('127.0.0.1', mcpPort)).toBe(false);
    expect(await canConnect('127.0.0.1', adminPort)).toBe(false);
    const combined = `${proc.stdout}${proc.stderr}`;
    expect(combined).toContain('state file is corrupt');
    expect(combined).not.toContain(ENCRYPTION_KEY);
    expect(combined).not.toContain(truncated.toString('utf8'));
  });
});
