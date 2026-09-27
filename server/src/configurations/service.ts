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
};

export type ConfigurationPublic = {
  id: string;
  name: string;
  enabled: boolean;
};

export type ConfigurationWithToken = ConfigurationPublic & {
  token: string;
};

export type ConfigurationsService = {
  list(): ConfigurationPublic[];
  create(name: string): Promise<ConfigurationWithToken>;
  rotate(id: string): Promise<ConfigurationWithToken>;
  setEnabled(id: string, enabled: boolean): Promise<ConfigurationPublic>;
  remove(id: string): Promise<void>;
};

function isConfigurationRecord(value: unknown): value is ConfigurationRecord {
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

function readConfigurations(document: JsonObject): ConfigurationRecord[] {
  const raw = document.configurations;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(isConfigurationRecord);
}

function toPublic(row: ConfigurationRecord): ConfigurationPublic {
  return { id: row.id, name: row.name, enabled: row.enabled };
}

function normalizeName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new ConfigurationValidationError('name must be a non-empty string');
  }
  return trimmed;
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
      };
      const rows = readConfigurations(store.read());
      rows.push(row);
      await store.replace({ configurations: rows });
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
        id: current.id,
        name: current.name,
        enabled: current.enabled,
        tokenHash: hashToken(token),
      };
      rows[index] = updated;
      await store.replace({ configurations: rows });
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
        id: current.id,
        name: current.name,
        tokenHash: current.tokenHash,
        enabled,
      };
      rows[index] = updated;
      await store.replace({ configurations: rows });
      return toPublic(updated);
    },

    async remove(id: string): Promise<void> {
      const rows = readConfigurations(store.read());
      const index = rows.findIndex((row) => row.id === id);
      if (index < 0) {
        throw new ConfigurationNotFoundError();
      }
      rows.splice(index, 1);
      await store.replace({ configurations: rows });
    },
  };
}
