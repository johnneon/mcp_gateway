import { randomUUID } from 'node:crypto';
import type { AccountField, AccountFieldValues, ConnectorModule } from '../connectors/contract.js';
import type { ConnectorRegistry } from '../connectors/registry.js';
import type { ConfigurationsService } from '../configurations/service.js';
import type { JsonObject } from '../store/codec.js';
import type { EncryptedStore } from '../store/store.js';
import {
  AccountNotFoundError,
  AccountValidationError,
  ConnectionCheckFailedError,
} from './errors.js';

export type AccountRecord = {
  id: string;
  connector: string;
  label: string;
  values: Record<string, string>;
  enabled: boolean;
};

export type AccountPublic = {
  id: string;
  connector: string;
  label: string;
  values: Record<string, string>;
  enabled: boolean;
};

export type CreateAccountInput = {
  connector: string;
  label: string;
  values: Record<string, string>;
};

export type PatchAccountInput = {
  label?: string;
  values?: Record<string, string>;
  enabled?: boolean;
};

export type AccountsService = {
  list(): AccountPublic[];
  create(input: CreateAccountInput): Promise<AccountPublic>;
  patch(id: string, input: PatchAccountInput): Promise<AccountPublic>;
  check(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  getRecord(id: string): AccountRecord | undefined;
};

export type AccountsServiceDeps = {
  store: EncryptedStore;
  connectorRegistry: ConnectorRegistry;
  configurations: Pick<ConfigurationsService, 'removeAccountIdFromAll'>;
};

function isAccountRow(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === 'string' &&
    typeof row.connector === 'string' &&
    typeof row.label === 'string' &&
    typeof row.enabled === 'boolean' &&
    typeof row.values === 'object' &&
    row.values !== null &&
    !Array.isArray(row.values)
  );
}

function readValues(raw: unknown): Record<string, string> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string') {
      out[key] = value;
    }
  }
  return out;
}

function readAccounts(document: JsonObject): AccountRecord[] {
  const raw = document.accounts;
  if (!Array.isArray(raw)) {
    return [];
  }
  const rows: AccountRecord[] = [];
  for (const value of raw) {
    if (!isAccountRow(value)) {
      continue;
    }
    rows.push({
      id: value.id as string,
      connector: value.connector as string,
      label: value.label as string,
      enabled: value.enabled as boolean,
      values: readValues(value.values),
    });
  }
  return rows;
}

async function writeAccounts(store: EncryptedStore, rows: AccountRecord[]): Promise<void> {
  const document = store.read();
  await store.replace({ ...document, accounts: rows });
}

function normalizeLabel(label: string): string {
  const trimmed = label.trim();
  if (trimmed.length === 0) {
    throw new AccountValidationError('label must be a non-empty string');
  }
  return trimmed;
}

/**
 * Hostname only: no scheme, path, userinfo, or port.
 */
function isHostnameOnly(value: string): boolean {
  if (value.length === 0) {
    return false;
  }
  if (
    value.includes('://') ||
    value.includes('/') ||
    value.includes('@') ||
    value.includes(':') ||
    value.includes('?') ||
    value.includes('#') ||
    value.includes(' ')
  ) {
    return false;
  }
  return true;
}

function findConnector(
  registry: ConnectorRegistry,
  connectorId: string,
): ConnectorModule | undefined {
  return registry.connectors.find((module) => module.id === connectorId);
}

function assertStringValues(values: Record<string, string>): void {
  for (const [key, value] of Object.entries(values)) {
    if (typeof value !== 'string') {
      throw new AccountValidationError(`values.${key} must be a string`);
    }
  }
}

function assertKnownKeys(fields: readonly AccountField[], values: Record<string, string>): void {
  const known = new Set(fields.map((field) => field.name));
  for (const key of Object.keys(values)) {
    if (!known.has(key)) {
      throw new AccountValidationError(`unknown values key: ${key}`);
    }
  }
}

function assertHostValues(fields: readonly AccountField[], values: Record<string, string>): void {
  for (const field of fields) {
    if (field.type !== 'host') {
      continue;
    }
    if (!(field.name in values)) {
      continue;
    }
    const value = values[field.name];
    if (value === undefined) {
      continue;
    }
    if (!isHostnameOnly(value)) {
      throw new AccountValidationError(`host field ${field.name} must be a hostname only`);
    }
  }
}

function assertRequiredOnCreate(
  fields: readonly AccountField[],
  values: Record<string, string>,
): void {
  for (const field of fields) {
    if (!field.required) {
      continue;
    }
    const value = values[field.name];
    if (value === undefined || value.length === 0) {
      throw new AccountValidationError(`required field ${field.name} is missing or empty`);
    }
  }
}

