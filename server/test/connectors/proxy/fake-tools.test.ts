import { type ChildProcess, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

const require = createRequire(import.meta.url);
const STDERR_MARKER = 'fake-stdio-mcp-stderr-marker';

const toolResultSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.number(),
  result: z.object({
    content: z.array(z.object({ type: z.literal('text'), text: z.string() })).min(1),
  }),
});

type Waiter = {
  resolve: (text: string) => void;
  reject: (error: Error) => void;
};

type RunningFake = {
  child: ChildProcess;
  stderr: () => string;
  call: (name: string, args: Record<string, unknown>) => Promise<string>;
};

const children: ChildProcess[] = [];

afterEach(async () => {
  while (children.length > 0) {
    const child = children.pop();
    if (child !== undefined) {
      await stopChild(child);
    }
  }
});

function installedEntryPath(): string {
  return require.resolve('@mcp-gateway/fake-stdio-mcp');
}

function childEnv(token?: string): Record<string, string> {
  const env: Record<string, string> = {};
  if (process.env.PATH !== undefined) {
    env.PATH = process.env.PATH;
  }
  if (process.env.SYSTEMROOT !== undefined) {
    env.SYSTEMROOT = process.env.SYSTEMROOT;
  }
  if (token !== undefined) {
    env.TOKEN = token;
  }
  return env;
}

function startFake(env: Record<string, string>): RunningFake {
  const child = spawn(process.execPath, [installedEntryPath()], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  children.push(child);

  let stderrText = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderrText += chunk;
  });

  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  let nextId = 1;
  const pending = new Map<number, Waiter>();

  lines.on('line', (line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch (error) {
      rejectAll(pending, error instanceof Error ? error : new Error('Invalid JSON from fake'));
      return;
    }
    const message = toolResultSchema.safeParse(parsed);
    if (!message.success) {
      return;
    }
    const waiter = pending.get(message.data.id);
    if (waiter === undefined) {
      return;
    }
    pending.delete(message.data.id);
    const text = message.data.result.content[0]?.text;
    if (text === undefined) {
      waiter.reject(new Error('The fake server returned no text.'));
      return;
    }
    waiter.resolve(text);
  });

  child.on('error', (error) => {
    rejectAll(pending, error);
  });
  child.on('exit', () => {
    rejectAll(pending, new Error('The fake server stopped.'));
  });

  return {
    child,
    stderr: () => stderrText,
    call(name, args) {
      const id = nextId;
      nextId += 1;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        child.stdin.write(
          `${JSON.stringify({
            jsonrpc: '2.0',
            id,
            method: 'tools/call',
            params: { name, arguments: args },
          })}\n`,
        );
      });
    },
  };
}

function rejectAll(pending: Map<number, Waiter>, error: Error): void {
  for (const waiter of pending.values()) {
    waiter.reject(error);
  }
  pending.clear();
}

async function stopChild(child: ChildProcess): Promise<void> {
  child.stdin?.end();
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill();
  await new Promise<void>((resolve) => {
    child.once('exit', () => {
      resolve();
    });
  });
}

async function capturedStderr(running: RunningFake): Promise<string> {
  if (running.stderr().includes(STDERR_MARKER)) {
    return running.stderr();
  }
  await new Promise<void>((resolve, reject) => {
    const onData = (): void => {
      if (!running.stderr().includes(STDERR_MARKER)) {
        return;
      }
      running.child.stderr?.off('data', onData);
      resolve();
    };
    running.child.stderr?.on('data', onData);
    running.child.once('exit', () => {
      running.child.stderr?.off('data', onData);
      reject(new Error('The fake server exited before the stderr marker.'));
    });
  });
  return running.stderr();
}

describe('proxy-runtime: Fake stdio server echo and leak tools', () => {
  it('echo_args returns the arguments it received', async () => {
    const running = startFake(childEnv());
    const text = await running.call('echo_args', { note: 'hello' });
    const parsed: unknown = JSON.parse(text) as unknown;
    expect(parsed).toEqual({ note: 'hello' });
    expect(
      typeof parsed === 'object' &&
        parsed !== null &&
        Object.prototype.hasOwnProperty.call(parsed, 'account'),
    ).toBe(false);
  });

  it('leak_secret returns TOKEN and writes the stderr marker', async () => {
    const token = 'known-token-not-the-marker';
    const running = startFake(childEnv(token));
    const text = await running.call('leak_secret', {});
    const stderr = await capturedStderr(running);
    expect(text).toContain(token);
    expect(stderr).toContain(STDERR_MARKER);
    expect(text).not.toContain(STDERR_MARKER);
  });
});
