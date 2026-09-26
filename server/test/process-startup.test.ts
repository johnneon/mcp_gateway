import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');
const repoRoot = path.resolve(serverRoot, '..');
const mainJs = path.join(serverRoot, 'dist', 'main.js');

const ENCRYPTION_KEY = 'spawn-test-encryption-key-UNIQUE-9f3a';
const DATA_DIR = path.join(repoRoot, 'data', 'spawn-test-UNIQUE-dir');

type RunningProcess = {
  child: ChildProcessWithoutNullStreams;
  stdout: string;
  stderr: string;
};

const running: RunningProcess[] = [];

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
  throw new Error(`Timed out waiting for ${host}:${port}`);
}

async function startGateway(
  envOverrides: Record<string, string | undefined>,
): Promise<
  RunningProcess & { mcpHost: string; mcpPort: number; adminHost: string; adminPort: number }
> {
  const mcpPort = await getFreePort();
  const adminPort = await getFreePort();
  const mcpHost = '127.0.0.1';
  const adminHost =
    envOverrides.ADMIN_HOST === undefined || envOverrides.ADMIN_HOST === ''
      ? '127.0.0.1'
      : envOverrides.ADMIN_HOST;

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MCP_HOST: mcpHost,
    MCP_PORT: String(mcpPort),
    ADMIN_PORT: String(adminPort),
    DATA_DIR,
    ENCRYPTION_KEY,
    ...envOverrides,
  };

  // Explicit undefined deletes the key for "not set" scenarios.
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) {
      delete env[key];
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

  await waitForPort(mcpHost, mcpPort, 10_000);
  await waitForPort(adminHost, adminPort, 10_000);

  return { ...state, mcpHost, mcpPort, adminHost, adminPort };
}

async function stopAll(): Promise<void> {
  while (running.length > 0) {
    const state = running.pop();
    if (!state) {
      continue;
    }
    if (!state.child.killed) {
      state.child.kill('SIGTERM');
    }
    await new Promise<void>((resolve) => {
      if (state.child.exitCode !== null) {
        resolve();
        return;
      }
      state.child.once('exit', () => resolve());
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

  const { access } = await import('node:fs/promises');
  await access(mainJs);
  await access(path.join(webRoot, 'dist', 'index.html'));
}, 120_000);

afterEach(async () => {
  await stopAll();
});

describe('process-startup: Два HTTP-слушателя при полном окружении', () => {
  it('Оба слушателя принимают соединение', async () => {
    const proc = await startGateway({ ADMIN_HOST: '127.0.0.1' });

    expect(await canConnect(proc.mcpHost, proc.mcpPort)).toBe(true);
    expect(await canConnect(proc.adminHost, proc.adminPort)).toBe(true);

    const combined = `${proc.stdout}${proc.stderr}`;
    expect(combined).not.toContain(ENCRYPTION_KEY);
    expect(combined).not.toContain(DATA_DIR);
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
    const response = await fetch(`http://${proc.adminHost}:${proc.adminPort}/`);
    expect(response.ok).toBe(true);
    const body = await response.text();
    expect(body.toLowerCase()).toContain('<!doctype html');
    expect(body).toContain('MCP Gateway');
  });
});
