import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildChildEnv } from '../../../src/connectors/proxy/env.js';
import {
  createProxyRuntime,
  PROXY_IDLE_TIMEOUT_MS,
  type ProxyRuntime,
  type ProxyRuntimeDeps,
  type ProxySchedule,
} from '../../../src/connectors/proxy/runtime.js';

const require = createRequire(import.meta.url);
const proxyDir = fileURLToPath(new URL('../../../src/connectors/proxy/', import.meta.url));

const openRuntimes: ProxyRuntime[] = [];
const tempDirs: string[] = [];

const envReportSchema = z.object({
  env: z.record(z.string()),
  execPath: z.string(),
  argv: z.array(z.string()),
  pid: z.number().int(),
});

type EnvReport = z.infer<typeof envReportSchema>;

const parentEnv = {
  PATH: '/proxy-parent-path',
  SYSTEMROOT: '/proxy-system-root',
  TEMP: 'proxy-parent-temp',
  TMP: 'proxy-parent-tmp',
  PATHEXT: '.PROXY',
  HOME: '/proxy-home',
  USERPROFILE: '/proxy-user-profile',
  ENCRYPTION_KEY: 'proxy-encryption-key',
  MCP_HOST: 'proxy-mcp-host',
};

const token = 'proxy-account-token';

afterEach(async () => {
  while (openRuntimes.length > 0) {
    const runtime = openRuntimes.pop();
    if (runtime !== undefined) {
      await runtime.close();
    }
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

function installedEntryPath(): string {
  return require.resolve('@mcp-gateway/fake-stdio-mcp');
}

type ManualClock = {
  now: () => number;
  schedule: ProxySchedule;
  advance: (ms: number) => void;
};

function createManualClock(start = 0): ManualClock {
  let time = start;
  const timers: Array<{ due: number; callback: () => void; cancelled: boolean }> = [];
  return {
    now: () => time,
    schedule(callback, delayMs) {
      const timer = { due: time + delayMs, callback, cancelled: false };
      timers.push(timer);
      return {
        cancel() {
          timer.cancelled = true;
        },
      };
    },
    advance(ms) {
      time += ms;
      const due = timers.filter((timer) => !timer.cancelled && timer.due <= time);
      for (const timer of due) {
        timer.cancelled = true;
        timer.callback();
      }
    },
  };
}

function openRuntime(
  deps: Pick<ProxyRuntimeDeps, 'platform' | 'parentEnv'> & Partial<ProxyRuntimeDeps>,
): ProxyRuntime {
  const clock = createManualClock();
  const runtime = createProxyRuntime({
    idleTimeoutMs: PROXY_IDLE_TIMEOUT_MS,
    now: clock.now,
    schedule: clock.schedule,
    ...deps,
  });
  openRuntimes.push(runtime);
  return runtime;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === 'EPERM') {
      return true;
    }
    return false;
  }
}

async function waitUntilExited(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!isProcessAlive(pid)) {
      return;
    }
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
  throw new Error(`Process ${String(pid)} is still running`);
}

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'proxy-runtime-'));
  tempDirs.push(dir);
  return dir;
}

