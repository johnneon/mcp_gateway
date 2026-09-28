export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function isMutationMethod(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD';
}

function messageFromBody(body: string, status: number): string {
  const trimmed = body.trim();
  if (trimmed.length > 0 && trimmed.length < 500 && !trimmed.startsWith('{')) {
    return trimmed;
  }
  if (trimmed.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed === 'object' && parsed !== null) {
        if (
          'message' in parsed &&
          typeof parsed.message === 'string' &&
          parsed.message.length > 0
        ) {
          return parsed.message;
        }
        if ('error' in parsed && typeof parsed.error === 'string' && parsed.error.length > 0) {
          return parsed.error;
        }
      }
    } catch {
      // Fall through to the status-based English message.
    }
  }
  return `Request failed with status ${String(status)}`;
}

export type ApiRequestOptions = Omit<RequestInit, 'body'> & {
  body?: unknown;
};

/**
 * Shared admin fetch helper. Mutations always send Content-Type: application/json.
 * Non-2xx responses become ApiError with a short English message.
 */
export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const headers = new Headers(options.headers);

  if (isMutationMethod(method) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const { body: rawBody, ...rest } = options;
  const init: RequestInit = {
    ...rest,
    method,
    headers,
  };
  if (rawBody !== undefined) {
    init.body = typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody);
  }

  const response = await fetch(path, init);
  if (!response.ok) {
    const text = await response.text();
    throw new ApiError(response.status, messageFromBody(text, response.status));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  if (text.length === 0) {
    return undefined as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(response.status, 'Invalid JSON response');
  }
}
