import { connect as tlsConnectSocket } from 'node:tls';
import type {
  AccountFieldValues,
  AllowedDestination,
  ConstantAllowedDestination,
  FieldAllowedDestination,
} from '../contract.js';

export const EGRESS_DEFAULT_TIMEOUT_MS = 30_000;
export const EGRESS_DEFAULT_MAX_RESPONSE_BYTES = 67_108_864;

export const DESTINATION_NOT_ALLOWED_MESSAGE = 'Destination is not allowed';
export const REDIRECT_NOT_ALLOWED_MESSAGE = 'Redirect is not allowed';
export const CONNECTION_FAILED_MESSAGE = 'Connection failed';
export const RESPONSE_TOO_LARGE_MESSAGE = 'Response too large';

export type EgressErrorCode =
  'destination_not_allowed' | 'redirect_not_allowed' | 'connection_failed' | 'response_too_large';

export class EgressError extends Error {
  readonly code: EgressErrorCode;

  constructor(code: EgressErrorCode, message: string) {
    super(message);
    this.name = 'EgressError';
    this.code = code;
  }
}

export function isEgressError(error: unknown): error is EgressError {
  return error instanceof EgressError;
}

export type ResolvedDestination = {
  host: string;
  port: number;
};

export type EgressHttpsParams = {
  host: string;
  port: number;
  method: string;
  path: string;
  headers: Readonly<Record<string, string>>;
  body: Uint8Array | undefined;
};

export type EgressHttpsResult = {
  status: number;
  headers: Readonly<Record<string, string>>;
  body: Uint8Array;
};

export type EgressTransportHttpsParams = EgressHttpsParams & {
  signal: AbortSignal;
  redirect: 'manual';
};

export type EgressTransportHttpsResult = {
  status: number;
  headers: Readonly<Record<string, string>>;
  body: AsyncIterable<Uint8Array> | Uint8Array;
};

export type EgressTransport = {
  httpsRequest(params: EgressTransportHttpsParams): Promise<EgressTransportHttpsResult>;
  tlsConnect(params: { host: string; port: number; signal: AbortSignal }): Promise<void>;
};

export type EgressClient = {
  httpsRequest(params: {
    host: string;
    port: number;
    method: string;
    path: string;
    headers?: Readonly<Record<string, string>>;
    body?: string | Uint8Array;
  }): Promise<EgressHttpsResult>;
  tlsConnect(params: { host: string; port: number }): Promise<void>;
};

export type CreateEgressClientOptions = {
  allowlist: readonly ResolvedDestination[];
  transport?: EgressTransport;
  timeoutMs?: number;
  maxResponseBytes?: number;
};

function isConstantDestination(value: AllowedDestination): value is ConstantAllowedDestination {
  return 'host' in value;
}

function isFieldDestination(value: AllowedDestination): value is FieldAllowedDestination {
  return 'field' in value;
}

/**
 * Resolve connector allowedDestinations into concrete host:port pairs for an account.
 * Field-backed entries use the non-empty host field value as stored.
 */
export function resolveAllowedDestinations(
  destinations: readonly AllowedDestination[],
  accountValues: AccountFieldValues,
): ResolvedDestination[] {
  const resolved: ResolvedDestination[] = [];
  for (const destination of destinations) {
    if (isConstantDestination(destination)) {
      resolved.push({ host: destination.host, port: destination.port });
      continue;
    }
    if (isFieldDestination(destination)) {
      const value = accountValues[destination.field];
      if (typeof value === 'string' && value.length > 0) {
        resolved.push({ host: value, port: destination.port });
      }
    }
  }
  return resolved;
}

function hostPortAllowed(
  allowlist: readonly ResolvedDestination[],
  host: string,
  port: number,
): boolean {
  const hostLower = host.toLowerCase();
  return allowlist.some((entry) => entry.port === port && entry.host.toLowerCase() === hostLower);
}

function assertAllowed(
  allowlist: readonly ResolvedDestination[],
  host: string,
  port: number,
): void {
  if (!hostPortAllowed(allowlist, host, port)) {
    throw new EgressError('destination_not_allowed', DESTINATION_NOT_ALLOWED_MESSAGE);
  }
}

function toBodyBytes(body: string | Uint8Array | undefined): Uint8Array | undefined {
  if (body === undefined) {
    return undefined;
  }
  if (typeof body === 'string') {
    return Buffer.from(body, 'utf8');
  }
  return body;
}

