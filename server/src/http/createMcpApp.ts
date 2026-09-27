import express, { type Express } from 'express';
import type { EncryptedStore } from '../store/store.js';

export type CreateMcpAppOptions = {
  store: EncryptedStore;
};

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

  app.post('/mcp', (_req, res) => {
    // Auth and Streamable HTTP land in later tasks of this change.
    store.read();
    res.status(401).set('Content-Type', 'text/plain; charset=utf-8').send('Unauthorized');
  });

  app.all('/mcp', (_req, res) => {
    res.status(405).set('Content-Type', 'text/plain; charset=utf-8').send('Method Not Allowed');
  });

  app.use((_req, res) => {
    res.status(404).set('Content-Type', 'text/plain; charset=utf-8').send('Not Found');
  });

  return app;
}
