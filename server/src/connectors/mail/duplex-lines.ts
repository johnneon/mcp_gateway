import type { Duplex } from 'node:stream';

/**
 * Byte and line I/O over an already-connected duplex.
 * Does not open TCP or TLS sockets.
 */
export class DuplexLineSession {
  private buffer = Buffer.alloc(0);
  private readonly waiters: Array<{
    kind: 'line' | 'bytes';
    size?: number;
    resolve: (value: string | Buffer) => void;
    reject: (error: Error) => void;
  }> = [];
  private closed = false;
  private readonly onData: (chunk: Buffer | string) => void;
  private readonly onEnd: () => void;
  private readonly onError: (error: Error) => void;

  constructor(private readonly duplex: Duplex) {
    this.onData = (chunk: Buffer | string): void => {
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
      this.buffer = Buffer.concat([this.buffer, bytes]);
      this.pump();
    };
    this.onEnd = (): void => {
      this.failWaiters(new Error('Connection closed'));
    };
    this.onError = (error: Error): void => {
      this.failWaiters(error);
    };
    this.duplex.on('data', this.onData);
    this.duplex.on('end', this.onEnd);
    this.duplex.on('error', this.onError);
    this.duplex.resume();
  }

  async readLine(): Promise<string> {
    const existing = this.takeLine();
    if (existing !== undefined) {
      return existing;
    }
    if (this.closed) {
      throw new Error('Connection closed');
    }
    return await new Promise<string>((resolve, reject) => {
      this.waiters.push({
        kind: 'line',
        resolve: (value) => {
          resolve(value as string);
        },
        reject,
      });
    });
  }

  async readExact(size: number): Promise<Buffer> {
    if (size <= 0) {
      return Buffer.alloc(0);
    }
    if (this.buffer.byteLength >= size) {
      const out = this.buffer.subarray(0, size);
      this.buffer = this.buffer.subarray(size);
      return out;
    }
    if (this.closed) {
      throw new Error('Connection closed');
    }
    return await new Promise<Buffer>((resolve, reject) => {
      this.waiters.push({
        kind: 'bytes',
        size,
        resolve: (value) => {
          resolve(value as Buffer);
        },
        reject,
      });
    });
  }

  writeLine(line: string): void {
    this.duplex.write(`${line}\r\n`);
  }

  writeRaw(data: string | Buffer): void {
    this.duplex.write(data);
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.duplex.off('data', this.onData);
    this.duplex.off('end', this.onEnd);
    this.duplex.off('error', this.onError);
    this.failWaiters(new Error('Connection closed'));
  }

  private takeLine(): string | undefined {
    const crlf = this.buffer.indexOf('\r\n');
    if (crlf < 0) {
      return undefined;
    }
    const line = this.buffer.subarray(0, crlf).toString('utf8');
    this.buffer = this.buffer.subarray(crlf + 2);
    return line;
  }

  private pump(): void {
    while (this.waiters.length > 0) {
      const waiter = this.waiters[0];
      if (waiter === undefined) {
        return;
      }
      if (waiter.kind === 'line') {
        const line = this.takeLine();
        if (line === undefined) {
          return;
        }
        this.waiters.shift();
        waiter.resolve(line);
        continue;
      }
      const size = waiter.size ?? 0;
      if (this.buffer.byteLength < size) {
        return;
      }
      const out = this.buffer.subarray(0, size);
      this.buffer = this.buffer.subarray(size);
      this.waiters.shift();
      waiter.resolve(out);
    }
  }

  private failWaiters(error: Error): void {
    this.closed = true;
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      waiter?.reject(error);
    }
  }
}
