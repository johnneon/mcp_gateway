import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';
import { createConfigurationsService } from '../configurations/service.js';
import type { EncryptedStore } from '../store/store.js';
import { createConfigurationsRouter } from './api/configurationsRoutes.js';
import { requireJsonContentType } from './requireJsonContentType.js';

export type CreateAdminAppOptions = {
  store: EncryptedStore;
  webRoot?: string;
};

function defaultWebRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // server/src/http or server/dist/http → repo root → web/dist
  return path.resolve(here, '../../../web/dist');
}

/**
 * Admin listener app. Serves /api then the web production build. Does not call listen.
 */
export function createAdminApp(options: CreateAdminAppOptions): Express {
  const webRoot = options.webRoot ?? defaultWebRoot();
  const app = express();
  const configurations = createConfigurationsService(options.store);

  app.use('/api', requireJsonContentType);
  app.use('/api', express.json({ strict: false }));
  app.use('/api/configurations', createConfigurationsRouter(configurations));

  // Before static: a file named mcp in webRoot must not be served as /mcp.
  app.all('/mcp', (_req, res) => {
    res.status(404).set('Content-Type', 'text/plain; charset=utf-8').send('Not Found');
  });

  app.use(express.static(webRoot));
  return app;
}
