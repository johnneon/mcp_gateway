import type { NextFunction, Request, Response } from 'express';

function mediaTypeOf(contentType: string | undefined): string | undefined {
  if (contentType === undefined || contentType.trim() === '') {
    return undefined;
  }
  const mediaType = contentType.split(';', 1)[0];
  return mediaType?.trim().toLowerCase();
}

/**
 * For every non-GET under /api: require Content-Type media type application/json.
 * charset parameters are allowed. Does not parse the body.
 */
export function requireJsonContentType(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD') {
    next();
    return;
  }
  if (mediaTypeOf(req.headers['content-type']) !== 'application/json') {
    res.status(415).set('Content-Type', 'text/plain; charset=utf-8').send('Unsupported Media Type');
    return;
  }
  next();
}
