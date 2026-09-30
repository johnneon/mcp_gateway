import type {
  AccountField,
  AccountFieldType,
  AllowedDestination,
  ConnectorModule,
  ConstantAllowedDestination,
  FieldAllowedDestination,
  NativeConnectorModule,
  NativeConnectorTool,
  ProxyConnectorModule,
  ProxyConnectorTool,
  PublicConnector,
  RegistryTool,
  ToolArgumentsSchema,
} from './contract.js';
import { gmailConnector } from './gmail/index.js';
import { mailruConnector } from './mailru/index.js';

const ID_PATTERN = /^[a-z0-9]+$/;
const TOOL_NAME_PATTERN = /^[a-z0-9_]+$/;
const FIELD_TYPES: ReadonlySet<AccountFieldType> = new Set(['text', 'secret', 'host']);

export class ConnectorRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConnectorRegistryError';
  }
}

export type ConnectorRegistry = {
  readonly connectors: readonly ConnectorModule[];
  readonly tools: readonly RegistryTool[];
  listPublic(): PublicConnector[];
  getTool(mcpName: string): RegistryTool | undefined;
};

export function mcpToolName(connectorId: string, toolName: string): string {
  return `${connectorId}_${toolName}`;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isIntegerPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535;
}

function isConstantDestination(value: AllowedDestination): value is ConstantAllowedDestination {
  return 'host' in value;
}

function isFieldDestination(value: AllowedDestination): value is FieldAllowedDestination {
  return 'field' in value;
}

function assertValidField(field: AccountField, connectorId: string, seenNames: Set<string>): void {
  if (!isNonEmptyString(field.name) || !ID_PATTERN.test(field.name)) {
    throw new ConnectorRegistryError(
      `Connector "${connectorId}" has invalid field name "${field.name}"`,
    );
  }
  if (seenNames.has(field.name)) {
    throw new ConnectorRegistryError(
      `Connector "${connectorId}" has duplicate field name "${field.name}"`,
    );
  }
  seenNames.add(field.name);
  if (!isNonEmptyString(field.label)) {
    throw new ConnectorRegistryError(
      `Connector "${connectorId}" field "${field.name}" has empty label`,
    );
  }
  if (!FIELD_TYPES.has(field.type)) {
    throw new ConnectorRegistryError(
      `Connector "${connectorId}" field "${field.name}" has invalid type`,
    );
  }
  if (typeof field.required !== 'boolean') {
    throw new ConnectorRegistryError(
      `Connector "${connectorId}" field "${field.name}" has invalid required flag`,
    );
  }
}

function assertValidDestination(
  destination: AllowedDestination,
  connectorId: string,
  fieldsByName: Map<string, AccountField>,
): void {
  if (isConstantDestination(destination) && isFieldDestination(destination)) {
    throw new ConnectorRegistryError(
      `Connector "${connectorId}" has an allowed destination with both host and field`,
    );
  }
  if (isConstantDestination(destination)) {
    if (!isNonEmptyString(destination.host)) {
      throw new ConnectorRegistryError(
        `Connector "${connectorId}" has an allowed destination with empty host`,
      );
    }
    if (!isIntegerPort(destination.port)) {
      throw new ConnectorRegistryError(
        `Connector "${connectorId}" has an allowed destination with invalid port`,
      );
    }
    return;
  }
  if (isFieldDestination(destination)) {
    if (!isNonEmptyString(destination.field) || !ID_PATTERN.test(destination.field)) {
      throw new ConnectorRegistryError(
        `Connector "${connectorId}" has an allowed destination with invalid field reference`,
      );
    }
    if (!isIntegerPort(destination.port)) {
      throw new ConnectorRegistryError(
        `Connector "${connectorId}" has an allowed destination with invalid port`,
      );
    }
    const field = fieldsByName.get(destination.field);
    if (field === undefined || field.type !== 'host') {
      throw new ConnectorRegistryError(
        `Connector "${connectorId}" allowed destination field "${destination.field}" must name a host field`,
      );
    }
    return;
  }
  throw new ConnectorRegistryError(`Connector "${connectorId}" has an invalid allowed destination`);
}

