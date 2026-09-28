import type {
  AccountField,
  AccountFieldType,
  AllowedDestination,
  ConnectorModule,
  ConstantAllowedDestination,
  FieldAllowedDestination,
  PublicConnector,
} from './contract.js';

const ID_PATTERN = /^[a-z0-9]+$/;
const FIELD_TYPES: ReadonlySet<AccountFieldType> = new Set(['text', 'secret', 'host']);

export class ConnectorRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConnectorRegistryError';
  }
}

export type ConnectorRegistry = {
  readonly connectors: readonly ConnectorModule[];
  listPublic(): PublicConnector[];
};

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
      }),
    ),
  );

  return Object.freeze({
    connectors,
    listPublic(): PublicConnector[] {
      return connectors.map(toPublicConnector);
    },
  });
}

/** Production registry: no connectors until a later change registers them. */
export const productionConnectorRegistry: ConnectorRegistry = buildConnectorRegistry([]);
