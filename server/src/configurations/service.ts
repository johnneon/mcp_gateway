import { randomUUID } from 'node:crypto';
import type { EncryptedStore } from '../store/store.js';
import type { JsonObject } from '../store/codec.js';
import { generateToken, hashToken } from '../token/token.js';
import { ConfigurationNotFoundError, ConfigurationValidationError } from './errors.js';

export type DisabledToolsMap = Record<string, string[]>;

export type ConfigurationRecord = {
  id: string;
  name: string;
  tokenHash: string;
  enabled: boolean;
  accountIds: string[];
  disabledTools?: DisabledToolsMap;
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
  readDisabledToolNames(id: string, accountId: string): string[];
  replaceDisabledToolNames(
    id: string,
    accountId: string,
    toolNames: readonly string[],
  ): Promise<string[]>;
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

function readToolNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((name): name is string => typeof name === 'string');
}

/**
 * Absent property stays absent so a later write does not invent a denylist.
 * A present non-object becomes an empty map. A non-array value becomes [].
 */
function readDisabledTools(row: Record<string, unknown>): DisabledToolsMap | undefined {
  if (!Object.hasOwn(row, 'disabledTools')) {
    return undefined;
  }
  const raw = row.disabledTools;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {};
  }
  const map: DisabledToolsMap = {};
  for (const [accountId, value] of Object.entries(raw)) {
    map[accountId] = readToolNames(value);
  }
  return map;
}

function configurationRecord(row: Record<string, unknown>): ConfigurationRecord {
  const record: ConfigurationRecord = {
    id: row.id as string,
    name: row.name as string,
    tokenHash: row.tokenHash as string,
    enabled: row.enabled as boolean,
    accountIds: readAccountIds(row),
  };
  const disabledTools = readDisabledTools(row);
  if (disabledTools !== undefined) {
    record.disabledTools = disabledTools;
  }
  return record;
}

function withAccounts(
  row: ConfigurationRecord,
  accountIds: string[],
  disabledTools: DisabledToolsMap | undefined,
): ConfigurationRecord {
  const next: ConfigurationRecord = {
    id: row.id,
    name: row.name,
    tokenHash: row.tokenHash,
    enabled: row.enabled,
    accountIds,
  };
  if (disabledTools !== undefined) {
    next.disabledTools = disabledTools;
  }
  return next;
}

function pruneDisabledTools(
  disabledTools: DisabledToolsMap | undefined,
  accountIds: readonly string[],
): DisabledToolsMap | undefined {
  if (disabledTools === undefined) {
    return undefined;
  }
  const allowed = new Set(accountIds);
  const next: DisabledToolsMap = {};
  for (const [accountId, names] of Object.entries(disabledTools)) {
    if (allowed.has(accountId)) {
      next[accountId] = names;
    }
  }
  return next;
}

function requireAssignedConfiguration(
  rows: ConfigurationRecord[],
  id: string,
  accountId: string,
): { index: number; row: ConfigurationRecord } {
  const index = rows.findIndex((row) => row.id === id);
  const row = index >= 0 ? rows[index] : undefined;
  if (!row) {
    throw new ConfigurationNotFoundError();
  }
  if (!row.accountIds.includes(accountId)) {
    throw new ConfigurationValidationError('account is not assigned to this configuration');
  }
  return { index, row };
}

function dropDisabledToolsKey(
  disabledTools: DisabledToolsMap | undefined,
  accountId: string,
): DisabledToolsMap | undefined {
  if (disabledTools === undefined || !Object.hasOwn(disabledTools, accountId)) {
    return disabledTools;
  }
  const next: DisabledToolsMap = {};
  for (const [key, names] of Object.entries(disabledTools)) {
    if (key !== accountId) {
      next[key] = names;
    }
  }
  return next;
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
    rows.push(configurationRecord(value));
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
      const updated = withAccounts(
        current,
        [...accountIds],
        pruneDisabledTools(current.disabledTools, accountIds),
      );
      rows[index] = updated;
      await writeConfigurations(store, rows);
      return toPublic(updated);
    },

    readDisabledToolNames(id: string, accountId: string): string[] {
      const rows = readConfigurations(store.read());
      const { row } = requireAssignedConfiguration(rows, id, accountId);
      const names = row.disabledTools?.[accountId];
      return names === undefined ? [] : [...names];
    },

    async replaceDisabledToolNames(
      id: string,
      accountId: string,
      toolNames: readonly string[],
    ): Promise<string[]> {
      const rows = readConfigurations(store.read());
      const { index, row } = requireAssignedConfiguration(rows, id, accountId);
      const disabledTools: DisabledToolsMap = { ...(row.disabledTools ?? {}) };
      const stored = [...toolNames];
      disabledTools[accountId] = stored;
      rows[index] = withAccounts(row, [...row.accountIds], disabledTools);
      await writeConfigurations(store, rows);
      return stored;
    },

    async removeAccountIdFromAll(accountId: string): Promise<void> {
      const rows = readConfigurations(store.read());
      const next: ConfigurationRecord[] = [];
      let changed = false;
      for (const row of rows) {
        const accountIds = row.accountIds.filter((id) => id !== accountId);
        const disabledTools = dropDisabledToolsKey(row.disabledTools, accountId);
        if (accountIds.length !== row.accountIds.length || disabledTools !== row.disabledTools) {
          changed = true;
        }
        next.push(withAccounts(row, accountIds, disabledTools));
      }
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
