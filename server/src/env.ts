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
  encryptionKey: string;
};

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

/**
 * Parse gateway environment. Callers pass a plain object; only main.ts reads process.env.
 */
export function parseEnv(env: Record<string, string | undefined>): EnvConfig {
  const mcpHost = readRequired(env, 'MCP_HOST');
  const mcpPort = parsePort('MCP_PORT', readRequired(env, 'MCP_PORT'));
  const adminPort = parsePort('ADMIN_PORT', readRequired(env, 'ADMIN_PORT'));
  const dataDir = readRequired(env, 'DATA_DIR');
  const encryptionKey = readRequired(env, 'ENCRYPTION_KEY');

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
