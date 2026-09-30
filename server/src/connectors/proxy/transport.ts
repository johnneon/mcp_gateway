import type { ChildProcess } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { type JSONRPCMessage, JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js';

export class ChildPipeTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  private readonly lines: Interface;
  private finished = false;

  constructor(private readonly child: ChildProcess) {
    const stdout = child.stdout;
    if (stdout === null) {
      throw new Error('The proxy server stdout pipe is missing.');
    }
    this.lines = createInterface({ input: stdout, crlfDelay: Infinity });
    this.lines.on('line', (line) => {
      this.receiveLine(line);
    });
    child.on('exit', () => {
      this.finish();
    });
    child.stdout?.on('error', (error: Error) => {
      this.onerror?.(error);
    });
    child.stdin?.on('error', () => {
      // The child may exit while a write is in flight. Exit reports the stop.
    });
    // Flowing mode discards stderr so a full pipe cannot block the child.
    child.stderr?.resume();
  }

  start(): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) {
      return Promise.reject(new Error('The proxy server stopped.'));
    }
    return Promise.resolve();
  }

  send(message: JSONRPCMessage): Promise<void> {
    const stdin = this.child.stdin;
    if (stdin === null) {
      return Promise.reject(new Error('The proxy server stdin pipe is missing.'));
    }
    const payload = `${JSON.stringify(message)}\n`;
    return new Promise((resolve, reject) => {
      stdin.write(payload, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  async close(): Promise<void> {
    this.lines.close();
    if (this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill();
    }
    await waitForExit(this.child);
    this.finish();
  }

  private receiveLine(line: string): void {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      return;
    }
    try {
      const message = JSONRPCMessageSchema.parse(JSON.parse(trimmed) as unknown);
      this.onmessage?.(message);
    } catch (error) {
      const wrapped =
        error instanceof Error ? error : new Error('The proxy server sent an invalid message.');
      this.onerror?.(wrapped);
    }
  }

  private finish(): void {
    if (this.finished) {
      return;
    }
    this.finished = true;
    this.onclose?.();
  }
}

function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    child.once('exit', () => {
      resolve();
    });
  });
}
