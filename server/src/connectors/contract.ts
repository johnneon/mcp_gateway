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

export type ConnectorModule = {
  id: string;
  name: string;
  kind: ConnectorKind;
  fields: readonly AccountField[];
  allowedDestinations: readonly AllowedDestination[];
  checkConnection: CheckConnection;
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
