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

type LiveChild = {
  accountId: string;
  client: Client;
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
  const lives: LiveChild[] = [];

  return {
    async call(descriptor, toolName, toolArguments) {
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
      try {
        await waitForSpawn(child);
        await client.connect(transport);
      } catch (error) {
        await transport.close();
        throw error;
      }

      lives.push({ accountId: descriptor.accountId, client });
      const result = await client.callTool({
        name: toolName,
        arguments: { ...toolArguments },
      });
      return { text: readToolText(result) };
    },

    async close() {
      const open = lives.splice(0);
      for (const live of open) {
        await live.client.close();
      }
    },
  };
}
