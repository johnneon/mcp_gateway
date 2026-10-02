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
  tools: ConnectorToolDescription[];
};

export type ConnectorToolDescription = {
  name: string;
  description: string;
};

export function listConnectors(): Promise<ConnectorPublicDescription[]> {
  return apiRequest<ConnectorPublicDescription[]>('/api/connectors');
}
