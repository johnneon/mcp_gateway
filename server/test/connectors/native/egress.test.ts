import { describe, expect, it } from 'vitest';
import type { ConnectorModule } from '../../../src/connectors/contract.js';
import {
  CONNECTION_FAILED_MESSAGE,
  createEgressClient,
  DESTINATION_NOT_ALLOWED_MESSAGE,
  EGRESS_DEFAULT_MAX_RESPONSE_BYTES,
  EGRESS_DEFAULT_TIMEOUT_MS,
  type EgressTransport,
  type EgressTransportHttpsParams,
  REDIRECT_NOT_ALLOWED_MESSAGE,
  resolveAllowedDestinations,
  RESPONSE_TOO_LARGE_MESSAGE,
} from '../../../src/connectors/native/egress.js';

function createCountingTransport(options?: {
  https?: (
    params: EgressTransportHttpsParams,
  ) => Promise<{ status: number; headers: Record<string, string>; body: Uint8Array }>;
  tls?: (params: { host: string; port: number }) => Promise<void>;
}): EgressTransport & { callCount: number; lastHttps?: EgressTransportHttpsParams } {
  const state: {
    callCount: number;
    lastHttps?: EgressTransportHttpsParams;
  } = { callCount: 0 };

  return {
    get callCount() {
      return state.callCount;
    },
    get lastHttps() {
      return state.lastHttps;
    },
    async httpsRequest(params) {
      state.callCount += 1;
      state.lastHttps = params;
      if (options?.https !== undefined) {
        return options.https(params);
      }
      return {
        status: 200,
        headers: {},
        body: new Uint8Array(0),
      };
    },
    async tlsConnect(params) {
      state.callCount += 1;
      if (options?.tls !== undefined) {
        await options.tls(params);
        return;
      }
    },
  };
}

describe('native-egress: Resolve allowed destinations for an account', () => {
  it('Constant and field-backed destinations resolve for an account', () => {
    const connector: Pick<ConnectorModule, 'fields' | 'allowedDestinations'> = {
      fields: [{ name: 'mailhost', label: 'Mail host', type: 'host', required: true }],
      allowedDestinations: [
        { host: 'imap.example.test', port: 993 },
        { field: 'mailhost', port: 465 },
      ],
    };
    const resolved = resolveAllowedDestinations(connector.allowedDestinations, {
      mailhost: 'Smtp.Example.Test',
    });
    expect(resolved).toEqual(
      expect.arrayContaining([
        { host: 'imap.example.test', port: 993 },
        { host: 'Smtp.Example.Test', port: 465 },
      ]),
    );
    expect(resolved).toHaveLength(2);
  });
});

describe('native-egress: Egress client refuses disallowed destinations before I/O', () => {
  it('Disallowed host:port leaves transport call count at zero', async () => {
    const transport = createCountingTransport();
    const client = createEgressClient({
      allowlist: [{ host: 'imap.example.test', port: 993 }],
      transport,
    });

    await expect(
      client.httpsRequest({
        host: 'evil.example.test',
        port: 443,
        method: 'GET',
        path: '/',
      }),
    ).rejects.toMatchObject({
      message: DESTINATION_NOT_ALLOWED_MESSAGE,
    });
    expect(transport.callCount).toBe(0);

    await expect(client.tlsConnect({ host: 'evil.example.test', port: 443 })).rejects.toMatchObject(
      {
        message: DESTINATION_NOT_ALLOWED_MESSAGE,
      },
    );
    expect(transport.callCount).toBe(0);
  });

  it('Allowed destination is case-insensitive on hostname', async () => {
    const transport = createCountingTransport();
    const client = createEgressClient({
      allowlist: [{ host: 'imap.example.test', port: 993 }],
      transport,
    });

    await client.tlsConnect({ host: 'IMAP.Example.TEST', port: 993 });
    expect(transport.callCount).toBe(1);
  });
});

describe('native-egress: HTTPS request and TLS connect operations', () => {
  it('HTTPS request to an allowed destination uses the fake transport once', async () => {
    const transport = createCountingTransport();
    const client = createEgressClient({
      allowlist: [{ host: 'api.example.test', port: 443 }],
      transport,
    });

    await client.httpsRequest({
      host: 'api.example.test',
      port: 443,
      method: 'GET',
      path: '/v1/ping',
      headers: {},
      body: new Uint8Array(0),
    });

    expect(transport.callCount).toBe(1);
    expect(transport.lastHttps).toMatchObject({
      host: 'api.example.test',
      port: 443,
      method: 'GET',
      path: '/v1/ping',
      redirect: 'manual',
    });
    expect(transport.lastHttps).not.toHaveProperty('url');
    expect(typeof client.httpsRequest).toBe('function');
    expect(client.httpsRequest.length).toBe(1);
  });

  it('TLS connect to an allowed destination uses the fake transport once', async () => {
    const transport = createCountingTransport();
    const client = createEgressClient({
      allowlist: [{ host: 'imap.example.test', port: 993 }],
      transport,
    });

    await client.tlsConnect({ host: 'imap.example.test', port: 993 });
    expect(transport.callCount).toBe(1);
  });
});

describe('native-egress: production defaults', () => {
  it('exposes timeout 30s and max body 67108864', () => {
    expect(EGRESS_DEFAULT_TIMEOUT_MS).toBe(30_000);
    expect(EGRESS_DEFAULT_MAX_RESPONSE_BYTES).toBe(67_108_864);
    expect(DESTINATION_NOT_ALLOWED_MESSAGE).toBe('Destination is not allowed');
    expect(REDIRECT_NOT_ALLOWED_MESSAGE).toBe('Redirect is not allowed');
    expect(CONNECTION_FAILED_MESSAGE).toBe('Connection failed');
    expect(RESPONSE_TOO_LARGE_MESSAGE).toBe('Response too large');
  });
});
