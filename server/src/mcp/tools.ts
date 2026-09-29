import type { AccountFieldValues } from '../connectors/contract.js';
import type { ConnectorRegistry } from '../connectors/registry.js';
import { mcpToolName } from '../connectors/registry.js';
import type { JsonObject } from '../store/codec.js';
import type { EncryptedStore } from '../store/store.js';
import type { ActiveConfiguration } from './auth.js';

export type McpListedTool = {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
};

export type EligibleAccount = {
  id: string;
  label: string;
  values: AccountFieldValues;
};

type AccountRow = {
  id: string;
  connector: string;
  label: string;
  enabled: boolean;
  values: Record<string, string>;
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

function readAccounts(document: JsonObject): AccountRow[] {
  const raw = document.accounts;
  if (!Array.isArray(raw)) {
    return [];
  }
  const rows: AccountRow[] = [];
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

/**
 * Eligible account: id in configuration.accountIds, exists, enabled, same connector.
 */
export function eligibleAccountsForConnector(
  configuration: ActiveConfiguration,
  store: EncryptedStore,
  connectorId: string,
): EligibleAccount[] {
  const accountsById = new Map(readAccounts(store.read()).map((row) => [row.id, row]));
  const eligible: EligibleAccount[] = [];
  for (const accountId of configuration.accountIds) {
    const account = accountsById.get(accountId);
    if (account === undefined) {
      continue;
    }
    if (!account.enabled) {
      continue;
    }
    if (account.connector !== connectorId) {
      continue;
    }
    eligible.push({
      id: account.id,
      label: account.label,
      values: account.values,
    });
  }
  return eligible;
}

function accountPropertyDescription(accounts: readonly EligibleAccount[]): string {
  return accounts.map((account) => `${account.id} (${account.label})`).join('\n');
}

export function buildToolInputSchema(
  authorProperties: Readonly<Record<string, unknown>> | undefined,
  authorRequired: readonly string[] | undefined,
  accounts: readonly EligibleAccount[],
): McpListedTool['inputSchema'] {
  const properties: Record<string, unknown> = {
    ...(authorProperties ?? {}),
    account: {
      type: 'string',
      enum: accounts.map((account) => account.id),
      description: accountPropertyDescription(accounts),
    },
  };
  const required = [...(authorRequired ?? [])];
  if (!required.includes('account')) {
    required.push('account');
  }
  return {
    type: 'object',
    properties,
    required,
  };
}

/**
 * Build tools/list for the active configuration from the connector registry.
 * A connector's tools appear only when it has at least one eligible account.
 */
export function listToolsForConfiguration(
  connectorRegistry: ConnectorRegistry,
  configuration: ActiveConfiguration,
  store: EncryptedStore,
): McpListedTool[] {
  const tools: McpListedTool[] = [];
  for (const connector of connectorRegistry.connectors) {
    const eligible = eligibleAccountsForConnector(configuration, store, connector.id);
    if (eligible.length === 0) {
      continue;
    }
    for (const tool of connector.tools) {
      tools.push({
        name: mcpToolName(connector.id, tool.name),
        description: tool.description,
        inputSchema: buildToolInputSchema(
          tool.inputSchema.properties,
          tool.inputSchema.required,
          eligible,
        ),
      });
    }
  }
  return tools;
}
