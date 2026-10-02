import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';
import { createAccountsService } from '../accounts/service.js';
import type { EgressTransport } from '../connectors/native/egress.js';
import { productionConnectorRegistry, type ConnectorRegistry } from '../connectors/registry.js';
import { createConfigurationsService } from '../configurations/service.js';
import type { EncryptedStore } from '../store/store.js';
import { createAccountsRouter } from './api/accountsRoutes.js';
import { createConfigurationsRouter } from './api/configurationsRoutes.js';
import { createConnectorsRouter } from './api/connectorsRoutes.js';
import { requireJsonContentType } from './requireJsonContentType.js';

export type CreateAdminAppOptions = {
  store: EncryptedStore;
  connectorRegistry?: ConnectorRegistry;
  webRoot?: string;
  egressTransport?: EgressTransport;
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
  const connectorRegistry = options.connectorRegistry ?? productionConnectorRegistry;
  const app = express();
  const configurations = createConfigurationsService(options.store);
  const accounts = createAccountsService({
    store: options.store,
    connectorRegistry,
    configurations,
    ...(options.egressTransport !== undefined ? { egressTransport: options.egressTransport } : {}),
  });

  app.use('/api', requireJsonContentType);
  app.use('/api', express.json({ strict: false }));
  app.use(
    '/api/configurations',
    createConfigurationsRouter(configurations, accounts, connectorRegistry),
  );
  app.use('/api/accounts', createAccountsRouter(accounts));
  app.use('/api/connectors', createConnectorsRouter(connectorRegistry));

  // Before static: a file named mcp in webRoot must not be served as /mcp.
  app.all('/mcp', (_req, res) => {
    res.status(404).set('Content-Type', 'text/plain; charset=utf-8').send('Not Found');
  });

  app.use(express.static(webRoot));
  return app;
}
