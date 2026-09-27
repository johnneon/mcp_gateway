import express, { type Express } from 'express';

/**
 * MCP listener app. Does not call listen — main.ts owns binding.
 * Streamable HTTP on /mcp is a later change; this registers a 501 stub.
 */
export function createMcpApp(): Express {
  const app = express();
  app.set('strict routing', true);

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.all('/mcp', (_req, res) => {
    res.status(501).set('Content-Type', 'text/plain; charset=utf-8').send('Not Implemented');
  });

  app.use((_req, res) => {
    res.status(404).set('Content-Type', 'text/plain; charset=utf-8').send('Not Found');
  });

  return app;
}
