export class MissingEnvError extends Error {
  readonly variable: string;

  constructor(variable: string) {
    super(variable);
    this.name = 'MissingEnvError';
    this.variable = variable;
  }
}

export type EnvConfig = {
  mcpHost: string;
  mcpPort: number;
  adminHost: string;
  adminPort: number;
  dataDir: string;
  encryptionKey: Buffer;
};

const STANDARD_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function readRequired(env: Record<string, string | undefined>, name: string): string {
  const value = env[name];
  if (value === undefined || value === '') {
    throw new MissingEnvError(name);
  }
  return value;
}

function parsePort(name: string, raw: string): number {
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new MissingEnvError(name);
  }
  return port;
}

function parseEncryptionKey(raw: string): Buffer {
  if (!STANDARD_BASE64.test(raw) || raw.length % 4 !== 0) {
    throw new MissingEnvError('ENCRYPTION_KEY');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new MissingEnvError('ENCRYPTION_KEY');
  }
  // Buffer.from is permissive; reject strings that round-trip differently.
  if (key.toString('base64') !== raw) {
    throw new MissingEnvError('ENCRYPTION_KEY');
  }
  return key;
}

/**
 * Parse gateway environment. Callers pass a plain object; only main.ts reads process.env.
 */
export function parseEnv(env: Record<string, string | undefined>): EnvConfig {
  const mcpHost = readRequired(env, 'MCP_HOST');
  const mcpPort = parsePort('MCP_PORT', readRequired(env, 'MCP_PORT'));
  const adminPort = parsePort('ADMIN_PORT', readRequired(env, 'ADMIN_PORT'));
  const dataDir = readRequired(env, 'DATA_DIR');
  const encryptionKey = parseEncryptionKey(readRequired(env, 'ENCRYPTION_KEY'));

  const adminHostRaw = env.ADMIN_HOST;
  const adminHost = adminHostRaw === undefined || adminHostRaw === '' ? '127.0.0.1' : adminHostRaw;

  return {
    mcpHost,
    mcpPort,
    adminHost,
    adminPort,
    dataDir,
    encryptionKey,
  };
}
