import { describe, expect, it } from 'vitest';
import { MissingEnvError, parseEnv } from '../src/env.js';

const SECRET_KEY = 'test-encryption-key-DO-NOT-LEAK';
const DATA_DIR_VALUE = 'C:\\tmp\\gateway-data-secret-path';
const MCP_HOST_VALUE = '127.0.0.1';
const MCP_PORT_VALUE = '3100';
const ADMIN_PORT_VALUE = '3200';

function fullEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    MCP_HOST: MCP_HOST_VALUE,
    MCP_PORT: MCP_PORT_VALUE,
    ADMIN_PORT: ADMIN_PORT_VALUE,
    DATA_DIR: DATA_DIR_VALUE,
    ENCRYPTION_KEY: SECRET_KEY,
    ...overrides,
  };
}

function expectMissingVariable(
  env: Record<string, string | undefined>,
  variable: string,
  secretSamples: string[],
): void {
  let caught: unknown;
  try {
    parseEnv(env);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(MissingEnvError);
  const err = caught as MissingEnvError;
  expect(err.variable).toBe(variable);
  expect(err.message).toBe(variable);
  for (const sample of secretSamples) {
    expect(err.message).not.toContain(sample);
  }
}

describe('process-startup: Обязательные переменные окружения при старте', () => {
  it('Нет MCP_HOST — MissingEnvError with name only', () => {
    expectMissingVariable(fullEnv({ MCP_HOST: undefined }), 'MCP_HOST', [
      SECRET_KEY,
      DATA_DIR_VALUE,
      MCP_PORT_VALUE,
      ADMIN_PORT_VALUE,
    ]);
  });

  it('Нет MCP_HOST — empty string treated as missing', () => {
    expectMissingVariable(fullEnv({ MCP_HOST: '' }), 'MCP_HOST', [SECRET_KEY, DATA_DIR_VALUE]);
  });

  it('Нет MCP_PORT — MissingEnvError with name only', () => {
    expectMissingVariable(fullEnv({ MCP_PORT: undefined }), 'MCP_PORT', [
      SECRET_KEY,
      DATA_DIR_VALUE,
      MCP_HOST_VALUE,
      ADMIN_PORT_VALUE,
    ]);
  });

  it('Нет ADMIN_PORT — MissingEnvError with name only', () => {
    expectMissingVariable(fullEnv({ ADMIN_PORT: undefined }), 'ADMIN_PORT', [
      SECRET_KEY,
      DATA_DIR_VALUE,
      MCP_HOST_VALUE,
      MCP_PORT_VALUE,
    ]);
  });

  it('Нет DATA_DIR — MissingEnvError with name only', () => {
    expectMissingVariable(fullEnv({ DATA_DIR: undefined }), 'DATA_DIR', [
      SECRET_KEY,
      MCP_HOST_VALUE,
      MCP_PORT_VALUE,
      ADMIN_PORT_VALUE,
    ]);
  });

  it('Нет ENCRYPTION_KEY — MissingEnvError with name only', () => {
    expectMissingVariable(fullEnv({ ENCRYPTION_KEY: undefined }), 'ENCRYPTION_KEY', [
      SECRET_KEY,
      DATA_DIR_VALUE,
      MCP_HOST_VALUE,
      MCP_PORT_VALUE,
      ADMIN_PORT_VALUE,
    ]);
  });
});

describe('process-startup: ADMIN_HOST по умолчанию 127.0.0.1', () => {
  it('ADMIN_HOST не задана — defaults to 127.0.0.1', () => {
    const config = parseEnv(fullEnv({ ADMIN_HOST: undefined }));
    expect(config.adminHost).toBe('127.0.0.1');
  });

  it('ADMIN_HOST пустая — defaults to 127.0.0.1', () => {
    const config = parseEnv(fullEnv({ ADMIN_HOST: '' }));
    expect(config.adminHost).toBe('127.0.0.1');
  });

  it('ADMIN_HOST задана явно — uses the provided host', () => {
    const config = parseEnv(fullEnv({ ADMIN_HOST: '127.0.0.1' }));
    expect(config.adminHost).toBe('127.0.0.1');
  });
});

describe('parseEnv success shape', () => {
  it('returns parsed hosts, ports, dataDir, and encryptionKey', () => {
    const config = parseEnv(fullEnv());
    expect(config).toEqual({
      mcpHost: MCP_HOST_VALUE,
      mcpPort: 3100,
      adminHost: '127.0.0.1',
      adminPort: 3200,
      dataDir: DATA_DIR_VALUE,
      encryptionKey: SECRET_KEY,
    });
  });
});
