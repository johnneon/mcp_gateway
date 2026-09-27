import express, { type Express, type Request, type Response } from 'express';
import { authenticateBearer, parseBearerToken } from '../mcp/auth.js';
import type { EncryptedStore } from '../store/store.js';

export type CreateMcpAppOptions = {
  store: EncryptedStore;
};

const UNAUTHORIZED_BODY = 'Unauthorized';

function sendUnauthorized(res: Response): void {
  res.status(401).set('Content-Type', 'text/plain; charset=utf-8').send(UNAUTHORIZED_BODY);
}

/**
 * MCP listener app. Does not call listen — main.ts owns binding.
 * Non-POST methods on /mcp are rejected before Streamable HTTP.
 */
export function createMcpApp(options: CreateMcpAppOptions): Express {
  const { store } = options;
  const app = express();
  app.set('strict routing', true);

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.post('/mcp', (req: Request, res: Response) => {
    const token = parseBearerToken(req.get('Authorization') ?? undefined);
    if (token === null || !authenticateBearer(store, token)) {
      sendUnauthorized(res);
      return;
    }
    // Streamable HTTP lands in the next task of this change.
    res.status(200).set('Content-Type', 'text/plain; charset=utf-8').send('OK');
  });

  app.all('/mcp', (_req, res) => {
    res.status(405).set('Content-Type', 'text/plain; charset=utf-8').send('Method Not Allowed');
  });

  app.use((_req, res) => {
    res.status(404).set('Content-Type', 'text/plain; charset=utf-8').send('Not Found');
  });

  return app;
}
