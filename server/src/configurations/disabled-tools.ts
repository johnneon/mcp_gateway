import type { AccountsService } from '../accounts/service.js';
import type { ConnectorRegistry } from '../connectors/registry.js';
import { ConfigurationValidationError } from './errors.js';
import type { ConfigurationsService } from './service.js';

export type DisabledToolsDeps = {
  configurations: ConfigurationsService;
  accounts: Pick<AccountsService, 'getRecord'>;
  registry: ConnectorRegistry;
};

export type DisabledToolsBody = {
  toolNames: string[];
};

function allowedToolNames(registry: ConnectorRegistry, connectorId: string): ReadonlySet<string> {
  const names = new Set<string>();
  for (const tool of registry.tools) {
    if (tool.connectorId === connectorId) {
      names.add(tool.mcpName);
    }
  }
  return names;
}

function assertReplacementNames(toolNames: readonly string[], allowed: ReadonlySet<string>): void {
  const seen = new Set<string>();
  for (const name of toolNames) {
    if (name.length === 0 || seen.has(name) || !allowed.has(name)) {
      throw new ConfigurationValidationError(
        'toolNames must list each MCP tool name of this account connector once',
      );
    }
    seen.add(name);
  }
}

export function readAccountDisabledTools(
  deps: DisabledToolsDeps,
  configurationId: string,
  accountId: string,
): DisabledToolsBody {
  return {
    toolNames: deps.configurations.readDisabledToolNames(configurationId, accountId),
  };
}

export async function replaceAccountDisabledTools(
  deps: DisabledToolsDeps,
  configurationId: string,
  accountId: string,
  toolNames: readonly string[],
): Promise<DisabledToolsBody> {
  deps.configurations.readDisabledToolNames(configurationId, accountId);
  const account = deps.accounts.getRecord(accountId);
  if (!account) {
    throw new ConfigurationValidationError('account is not assigned to this configuration');
  }
  assertReplacementNames(toolNames, allowedToolNames(deps.registry, account.connector));
  const stored = await deps.configurations.replaceDisabledToolNames(
    configurationId,
    accountId,
    toolNames,
  );
  return { toolNames: stored };
}
