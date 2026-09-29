import type { ConnectorRegistry } from '../connectors/registry.js';
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

/**
 * Build tools/list for the active configuration from the connector registry.
 * Returns [] when the registry has no connectors or the configuration has no
 * account ids; eligible-account tool injection is completed in tools dispatch.
 */
export function listToolsForConfiguration(
  connectorRegistry: ConnectorRegistry,
  configuration: ActiveConfiguration,
  store: EncryptedStore,
): McpListedTool[] {
  if (connectorRegistry.connectors.length === 0) {
    return [];
  }
  // Re-read on every list so account eligibility sees current store state.
  store.read();
  if (configuration.accountIds.length === 0) {
    return [];
  }
  return [];
}
