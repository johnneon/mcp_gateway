/**
 * Connector module contract. A field of type `host` means a hostname only:
 * no scheme, path, userinfo, or port in the value (enforced by a later accounts change).
 */

import type { Duplex } from 'node:stream';

export type AccountFieldType = 'text' | 'secret' | 'host';

export type AccountField = {
  name: string;
  label: string;
  type: AccountFieldType;
  required: boolean;
};

export type ConstantAllowedDestination = {
  host: string;
  port: number;
};

export type FieldAllowedDestination = {
  field: string;
  port: number;
};

export type AllowedDestination = ConstantAllowedDestination | FieldAllowedDestination;

export type ConnectorKind = 'native' | 'proxy';

export type AccountFieldValues = Readonly<Record<string, string>>;

export type CheckConnection = (
  accountValues: AccountFieldValues,
  egressClient: NativeEgressClient,
) => void | Promise<void>;

/**
 * JSON Schema for tool arguments authored by the connector.
 * The gateway injects `account` at MCP list/call time; authors must not declare it.
 */
export type ToolArgumentsSchema = {
  type: 'object';
  properties?: Readonly<Record<string, unknown>>;
  required?: readonly string[];
  additionalProperties?: boolean | Readonly<Record<string, unknown>>;
};

export type NativeToolResult = {
  content: ReadonlyArray<{ type: 'text'; text: string }>;
};

/**
 * Gateway-built network client limited to the connector allowlist for one account.
 * Concrete implementation lives in connectors/native/egress.ts.
 */
export type NativeEgressClient = {
  httpsRequest(params: {
    host: string;
    port: number;
    method: string;
    path: string;
    headers?: Readonly<Record<string, string>>;
    body?: string | Uint8Array;
  }): Promise<{
    status: number;
    headers: Readonly<Record<string, string>>;
    body: Uint8Array;
  }>;
  /**
   * Handshake-only: connect then end the socket. Does not return a duplex for application bytes.
   */
  tlsConnect(params: { host: string; port: number }): Promise<void>;
  /**
   * Allowlist-checked TLS session that returns an open duplex for reading and writing.
   * Establishing the session does not end the duplex.
   */
  tlsSession(params: { host: string; port: number }): Promise<Duplex>;
};

export type NativeToolHandler = (
  args: Readonly<Record<string, unknown>>,
  accountValues: AccountFieldValues,
  egressClient: NativeEgressClient,
) => NativeToolResult | Promise<NativeToolResult>;

export type NativeConnectorTool = {
  name: string;
  description: string;
  inputSchema: ToolArgumentsSchema;
  handler: NativeToolHandler;
};

export type ProxyConnectorTool = {
  name: string;
  description: string;
  inputSchema: ToolArgumentsSchema;
};

export type ProxyEnvBinding = {
  field: string;
  variable: string;
};

type ConnectorModuleBase = {
  id: string;
  name: string;
  fields: readonly AccountField[];
  allowedDestinations: readonly AllowedDestination[];
  checkConnection: CheckConnection;
};

export type NativeConnectorModule = ConnectorModuleBase & {
  kind: 'native';
  tools: readonly NativeConnectorTool[];
};

export type ProxyConnectorModule = ConnectorModuleBase & {
  kind: 'proxy';
  tools: readonly ProxyConnectorTool[];
  entryPath: string;
  args: readonly string[];
  env: readonly ProxyEnvBinding[];
};

export type ConnectorModule = NativeConnectorModule | ProxyConnectorModule;

type RegistryToolBase = {
  mcpName: string;
  connectorId: string;
  name: string;
  description: string;
  inputSchema: ToolArgumentsSchema;
};

export type NativeRegistryTool = RegistryToolBase & {
  kind: 'native';
  handler: NativeToolHandler;
};

export type ProxyRegistryTool = RegistryToolBase & {
  kind: 'proxy';
};

export type RegistryTool = NativeRegistryTool | ProxyRegistryTool;

export type PublicConnectorField = {
  name: string;
  label: string;
  type: AccountFieldType;
  required: boolean;
};

export type PublicConnector = {
  id: string;
  name: string;
  kind: ConnectorKind;
  fields: readonly PublicConnectorField[];
};
