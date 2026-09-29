import express, { type Express, type Request, type Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { ConnectorRegistry } from '../connectors/registry.js';
import type { EgressTransport } from '../connectors/native/egress.js';
import { dispatchToolCall } from '../mcp/call.js';
import {
  parseBearerToken,
  resolveActiveConfiguration,
  type ActiveConfiguration,
} from '../mcp/auth.js';
import { listToolsForConfiguration } from '../mcp/tools.js';
import type { EncryptedStore } from '../store/store.js';

export type CreateMcpAppOptions = {
  store: EncryptedStore;
  connectorRegistry: ConnectorRegistry;
  egressTransport?: EgressTransport;
};

const UNAUTHORIZED_BODY = 'Unauthorized';

function sendUnauthorized(res: Response): void {
  res.status(401).set('Content-Type', 'text/plain; charset=utf-8').send(UNAUTHORIZED_BODY);
}

function asArgumentRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

/**
 * Per-request McpServer bound to the active configuration and connector registry.
 * Omits listChanged so no tools/list_changed notifications are advertised.
 */
function createGatewayServer(
  connectorRegistry: ConnectorRegistry,
  configuration: ActiveConfiguration,
  store: EncryptedStore,
  egressTransport: EgressTransport | undefined,
): McpServer {
  const mcp = new McpServer({
    name: 'mcp-gateway',
    version: '0.0.0',
  });
  mcp.server.registerCapabilities({
    tools: {},
  });
  mcp.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: listToolsForConfiguration(connectorRegistry, configuration, store),
  }));
  mcp.server.setRequestHandler(CallToolRequestSchema, async (request) =>
    dispatchToolCall({
      connectorRegistry,
      configuration,
      store,
      toolName: request.params.name,
      args: asArgumentRecord(request.params.arguments),
      ...(egressTransport !== undefined ? { egressTransport } : {}),
    }),
  );
  return mcp;
}

/**
 * MCP listener app. Does not call listen — main.ts owns binding.
 * Non-POST methods on /mcp are rejected before Streamable HTTP.
 */
export function createMcpApp(options: CreateMcpAppOptions): Express {
  const { store, connectorRegistry, egressTransport } = options;
  const app = express();
  app.set('strict routing', true);

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.post('/mcp', express.json({ limit: '4mb' }), async (req: Request, res: Response) => {
    const token = parseBearerToken(req.get('Authorization') ?? undefined);
    if (token === null) {
      sendUnauthorized(res);
      return;
    }
    const configuration = resolveActiveConfiguration(store, token);
    if (configuration === null) {
      sendUnauthorized(res);
      return;
    }

    const server = createGatewayServer(connectorRegistry, configuration, store, egressTransport);
    // Omit sessionIdGenerator so it stays undefined (stateless Streamable HTTP).
    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true,
    });

    try {
      // SDK Transport typings disagree with exactOptionalPropertyTypes on onclose.
      await server.connect(transport as Transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) {
        res
          .status(500)
          .set('Content-Type', 'text/plain; charset=utf-8')
          .send('Internal Server Error');
      }
    } finally {
      await transport.close();
      await server.close();
    }
  });

  app.all('/mcp', (_req, res) => {
    res.status(405).set('Content-Type', 'text/plain; charset=utf-8').send('Method Not Allowed');
  });

  app.use((_req, res) => {
    res.status(404).set('Content-Type', 'text/plain; charset=utf-8').send('Not Found');
  });

  return app;
}