async function readBodyLimited(
  body: AsyncIterable<Uint8Array> | Uint8Array,
  maxResponseBytes: number,
): Promise<Uint8Array> {
  if (body instanceof Uint8Array) {
    if (body.byteLength > maxResponseBytes) {
      throw new EgressError('response_too_large', RESPONSE_TOO_LARGE_MESSAGE);
    }
    return body;
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of body) {
    total += chunk.byteLength;
    if (total > maxResponseBytes) {
      throw new EgressError('response_too_large', RESPONSE_TOO_LARGE_MESSAGE);
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return new Uint8Array(0);
  }
  if (chunks.length === 1) {
    const only = chunks[0];
    if (only === undefined) {
      return new Uint8Array(0);
    }
    return only;
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

function isAbortError(error: unknown): boolean {
  if (error instanceof Error && error.name === 'AbortError') {
    return true;
  }
  return (
    typeof error === 'object' && error !== null && 'code' in error && error.code === 'ABORT_ERR'
  );
}

function mapTransportFailure(error: unknown): never {
  if (isEgressError(error)) {
    throw error;
  }
  if (isAbortError(error)) {
    throw new EgressError('connection_failed', CONNECTION_FAILED_MESSAGE);
  }
  throw new EgressError('connection_failed', CONNECTION_FAILED_MESSAGE);
}

function createDefaultTransport(): EgressTransport {
  return {
    async httpsRequest(params) {
      const url = `https://${params.host}:${String(params.port)}${params.path}`;
      const init: RequestInit = {
        method: params.method,
        headers: params.headers,
        signal: params.signal,
        redirect: 'manual',
      };
      if (params.body !== undefined) {
        init.body = params.body;
      }
      let response: Response;
      try {
        response = await fetch(url, init);
      } catch (error) {
        mapTransportFailure(error);
      }

      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      const responseBody = response.body;
      async function* streamBody(): AsyncIterable<Uint8Array> {
        if (responseBody === null) {
          return;
        }
        for await (const chunk of responseBody) {
          if (chunk instanceof Uint8Array) {
            yield chunk;
          } else {
            yield new Uint8Array(chunk);
          }
        }
      }

      return {
        status: response.status,
        headers,
        body: streamBody(),
      };
    },

    async tlsConnect(params) {
      await new Promise<void>((resolve, reject) => {
        const socket = tlsConnectSocket(
          {
            host: params.host,
            port: params.port,
            servername: params.host,
          },
          () => {
            socket.end();
            resolve();
          },
        );
        const onAbort = (): void => {
          socket.destroy();
          const abortError = new Error('The operation was aborted');
          abortError.name = 'AbortError';
          reject(abortError);
        };
        if (params.signal.aborted) {
          onAbort();
          return;
        }
        params.signal.addEventListener('abort', onAbort, { once: true });
        socket.once('error', (error: Error) => {
          params.signal.removeEventListener('abort', onAbort);
          reject(error);
        });
        socket.once('close', () => {
          params.signal.removeEventListener('abort', onAbort);
        });
      });
    },
  };
}

function withTimeoutSignal(timeoutMs: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer);
    },
  };
}

/**
 * Build an egress client limited to the resolved allowlist.
 * Transport, timeout, and max body size are injectable for tests.
 */
export function createEgressClient(options: CreateEgressClientOptions): EgressClient {
  const allowlist = options.allowlist;
  const transport = options.transport ?? createDefaultTransport();
  const timeoutMs = options.timeoutMs ?? EGRESS_DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? EGRESS_DEFAULT_MAX_RESPONSE_BYTES;

  return {
    async httpsRequest(params) {
      assertAllowed(allowlist, params.host, params.port);
      const { signal, clear } = withTimeoutSignal(timeoutMs);
      try {
        let transportResult: EgressTransportHttpsResult;
        try {
          transportResult = await transport.httpsRequest({
            host: params.host,
            port: params.port,
            method: params.method,
            path: params.path,
            headers: params.headers ?? {},
            body: toBodyBytes(params.body),
            signal,
            redirect: 'manual',
          });
        } catch (error) {
          mapTransportFailure(error);
        }

        const body = await readBodyLimited(transportResult.body, maxResponseBytes);
        return {
          status: transportResult.status,
          headers: transportResult.headers,
          body,
        };
      } finally {
        clear();
      }
    },

    async tlsConnect(params) {
      assertAllowed(allowlist, params.host, params.port);
      const { signal, clear } = withTimeoutSignal(timeoutMs);
      try {
        try {
          await transport.tlsConnect({
            host: params.host,
            port: params.port,
            signal,
          });
        } catch (error) {
          mapTransportFailure(error);
        }
      } finally {
        clear();
      }
    },
  };
}

export function createEgressClientForAccount(options: {
  destinations: readonly AllowedDestination[];
  accountValues: AccountFieldValues;
  transport?: EgressTransport;
  timeoutMs?: number;
  maxResponseBytes?: number;
}): EgressClient {
  return createEgressClient({
    allowlist: resolveAllowedDestinations(options.destinations, options.accountValues),
    ...(options.transport !== undefined ? { transport: options.transport } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.maxResponseBytes !== undefined
      ? { maxResponseBytes: options.maxResponseBytes }
      : {}),
  });
}