function assertValidModule(module: ConnectorModule, seenIds: Set<string>): void {
  if (!isNonEmptyString(module.id) || !ID_PATTERN.test(module.id)) {
    throw new ConnectorRegistryError(`Invalid connector id "${module.id}"`);
  }
  if (seenIds.has(module.id)) {
    throw new ConnectorRegistryError(`Duplicate connector id "${module.id}"`);
  }
  seenIds.add(module.id);

  if (!isNonEmptyString(module.name)) {
    throw new ConnectorRegistryError(`Connector "${module.id}" has empty name`);
  }

  const kind: string = module.kind;
  if (kind !== 'native' && kind !== 'proxy') {
    throw new ConnectorRegistryError(`Connector "${module.id}" has invalid kind`);
  }

  const fields: readonly AccountField[] = module.fields;
  if (fields.length === 0) {
    throw new ConnectorRegistryError(`Connector "${module.id}" must declare at least one field`);
  }

  const seenFieldNames = new Set<string>();
  const fieldsByName = new Map<string, AccountField>();
  for (const field of fields) {
    assertValidField(field, module.id, seenFieldNames);
    fieldsByName.set(field.name, field);
  }

  const destinations: readonly AllowedDestination[] = module.allowedDestinations;
  if (destinations.length === 0) {
    throw new ConnectorRegistryError(
      `Connector "${module.id}" must declare at least one allowed destination`,
    );
  }
  for (const destination of destinations) {
    assertValidDestination(destination, module.id, fieldsByName);
  }

  if (typeof module.checkConnection !== 'function') {
    throw new ConnectorRegistryError(`Connector "${module.id}" must declare checkConnection`);
  }

  if (module.kind === 'proxy') {
    assertValidProxyModule(module, fieldsByName);
    return;
  }
  assertValidNativeTools(module);
}

function schemaDeclaresAccount(schema: ToolArgumentsSchema): boolean {
  const props = schema.properties;
  if (props === undefined) {
    return false;
  }
  return Object.prototype.hasOwnProperty.call(props, 'account');
}

function assertToolIdentity(
  tool: { name: string; description: string; inputSchema: ToolArgumentsSchema },
  connectorId: string,
  seenNames: Set<string>,
): void {
  if (!isNonEmptyString(tool.name) || !TOOL_NAME_PATTERN.test(tool.name)) {
    throw new ConnectorRegistryError(
      `Connector "${connectorId}" has invalid tool name "${tool.name}"`,
    );
  }
  if (seenNames.has(tool.name)) {
    throw new ConnectorRegistryError(
      `Connector "${connectorId}" has duplicate tool name "${tool.name}"`,
    );
  }
  seenNames.add(tool.name);

  if (!isNonEmptyString(tool.description)) {
    throw new ConnectorRegistryError(
      `Connector "${connectorId}" tool "${tool.name}" has empty description`,
    );
  }

  const schemaType: string = tool.inputSchema.type;
  if (schemaType !== 'object') {
    throw new ConnectorRegistryError(
      `Connector "${connectorId}" tool "${tool.name}" must declare an object arguments schema`,
    );
  }

  if (schemaDeclaresAccount(tool.inputSchema)) {
    throw new ConnectorRegistryError(
      `Connector "${connectorId}" tool "${tool.name}" must not declare property "account"`,
    );
  }
}

function assertValidNativeTools(module: NativeConnectorModule): void {
  const seenToolNames = new Set<string>();
  for (const tool of module.tools) {
    assertValidNativeTool(tool, module.id, seenToolNames);
  }
}

function assertValidNativeTool(
  tool: NativeConnectorTool,
  connectorId: string,
  seenNames: Set<string>,
): void {
  assertToolIdentity(tool, connectorId, seenNames);
  if (typeof tool.handler !== 'function') {
    throw new ConnectorRegistryError(
      `Connector "${connectorId}" tool "${tool.name}" must declare a handler`,
    );
  }
}

function isUnknownList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isStringList(value: unknown): value is readonly string[] {
  return isUnknownList(value) && value.every((item) => typeof item === 'string');
}

function readStringProperty(value: unknown, key: string): string {
  if (typeof value !== 'object' || value === null || !(key in value)) {
    return '';
  }
  const property = (value as Record<string, unknown>)[key];
  return typeof property === 'string' ? property : '';
}

function assertValidProxyModule(
  module: ProxyConnectorModule,
  fieldsByName: Map<string, AccountField>,
): void {
  if (!isNonEmptyString(module.entryPath)) {
    throw new ConnectorRegistryError(
      `Connector "${module.id}" must declare a non-empty entry path`,
    );
  }
  const args: unknown = module.args;
  if (!isStringList(args)) {
    throw new ConnectorRegistryError(`Connector "${module.id}" has invalid extra arguments`);
  }
  const env: unknown = module.env;
  if (!isUnknownList(env)) {
    throw new ConnectorRegistryError(`Connector "${module.id}" has invalid env bindings`);
  }
  for (const binding of env) {
    assertValidEnvBinding(binding, module.id, fieldsByName);
  }

  const seenToolNames = new Set<string>();
  for (const tool of module.tools) {
    assertValidProxyTool(tool, module.id, seenToolNames);
  }
}

