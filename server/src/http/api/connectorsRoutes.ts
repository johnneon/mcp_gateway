import { Router, type Request, type Response } from 'express';
import type { ConnectorRegistry } from '../../connectors/registry.js';

export function createConnectorsRouter(registry: ConnectorRegistry): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    res.status(200).json(registry.listPublic());
  });

  return router;
}
