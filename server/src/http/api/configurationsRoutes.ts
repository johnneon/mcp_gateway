import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import type { AccountsService } from '../../accounts/service.js';
import {
  ConfigurationNotFoundError,
  ConfigurationValidationError,
} from '../../configurations/errors.js';
import type { ConfigurationsService } from '../../configurations/service.js';

const createBodySchema = z.object({
  name: z.string().trim().min(1),
});

const patchBodySchema = z.object({
  enabled: z.boolean(),
});

const setAccountsBodySchema = z.object({
  accountIds: z.array(z.string().min(1)),
});

function sendNotFound(res: Response): void {
  res.status(404).set('Content-Type', 'text/plain; charset=utf-8').send('Not Found');
}

function sendBadRequest(res: Response): void {
  res.status(400).set('Content-Type', 'text/plain; charset=utf-8').send('Bad Request');
}

async function mapDomainErrors(
  res: Response,
  next: NextFunction,
  run: () => Promise<void>,
): Promise<void> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ConfigurationNotFoundError) {
      sendNotFound(res);
      return;
    }
    if (error instanceof ConfigurationValidationError) {
      sendBadRequest(res);
      return;
    }
    next(error);
  }
}

export function createConfigurationsRouter(
  service: ConfigurationsService,
  accounts: Pick<AccountsService, 'getRecord'>,
): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    res.status(200).json(service.list());
  });

  router.post('/', (req: Request, res: Response, next: NextFunction) => {
    void mapDomainErrors(res, next, async () => {
      const parsed = createBodySchema.safeParse(req.body);
      if (!parsed.success) {
        sendBadRequest(res);
        return;
      }
      const created = await service.create(parsed.data.name);
      res.status(201).json(created);
    });
  });

  router.post('/:id/rotate', (req: Request, res: Response, next: NextFunction) => {
    void mapDomainErrors(res, next, async () => {
      const id = req.params.id;
      if (typeof id !== 'string' || id.length === 0) {
        sendNotFound(res);
        return;
      }
      const rotated = await service.rotate(id);
      res.status(200).json(rotated);
    });
  });

  router.put('/:id/accounts', (req: Request, res: Response, next: NextFunction) => {
    void mapDomainErrors(res, next, async () => {
      const id = req.params.id;
      if (typeof id !== 'string' || id.length === 0) {
        sendNotFound(res);
        return;
      }
      const parsed = setAccountsBodySchema.safeParse(req.body);
      if (!parsed.success) {
        sendBadRequest(res);
        return;
      }
      for (const accountId of parsed.data.accountIds) {
        if (!accounts.getRecord(accountId)) {
          sendBadRequest(res);
          return;
        }
      }
      const updated = await service.setAccountIds(id, parsed.data.accountIds);
      res.status(200).json(updated);
    });
  });

  router.patch('/:id', (req: Request, res: Response, next: NextFunction) => {
    void mapDomainErrors(res, next, async () => {
      const id = req.params.id;
      if (typeof id !== 'string' || id.length === 0) {
        sendNotFound(res);
        return;
      }
      const parsed = patchBodySchema.safeParse(req.body);
      if (!parsed.success) {
        sendBadRequest(res);
        return;
      }
      const updated = await service.setEnabled(id, parsed.data.enabled);
      res.status(200).json(updated);
    });
  });

  router.delete('/:id', (req: Request, res: Response, next: NextFunction) => {
    void mapDomainErrors(res, next, async () => {
      const id = req.params.id;
      if (typeof id !== 'string' || id.length === 0) {
        sendNotFound(res);
        return;
      }
      await service.remove(id);
      res.status(204).send();
    });
  });

  return router;
}
