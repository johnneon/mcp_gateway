import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import {
  AccountNotFoundError,
  AccountValidationError,
  ConnectionCheckFailedError,
} from '../../accounts/errors.js';
import type { AccountsService } from '../../accounts/service.js';

const stringValuesSchema = z.record(z.string(), z.string());

const createBodySchema = z.object({
  connector: z.string().min(1),
  label: z.string(),
  values: stringValuesSchema,
});

const patchBodySchema = z
  .object({
    label: z.string().optional(),
    values: stringValuesSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .refine(
    (body) => body.label !== undefined || body.values !== undefined || body.enabled !== undefined,
    { message: 'empty patch' },
  );

function sendNotFound(res: Response): void {
  res.status(404).set('Content-Type', 'text/plain; charset=utf-8').send('Not Found');
}

function sendBadRequest(res: Response, message = 'Bad Request'): void {
  res.status(400).set('Content-Type', 'text/plain; charset=utf-8').send(message);
}

async function mapDomainErrors(
  res: Response,
  next: NextFunction,
  run: () => Promise<void>,
): Promise<void> {
  try {
    await run();
  } catch (error) {
    if (error instanceof AccountNotFoundError) {
      sendNotFound(res);
      return;
    }
    if (error instanceof ConnectionCheckFailedError) {
      sendBadRequest(res, 'Connection check failed');
      return;
    }
    if (error instanceof AccountValidationError) {
      sendBadRequest(res);
      return;
    }
    next(error);
  }
}

export function createAccountsRouter(service: AccountsService): Router {
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
      const created = await service.create(parsed.data);
      res.status(201).json(created);
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
      const patch: {
        label?: string;
        values?: Record<string, string>;
        enabled?: boolean;
      } = {};
      if (parsed.data.label !== undefined) {
        patch.label = parsed.data.label;
      }
      if (parsed.data.values !== undefined) {
        patch.values = parsed.data.values;
      }
      if (parsed.data.enabled !== undefined) {
        patch.enabled = parsed.data.enabled;
      }
      const updated = await service.patch(id, patch);
      res.status(200).json(updated);
    });
  });

  router.post('/:id/check', (req: Request, res: Response, next: NextFunction) => {
    void mapDomainErrors(res, next, async () => {
      const id = req.params.id;
      if (typeof id !== 'string' || id.length === 0) {
        sendNotFound(res);
        return;
      }
      await service.check(id);
      res.status(200).json({ ok: true });
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
