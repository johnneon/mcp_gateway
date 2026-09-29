/**
 * Connector module contract. A field of type `host` means a hostname only:
 * no scheme, path, userinfo, or port in the value (enforced by a later accounts change).
 */

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

export type CheckConnection = (accountValues: AccountFieldValues) => void | Promise<void>;

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

export type NativeToolHandler = (
  args: Readonly<Record<string, unknown>>,
  accountValues: AccountFieldValues,
) => NativeToolResult | Promise<NativeToolResult>;

export type NativeConnectorTool = {
  name: string;
  description: string;
  inputSchema: ToolArgumentsSchema;
  handler: NativeToolHandler;
};

export type ConnectorModule = {
  id: string;
  name: string;
  kind: ConnectorKind;
  fields: readonly AccountField[];
  allowedDestinations: readonly AllowedDestination[];
  checkConnection: CheckConnection;
  tools: readonly NativeConnectorTool[];
};

export type RegistryTool = {
  mcpName: string;
  connectorId: string;
  name: string;
  description: string;
  inputSchema: ToolArgumentsSchema;
  handler: NativeToolHandler;
};

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
