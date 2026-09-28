import { apiRequest } from '@/shared/api';

export type ConnectorFieldDescription = {
  name: string;
  label: string;
  type: 'text' | 'secret' | 'host';
  required: boolean;
};

export type ConnectorPublicDescription = {
  id: string;
  name: string;
  kind: 'native' | 'proxy';
  fields: ConnectorFieldDescription[];
};

export function listConnectors(): Promise<ConnectorPublicDescription[]> {
  return apiRequest<ConnectorPublicDescription[]>('/api/connectors');
}