function assertValidEnvBinding(
  binding: unknown,
  connectorId: string,
  fieldsByName: Map<string, AccountField>,
): void {
  const fieldName = readStringProperty(binding, 'field');
  if (!fieldsByName.has(fieldName)) {
    throw new ConnectorRegistryError(
      `Connector "${connectorId}" env binding field "${fieldName}" must name a field on the connector`,
    );
  }
  if (!isNonEmptyString(readStringProperty(binding, 'variable'))) {
    throw new ConnectorRegistryError(
      `Connector "${connectorId}" env binding has an empty variable name`,
    );
  }
}

function toolDeclaresHandler(tool: object): boolean {
  return 'handler' in tool && typeof tool.handler === 'function';
}

function assertValidProxyTool(
  tool: ProxyConnectorTool,
  connectorId: string,
  seenNames: Set<string>,
): void {
  assertToolIdentity(tool, connectorId, seenNames);
  if (toolDeclaresHandler(tool)) {
    throw new ConnectorRegistryError(
      `Connector "${connectorId}" tool "${tool.name}" must not declare a handler`,
    );
  }
}

function toPublicConnector(module: ConnectorModule): PublicConnector {
  return {
    id: module.id,
    name: module.name,
    kind: module.kind,
    fields: module.fields.map((field) => ({
      name: field.name,
      label: field.label,
      type: field.type,
      required: field.required,
    })),
  };
}

function freezeInputSchema(schema: ToolArgumentsSchema): ToolArgumentsSchema {
  return Object.freeze({
    ...schema,
    ...(schema.properties !== undefined
      ? { properties: Object.freeze({ ...schema.properties }) }
      : {}),
    ...(schema.required !== undefined ? { required: Object.freeze([...schema.required]) } : {}),
  });
}

function freezeModule(module: ConnectorModule): ConnectorModule {
  const fields = Object.freeze([...module.fields]);
  const allowedDestinations = Object.freeze([...module.allowedDestinations]);
  if (module.kind === 'proxy') {
    return Object.freeze({
      ...module,
      fields,
      allowedDestinations,
      args: Object.freeze([...module.args]),
      env: Object.freeze(module.env.map((binding) => Object.freeze({ ...binding }))),
      tools: Object.freeze(
        module.tools.map((tool) =>
          Object.freeze({
            name: tool.name,
            description: tool.description,
            inputSchema: freezeInputSchema(tool.inputSchema),
          }),
        ),
      ),
    });
  }
  return Object.freeze({
    ...module,
    fields,
    allowedDestinations,
    tools: Object.freeze(
      module.tools.map((tool) =>
        Object.freeze({
          ...tool,
          inputSchema: freezeInputSchema(tool.inputSchema),
        }),
      ),
    ),
  });
}

function toRegistryTools(module: ConnectorModule): RegistryTool[] {
  if (module.kind === 'proxy') {
    return module.tools.map((tool) =>
      Object.freeze({
        kind: 'proxy',
        mcpName: mcpToolName(module.id, tool.name),
        connectorId: module.id,
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }),
    );
  }
  return module.tools.map((tool) =>
    Object.freeze({
      kind: 'native',
      mcpName: mcpToolName(module.id, tool.name),
      connectorId: module.id,
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      handler: tool.handler,
    }),
  );
}

/**
 * Validates connector modules and returns an immutable registry.
 * Does not read a proxy entry file and does not start a child process.
 */
export function buildConnectorRegistry(modules: readonly ConnectorModule[]): ConnectorRegistry {
  const seenIds = new Set<string>();
  for (const module of modules) {
    assertValidModule(module, seenIds);
  }

  const connectors: readonly ConnectorModule[] = Object.freeze(modules.map(freezeModule));

  const tools: readonly RegistryTool[] = Object.freeze(connectors.flatMap(toRegistryTools));

  const toolsByMcpName = new Map(tools.map((tool) => [tool.mcpName, tool]));

  return Object.freeze({
    connectors,
    tools,
    listPublic(): PublicConnector[] {
      return connectors.map(toPublicConnector);
    },
    getTool(mcpName: string): RegistryTool | undefined {
      return toolsByMcpName.get(mcpName);
    },
  });
}

/** Production registry: product connectors registered in code. */
export const productionConnectorRegistry: ConnectorRegistry = buildConnectorRegistry([
  gmailConnector,
  mailruConnector,
]);
