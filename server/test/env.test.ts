import { describe, expect, it } from 'vitest';
import { MissingEnvError, parseEnv } from '../src/env.js';

/** 32 zero-ish bytes as base64; value must not appear in error text. */
const SECRET_KEY = 'ZW52LXRlc3Qta2V5LTMyLWJ5dGVzLXBhZGRlZCEhISE=';
const SECRET_KEY_BYTES = Buffer.from(SECRET_KEY, 'base64');
const DATA_DIR_VALUE = 'C:\\tmp\\gateway-data-secret-path';
const MCP_HOST_VALUE = '127.0.0.1';
const MCP_PORT_VALUE = '3100';
const ADMIN_PORT_VALUE = '3200';

/** Valid base64 that decodes to 16 bytes, not 32. */
const WRONG_LENGTH_KEY = 'AQEBAQEBAQEBAQEBAQEBAQ==';
/** Characters outside the standard base64 alphabet. */
const INVALID_ALPHABET_KEY = 'not-valid-base64!!!@@@@####';

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

describe('process-startup: ENCRYPTION_KEY — base64 ровно 32 байта', () => {
  it('Неверная длина после base64 — имя ENCRYPTION_KEY', () => {
    expectMissingVariable(fullEnv({ ENCRYPTION_KEY: WRONG_LENGTH_KEY }), 'ENCRYPTION_KEY', [
      WRONG_LENGTH_KEY,
      SECRET_KEY,
      DATA_DIR_VALUE,
    ]);
  });

  it('Недопустимый base64 — имя ENCRYPTION_KEY', () => {
    expectMissingVariable(fullEnv({ ENCRYPTION_KEY: INVALID_ALPHABET_KEY }), 'ENCRYPTION_KEY', [
      INVALID_ALPHABET_KEY,
      SECRET_KEY,
      DATA_DIR_VALUE,
    ]);
  });

  it('Фикстуры старта используют валидный ключ без утечки', () => {
    const config = parseEnv(fullEnv());
    expect(Buffer.isBuffer(config.encryptionKey)).toBe(true);
    expect(config.encryptionKey).toEqual(SECRET_KEY_BYTES);
    expect(config.encryptionKey.length).toBe(32);
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
  it('returns parsed hosts, ports, dataDir, and encryptionKey Buffer', () => {
    const config = parseEnv(fullEnv());
    expect(config.mcpHost).toBe(MCP_HOST_VALUE);
    expect(config.mcpPort).toBe(3100);
    expect(config.adminHost).toBe('127.0.0.1');
    expect(config.adminPort).toBe(3200);
    expect(config.dataDir).toBe(DATA_DIR_VALUE);
    expect(config.encryptionKey).toEqual(SECRET_KEY_BYTES);
  });
});