async function readLaunchCount(filePath: string): Promise<number> {
  try {
    const text = await readFile(filePath, 'utf8');
    const parsed = Number.parseInt(text.trim(), 10);
    if (!Number.isInteger(parsed)) {
      return 0;
    }
    return parsed;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return 0;
    }
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function parseReport(text: string): EnvReport {
  return envReportSchema.parse(JSON.parse(text) as unknown);
}

function envHas(env: Record<string, string>, name: string): boolean {
  const target = name.toLowerCase();
  return Object.keys(env).some((key) => key.toLowerCase() === target);
}

describe('proxy-runtime: Pinned package and spawn without download', () => {
  it('Child starts from the installed file', async () => {
    const entryPath = installedEntryPath();
    const before = await stat(entryPath);
    expect(before.isFile()).toBe(true);

    const dir = await makeTempDir();
    const countFile = path.join(dir, 'launches.txt');
    const runtime = openRuntime({ platform: 'linux', parentEnv: { PATH: parentEnv.PATH } });
    const result = await runtime.call(
      {
        accountId: 'account-installed',
        entryPath,
        args: [countFile],
        variables: {},
      },
      'report_env',
      {},
    );
    const report = parseReport(result.text);

    expect(report.execPath).toBe(process.execPath);
    expect(report.argv[1]).toBe(entryPath);
    expect(await readLaunchCount(countFile)).toBe(1);
  });

  it('Missing entry file does not spawn', async () => {
    const dir = await makeTempDir();
    const countFile = path.join(dir, 'launches.txt');
    await writeFile(countFile, '0', 'utf8');
    const runtime = openRuntime({ platform: 'linux', parentEnv: { PATH: parentEnv.PATH } });

    await expect(
      runtime.call(
        {
          accountId: 'account-missing',
          entryPath: path.join(dir, 'missing-entry.js'),
          args: [countFile],
          variables: {},
        },
        'report_env',
        {},
      ),
    ).rejects.toThrow();

    expect(await readLaunchCount(countFile)).toBe(0);
  });
});

describe('proxy-runtime: One child process per account', () => {
  it('First call starts one process', async () => {
    const dir = await makeTempDir();
    const countFile = path.join(dir, 'launches.txt');
    const runtime = openRuntime({ platform: 'linux', parentEnv: { PATH: parentEnv.PATH } });
    const result = await runtime.call(
      {
        accountId: 'account-first',
        entryPath: installedEntryPath(),
        args: [countFile],
        variables: { TOKEN: token },
      },
      'report_env',
      {},
    );
    const report = parseReport(result.text);

    expect(await readLaunchCount(countFile)).toBe(1);
    expect(report.env.PATH).toBe(parentEnv.PATH);
    expect(report.env.TOKEN).toBe(token);
  });

  it('Second call reuses the running child', async () => {
    const dir = await makeTempDir();
    const countFile = path.join(dir, 'launches.txt');
    const runtime = openRuntime({ platform: 'linux', parentEnv: { PATH: parentEnv.PATH } });
    const descriptor = {
      accountId: 'account-reuse',
      entryPath: installedEntryPath(),
      args: [countFile],
      variables: { TOKEN: token },
    };
    const first = parseReport((await runtime.call(descriptor, 'report_env', {})).text);
    const second = parseReport((await runtime.call(descriptor, 'report_env', {})).text);

    expect(await readLaunchCount(countFile)).toBe(1);
    expect(second.pid).toBe(first.pid);
  });

  it('Two accounts get two processes', async () => {
    const dir = await makeTempDir();
    const countFile = path.join(dir, 'launches.txt');
    const runtime = openRuntime({ platform: 'linux', parentEnv: { PATH: parentEnv.PATH } });
    const entryPath = installedEntryPath();
    const alpha = parseReport(
      (
        await runtime.call(
          {
            accountId: 'account-alpha',
            entryPath,
            args: [countFile],
            variables: { TOKEN: 'alpha-token' },
          },
          'report_env',
          {},
        )
      ).text,
    );
    const beta = parseReport(
      (
        await runtime.call(
          {
            accountId: 'account-beta',
            entryPath,
            args: [countFile],
            variables: { TOKEN: 'beta-token' },
          },
          'report_env',
          {},
        )
      ).text,
    );

    expect(await readLaunchCount(countFile)).toBe(2);
    expect(alpha.env.TOKEN).toBe('alpha-token');
    expect(beta.env.TOKEN).toBe('beta-token');
    expect(JSON.stringify(alpha.env)).not.toContain('beta-token');
    expect(JSON.stringify(beta.env)).not.toContain('alpha-token');
    expect(alpha.pid).not.toBe(beta.pid);
  });

  it('Overlapping calls share one process', async () => {
    const dir = await makeTempDir();
    const countFile = path.join(dir, 'launches.txt');
    const runtime = openRuntime({ platform: 'linux', parentEnv: { PATH: parentEnv.PATH } });
    const descriptor = {
      accountId: 'account-overlap',
      entryPath: installedEntryPath(),
      args: [countFile],
      variables: { TOKEN: token },
    };
    const [firstResult, secondResult] = await Promise.all([
      runtime.call(descriptor, 'report_env', {}),
      runtime.call(descriptor, 'report_env', {}),
    ]);
    const first = parseReport(firstResult.text);
    const second = parseReport(secondResult.text);

    expect(await readLaunchCount(countFile)).toBe(1);
    expect(second.pid).toBe(first.pid);
  });
});

describe('proxy-runtime: Child environment is built from scratch', () => {
  it('Non-Windows child receives PATH and mapped variables only', async () => {
    const built = buildChildEnv({
      platform: 'linux',
      parentEnv,
      variables: { TOKEN: token },
    });
    expect(built).toEqual({ PATH: parentEnv.PATH, TOKEN: token });

    const runtimeSource = await readFile(path.join(proxyDir, 'runtime.ts'), 'utf8');
    const envSource = await readFile(path.join(proxyDir, 'env.ts'), 'utf8');
    const transportSource = await readFile(path.join(proxyDir, 'transport.ts'), 'utf8');
    for (const source of [runtimeSource, envSource, transportSource]) {
      expect(source).not.toMatch(/process\.env/);
      expect(source).not.toMatch(/process\.platform/);
    }

    const dir = await makeTempDir();
    const countFile = path.join(dir, 'launches.txt');
    const runtime = openRuntime({ platform: 'linux', parentEnv });
    const result = await runtime.call(
      {
        accountId: 'account-linux',
        entryPath: installedEntryPath(),
        args: [countFile],
        variables: { TOKEN: token },
      },
      'report_env',
      {},
    );
    const report = parseReport(result.text);

    expect(report.env.PATH).toBe(parentEnv.PATH);
    expect(report.env.TOKEN).toBe(token);
    for (const name of [
      'SYSTEMROOT',
      'TEMP',
      'TMP',
      'PATHEXT',
      'HOME',
      'USERPROFILE',
      'ENCRYPTION_KEY',
      'MCP_HOST',
    ]) {
      expect(envHas(report.env, name)).toBe(false);
    }
    expect(Object.values(report.env)).not.toContain(countFile);
  });

  it('Windows child also receives SYSTEMROOT', async () => {
    const built = buildChildEnv({
      platform: 'win32',
      parentEnv,
      variables: { TOKEN: token },
    });
    expect(built).toEqual({
      PATH: parentEnv.PATH,
      SYSTEMROOT: parentEnv.SYSTEMROOT,
      TOKEN: token,
    });

    const dir = await makeTempDir();
    const countFile = path.join(dir, 'launches.txt');
    const runtime = openRuntime({ platform: 'win32', parentEnv });
    const result = await runtime.call(
      {
        accountId: 'account-windows',
        entryPath: installedEntryPath(),
        args: [countFile],
        variables: { TOKEN: token },
      },
      'report_env',
      {},
    );
    const report = parseReport(result.text);

    expect(report.env.PATH).toBe(parentEnv.PATH);
    expect(report.env.SYSTEMROOT).toBe(parentEnv.SYSTEMROOT);
    expect(report.env.TOKEN).toBe(token);
    for (const name of [
      'TEMP',
      'TMP',
      'PATHEXT',
      'HOME',
      'USERPROFILE',
      'ENCRYPTION_KEY',
      'MCP_HOST',
    ]) {
      expect(envHas(report.env, name)).toBe(false);
    }
  });
});

describe('proxy-runtime: Idle stop and restart', () => {
  it('Production idle timeout is 5 minutes', async () => {
    expect(PROXY_IDLE_TIMEOUT_MS).toBe(300000);
    const runtimeSource = await readFile(path.join(proxyDir, 'runtime.ts'), 'utf8');
    const envSource = await readFile(path.join(proxyDir, 'env.ts'), 'utf8');
    const transportSource = await readFile(path.join(proxyDir, 'transport.ts'), 'utf8');
    for (const source of [runtimeSource, envSource, transportSource]) {
      expect(source).not.toMatch(/setTimeout/);
      expect(source).not.toMatch(/Date\.now/);
    }
  });

  it('Injected clock stops the child and the next call starts a new one', async () => {
    const idleTimeoutMs = 1000;
    const clock = createManualClock();
    const dir = await makeTempDir();
    const countFile = path.join(dir, 'launches.txt');
    const runtime = openRuntime({
      platform: 'linux',
      parentEnv: { PATH: parentEnv.PATH },
      idleTimeoutMs,
      now: clock.now,
      schedule: clock.schedule,
    });
    const descriptor = {
      accountId: 'account-idle',
      entryPath: installedEntryPath(),
      args: [countFile],
      variables: { TOKEN: token },
    };
    const first = parseReport((await runtime.call(descriptor, 'report_env', {})).text);

    expect(isProcessAlive(first.pid)).toBe(true);
    expect(await readLaunchCount(countFile)).toBe(1);

    clock.advance(idleTimeoutMs);
    await waitUntilExited(first.pid);

    expect(isProcessAlive(first.pid)).toBe(false);
    expect(await readLaunchCount(countFile)).toBe(1);

    const second = parseReport((await runtime.call(descriptor, 'report_env', {})).text);
    expect(await readLaunchCount(countFile)).toBe(2);
    expect(second.pid).not.toBe(first.pid);
  });
});

describe('proxy-runtime: Restart after the child exits', () => {
  it('Next call after exit starts a new process', async () => {
    const dir = await makeTempDir();
    const countFile = path.join(dir, 'launches.txt');
    const runtime = openRuntime({ platform: 'linux', parentEnv: { PATH: parentEnv.PATH } });
    const descriptor = {
      accountId: 'account-exit',
      entryPath: installedEntryPath(),
      args: [countFile],
      variables: { TOKEN: token },
    };
    await runtime.call(descriptor, 'report_env', {});
    expect(await readLaunchCount(countFile)).toBe(1);

    await expect(runtime.call(descriptor, 'crash', {})).rejects.toThrow(
      'The proxy server stopped.',
    );
    expect(await readLaunchCount(countFile)).toBe(1);

    await runtime.call(descriptor, 'report_env', {});
    expect(await readLaunchCount(countFile)).toBe(2);
  });

  it('In-flight call fails without the account secret', async () => {
    const secret = 'proxy-mapped-secret-VALUE';
    const dir = await makeTempDir();
    const countFile = path.join(dir, 'launches.txt');
    const runtime = openRuntime({ platform: 'linux', parentEnv: { PATH: parentEnv.PATH } });
    const descriptor = {
      accountId: 'account-secret',
      entryPath: installedEntryPath(),
      args: [countFile],
      variables: { TOKEN: secret },
    };
    await runtime.call(descriptor, 'report_env', {});

    let caught: unknown;
    try {
      await runtime.call(descriptor, 'crash', {});
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    const message = caught instanceof Error ? caught.message : String(caught);
    expect(message).toBe('The proxy server stopped.');
    expect(message).not.toContain(secret);
    expect(message).toMatch(/^[A-Za-z][A-Za-z .]*$/);
  });
});
