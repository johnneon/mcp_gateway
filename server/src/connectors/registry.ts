import type {
  AccountField,
  AccountFieldType,
  AllowedDestination,
  ConnectorModule,
  ConstantAllowedDestination,
  FieldAllowedDestination,
  NativeConnectorTool,
  PublicConnector,
  RegistryTool,
  ToolArgumentsSchema,
} from './contract.js';
import { gmailConnector } from './gmail/index.js';

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

  // Runtime guard: kind is typed as native|proxy, but reject anything else without a child process.
  const kind: string = module.kind;
  if (kind === 'proxy') {
    throw new ConnectorRegistryError(`Connector "${module.id}" kind "proxy" is not registrable`);
  }
  if (kind !== 'native') {
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

  const seenToolNames = new Set<string>();
  for (const tool of module.tools) {
    assertValidTool(tool, module.id, seenToolNames);
  }
}

function schemaDeclaresAccount(schema: ToolArgumentsSchema): boolean {
  const props = schema.properties;
  if (props === undefined) {
    return false;
  }
  return Object.prototype.hasOwnProperty.call(props, 'account');
}

function assertValidTool(
  tool: NativeConnectorTool,
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

  if (schemaDeclaresAccount(tool.inputSchema)) {
    throw new ConnectorRegistryError(
      `Connector "${connectorId}" tool "${tool.name}" must not declare property "account"`,
    );
  }
  if (typeof tool.handler !== 'function') {
    throw new ConnectorRegistryError(
      `Connector "${connectorId}" tool "${tool.name}" must declare a handler`,
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

/**
 * Validates connector modules and returns an immutable registry.
 * Rejects invalid descriptions and kind `proxy` (no child process path).
 */
export function buildConnectorRegistry(modules: readonly ConnectorModule[]): ConnectorRegistry {
  const seenIds = new Set<string>();
  for (const module of modules) {
    assertValidModule(module, seenIds);
  }

  const connectors: readonly ConnectorModule[] = Object.freeze(
    modules.map((module) =>
      Object.freeze({
        ...module,
        fields: Object.freeze([...module.fields]),
        allowedDestinations: Object.freeze([...module.allowedDestinations]),
        tools: Object.freeze(
          module.tools.map((tool) =>
            Object.freeze({
              ...tool,
              inputSchema: Object.freeze({
                ...tool.inputSchema,
                ...(tool.inputSchema.properties !== undefined
                  ? { properties: Object.freeze({ ...tool.inputSchema.properties }) }
                  : {}),
                ...(tool.inputSchema.required !== undefined
                  ? { required: Object.freeze([...tool.inputSchema.required]) }
                  : {}),
              }),
            }),
          ),
        ),
      }),
    ),
  );

  const tools: readonly RegistryTool[] = Object.freeze(
    connectors.flatMap((module) =>
      module.tools.map((tool) =>
        Object.freeze({
          mcpName: mcpToolName(module.id, tool.name),
          connectorId: module.id,
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          handler: tool.handler,
        }),
      ),
    ),
  );

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
]);