function mergePatchValues(
  fields: readonly AccountField[],
  stored: Record<string, string>,
  patch: Record<string, string>,
): Record<string, string> {
  assertKnownKeys(fields, patch);
  const merged: Record<string, string> = { ...stored };
  for (const field of fields) {
    if (!(field.name in patch)) {
      continue;
    }
    const next = patch[field.name];
    if (next === undefined) {
      continue;
    }
    if (field.type === 'secret' && next === '') {
      continue;
    }
    if (field.required && field.type !== 'secret' && next === '') {
      throw new AccountValidationError(`required field ${field.name} cannot be empty`);
    }
    merged[field.name] = next;
  }
  assertHostValues(fields, merged);
  return merged;
}

function toPublic(row: AccountRecord, registry: ConnectorRegistry): AccountPublic {
  const connector = findConnector(registry, row.connector);
  const values: Record<string, string> = {};
  if (!connector) {
    return {
      id: row.id,
      connector: row.connector,
      label: row.label,
      enabled: row.enabled,
      values,
    };
  }
  const secretNames = new Set(
    connector.fields.filter((field) => field.type === 'secret').map((field) => field.name),
  );
  for (const [key, value] of Object.entries(row.values)) {
    if (secretNames.has(key)) {
      continue;
    }
    values[key] = value;
  }
  return {
    id: row.id,
    connector: row.connector,
    label: row.label,
    enabled: row.enabled,
    values,
  };
}

async function runCheckConnection(
  connector: ConnectorModule,
  values: AccountFieldValues,
): Promise<void> {
  try {
    await connector.checkConnection(values);
  } catch {
    throw new ConnectionCheckFailedError();
  }
}

export function createAccountsService(deps: AccountsServiceDeps): AccountsService {
  const { store, connectorRegistry, configurations } = deps;

  return {
    list(): AccountPublic[] {
      return readAccounts(store.read()).map((row) => toPublic(row, connectorRegistry));
    },

    getRecord(id: string): AccountRecord | undefined {
      return readAccounts(store.read()).find((row) => row.id === id);
    },

    async create(input: CreateAccountInput): Promise<AccountPublic> {
      const connector = findConnector(connectorRegistry, input.connector);
      if (!connector) {
        throw new AccountValidationError('unknown connector');
      }
      const label = normalizeLabel(input.label);
      assertStringValues(input.values);
      assertKnownKeys(connector.fields, input.values);
      assertRequiredOnCreate(connector.fields, input.values);
      assertHostValues(connector.fields, input.values);

      await runCheckConnection(connector, input.values);

      const row: AccountRecord = {
        id: randomUUID(),
        connector: connector.id,
        label,
        values: { ...input.values },
        enabled: true,
      };
      const rows = readAccounts(store.read());
      rows.push(row);
      await writeAccounts(store, rows);
      return toPublic(row, connectorRegistry);
    },

    async patch(id: string, input: PatchAccountInput): Promise<AccountPublic> {
      const rows = readAccounts(store.read());
      const index = rows.findIndex((row) => row.id === id);
      const current = index >= 0 ? rows[index] : undefined;
      if (!current) {
        throw new AccountNotFoundError();
      }

      const connector = findConnector(connectorRegistry, current.connector);
      if (!connector) {
        throw new AccountValidationError('unknown connector');
      }

      const hasLabel = input.label !== undefined;
      const hasValues = input.values !== undefined;
      const hasEnabled = input.enabled !== undefined;

      if (!hasLabel && !hasValues && !hasEnabled) {
        throw new AccountValidationError('patch body is empty');
      }

      let label = current.label;
      if (input.label !== undefined) {
        label = normalizeLabel(input.label);
      }

      let values = current.values;
      if (input.values !== undefined) {
        assertStringValues(input.values);
        values = mergePatchValues(connector.fields, current.values, input.values);
      }

      const enabled = input.enabled !== undefined ? input.enabled : current.enabled;

      // Any patch that includes label or values rechecks, including secret-keep no-ops.
      if (hasLabel || hasValues) {
        await runCheckConnection(connector, values);
      }

      const updated: AccountRecord = {
        id: current.id,
        connector: current.connector,
        label,
        values,
        enabled,
      };
      rows[index] = updated;
      await writeAccounts(store, rows);
      return toPublic(updated, connectorRegistry);
    },

    async check(id: string): Promise<void> {
      const current = readAccounts(store.read()).find((row) => row.id === id);
      if (!current) {
        throw new AccountNotFoundError();
      }
      const connector = findConnector(connectorRegistry, current.connector);
      if (!connector) {
        throw new AccountValidationError('unknown connector');
      }
      await runCheckConnection(connector, current.values);
    },

    async remove(id: string): Promise<void> {
      const rows = readAccounts(store.read());
      const index = rows.findIndex((row) => row.id === id);
      if (index < 0) {
        throw new AccountNotFoundError();
      }
      rows.splice(index, 1);
      await writeAccounts(store, rows);
      await configurations.removeAccountIdFromAll(id);
    },
  };
}
