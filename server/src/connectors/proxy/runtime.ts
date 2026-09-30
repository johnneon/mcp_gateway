import { spawn, type ChildProcess } from 'node:child_process';
import process from 'node:process';
import { stat } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { buildChildEnv } from './env.js';
import { ChildPipeTransport } from './transport.js';

export const MISSING_ENTRY_MESSAGE = 'The proxy server entry file is missing.';

export type ProxyDescriptor = {
  accountId: string;
  entryPath: string;
  args: readonly string[];
  variables: Readonly<Record<string, string>>;
};

export type ProxyCallResult = {
  text: string;
};

export type ProxyRuntimeDeps = {
  platform: string;
  parentEnv: Readonly<Record<string, string>>;
};

export type ProxyRuntime = {
  call(
    descriptor: ProxyDescriptor,
    toolName: string,
    toolArguments: Readonly<Record<string, unknown>>,
  ): Promise<ProxyCallResult>;
  close(): Promise<void>;
};

type Session = {
  accountId: string;
  client: Client;
  exited: boolean;
};

function isTextBlock(block: unknown): block is { type: 'text'; text: string } {
  if (typeof block !== 'object' || block === null) {
    return false;
  }
  if (!('type' in block) || block.type !== 'text') {
    return false;
  }
  return 'text' in block && typeof block.text === 'string';
}

function readToolText(result: unknown): string {
  if (typeof result !== 'object' || result === null || !('content' in result)) {
    throw new Error('The proxy server returned no text.');
  }
  const content = result.content;
  if (!Array.isArray(content)) {
    throw new Error('The proxy server returned no text.');
  }
  for (const block of content) {
    if (isTextBlock(block)) {
      return block.text;
    }
  }
  throw new Error('The proxy server returned no text.');
}

async function entryFileExists(entryPath: string): Promise<boolean> {
  try {
    const info = await stat(entryPath);
    return info.isFile();
  } catch {
    return false;
  }
}

function waitForSpawn(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once('spawn', () => {
      resolve();
    });
    child.once('error', (error: Error) => {
      reject(error);
    });
  });
}

export function createProxyRuntime(deps: ProxyRuntimeDeps): ProxyRuntime {
  const sessions = new Map<string, Session>();
  const starting = new Map<string, Promise<Session>>();
  const clients: Client[] = [];

  function claim(descriptor: ProxyDescriptor): Promise<Session> {
    const existing = sessions.get(descriptor.accountId);
    if (existing !== undefined && !existing.exited) {
      return Promise.resolve(existing);
    }
    const inflight = starting.get(descriptor.accountId);
    if (inflight !== undefined) {
      return inflight;
    }
    const pending = launch(descriptor);
    starting.set(descriptor.accountId, pending);
    return pending;
  }

  async function launch(descriptor: ProxyDescriptor): Promise<Session> {
    try {
      if (!(await entryFileExists(descriptor.entryPath))) {
        throw new Error(MISSING_ENTRY_MESSAGE);
      }

      const childEnv = buildChildEnv({
        platform: deps.platform,
        parentEnv: deps.parentEnv,
        variables: descriptor.variables,
      });
      // Complete environment. Do not spread the parent process environment.
      const child = spawn(process.execPath, [descriptor.entryPath, ...descriptor.args], {
        env: childEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
      });
      child.on('error', () => {
        // waitForSpawn rejects the first error. Later errors surface as exit.
      });

      const transport = new ChildPipeTransport(child);
      const client = new Client({ name: 'mcp-gateway-proxy', version: '1.0.0' });
      clients.push(client);
      try {
        await waitForSpawn(child);
        await client.connect(transport);
      } catch (error) {
        await transport.close();
        throw error;
      }

      const session: Session = { accountId: descriptor.accountId, client, exited: false };
      child.on('exit', () => {
        session.exited = true;
        if (sessions.get(descriptor.accountId) === session) {
          sessions.delete(descriptor.accountId);
        }
      });
      sessions.set(descriptor.accountId, session);
      return session;
    } finally {
      starting.delete(descriptor.accountId);
    }
  }

  return {
    async call(descriptor, toolName, toolArguments) {
      const session = await claim(descriptor);
      const result = await session.client.callTool({
        name: toolName,
        arguments: { ...toolArguments },
      });
      return { text: readToolText(result) };
    },

    async close() {
      const open = clients.splice(0);
      sessions.clear();
      starting.clear();
      for (const client of open) {
        await client.close();
      }
    },
  };
}
