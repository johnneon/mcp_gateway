import { randomUUID } from 'node:crypto';
import type { EncryptedStore } from '../store/store.js';
import type { JsonObject } from '../store/codec.js';
import { generateToken, hashToken } from '../token/token.js';
import { ConfigurationNotFoundError, ConfigurationValidationError } from './errors.js';

export type ConfigurationRecord = {
  id: string;
  name: string;
  tokenHash: string;
  enabled: boolean;
  accountIds: string[];
};

export type ConfigurationPublic = {
  id: string;
  name: string;
  enabled: boolean;
  accountIds: string[];
};

export type ConfigurationWithToken = ConfigurationPublic & {
  token: string;
};

export type ConfigurationsService = {
  list(): ConfigurationPublic[];
  create(name: string): Promise<ConfigurationWithToken>;
  rotate(id: string): Promise<ConfigurationWithToken>;
  setEnabled(id: string, enabled: boolean): Promise<ConfigurationPublic>;
  setAccountIds(id: string, accountIds: string[]): Promise<ConfigurationPublic>;
  removeAccountIdFromAll(accountId: string): Promise<void>;
  remove(id: string): Promise<void>;
};

function isConfigurationRow(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === 'string' &&
    typeof row.name === 'string' &&
    typeof row.tokenHash === 'string' &&
    typeof row.enabled === 'boolean'
  );
}

function readAccountIds(row: Record<string, unknown>): string[] {
  if (!Array.isArray(row.accountIds)) {
    return [];
  }
  return row.accountIds.filter((id): id is string => typeof id === 'string');
}

function readConfigurations(document: JsonObject): ConfigurationRecord[] {
  const raw = document.configurations;
  if (!Array.isArray(raw)) {
    return [];
  }
  const rows: ConfigurationRecord[] = [];
  for (const value of raw) {
    if (!isConfigurationRow(value)) {
      continue;
    }
    rows.push({
      id: value.id as string,
      name: value.name as string,
      tokenHash: value.tokenHash as string,
      enabled: value.enabled as boolean,
      accountIds: readAccountIds(value),
    });
  }
  return rows;
}

function toPublic(row: ConfigurationRecord): ConfigurationPublic {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    accountIds: [...row.accountIds],
  };
}

function normalizeName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new ConfigurationValidationError('name must be a non-empty string');
  }
  return trimmed;
}

function assertNoDuplicateAccountIds(accountIds: string[]): void {
  const seen = new Set<string>();
  for (const id of accountIds) {
    if (seen.has(id)) {
      throw new ConfigurationValidationError('accountIds must not contain duplicates');
    }
    seen.add(id);
  }
}

async function writeConfigurations(
  store: EncryptedStore,
  rows: ConfigurationRecord[],
): Promise<void> {
  const document = store.read();
  await store.replace({ ...document, configurations: rows });
}

export function createConfigurationsService(store: EncryptedStore): ConfigurationsService {
  return {
    list(): ConfigurationPublic[] {
      return readConfigurations(store.read()).map(toPublic);
    },

    async create(name: string): Promise<ConfigurationWithToken> {
      const normalized = normalizeName(name);
      const token = generateToken();
      const row: ConfigurationRecord = {
        id: randomUUID(),
        name: normalized,
        tokenHash: hashToken(token),
        enabled: true,
        accountIds: [],
      };
      const rows = readConfigurations(store.read());
      rows.push(row);
      await writeConfigurations(store, rows);
      return { ...toPublic(row), token };
    },

    async rotate(id: string): Promise<ConfigurationWithToken> {
      const rows = readConfigurations(store.read());
      const index = rows.findIndex((row) => row.id === id);
      const current = index >= 0 ? rows[index] : undefined;
      if (!current) {
        throw new ConfigurationNotFoundError();
      }
      const token = generateToken();
      const updated: ConfigurationRecord = {
        ...current,
        tokenHash: hashToken(token),
      };
      rows[index] = updated;
      await writeConfigurations(store, rows);
      return { ...toPublic(updated), token };
    },

    async setEnabled(id: string, enabled: boolean): Promise<ConfigurationPublic> {
      const rows = readConfigurations(store.read());
      const index = rows.findIndex((row) => row.id === id);
      const current = index >= 0 ? rows[index] : undefined;
      if (!current) {
        throw new ConfigurationNotFoundError();
      }
      const updated: ConfigurationRecord = {
        ...current,
        enabled,
      };
      rows[index] = updated;
      await writeConfigurations(store, rows);
      return toPublic(updated);
    },

    async setAccountIds(id: string, accountIds: string[]): Promise<ConfigurationPublic> {
      assertNoDuplicateAccountIds(accountIds);
      const rows = readConfigurations(store.read());
      const index = rows.findIndex((row) => row.id === id);
      const current = index >= 0 ? rows[index] : undefined;
      if (!current) {
        throw new ConfigurationNotFoundError();
      }
      const updated: ConfigurationRecord = {
        ...current,
        accountIds: [...accountIds],
      };
      rows[index] = updated;
      await writeConfigurations(store, rows);
      return toPublic(updated);
    },

    async removeAccountIdFromAll(accountId: string): Promise<void> {
      const rows = readConfigurations(store.read());
      const next = rows.map((row) => ({
        ...row,
        accountIds: row.accountIds.filter((id) => id !== accountId),
      }));
      const changed = next.some(
        (row, index) => row.accountIds.length !== rows[index]?.accountIds.length,
      );
      if (!changed) {
        return;
      }
      await writeConfigurations(store, next);
    },

    async remove(id: string): Promise<void> {
      const rows = readConfigurations(store.read());
      const index = rows.findIndex((row) => row.id === id);
      if (index < 0) {
        throw new ConfigurationNotFoundError();
      }
      rows.splice(index, 1);
      await writeConfigurations(store, rows);
    },
  };
}
