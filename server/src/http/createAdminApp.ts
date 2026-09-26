import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';

export type CreateAdminAppOptions = {
  webRoot?: string;
};

function defaultWebRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // server/src/http or server/dist/http → repo root → web/dist
  return path.resolve(here, '../../../web/dist');
}

/**
 * Admin listener app. Serves the web production build. Does not call listen.
 */
export function createAdminApp(options: CreateAdminAppOptions = {}): Express {
  const webRoot = options.webRoot ?? defaultWebRoot();
  const app = express();
  app.use(express.static(webRoot));
  return app;
}
