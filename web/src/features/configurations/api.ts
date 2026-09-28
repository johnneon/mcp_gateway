import { apiRequest } from '@/shared/api';

export type ConfigurationListItem = {
  id: string;
  name: string;
  enabled: boolean;
};

export type ConfigurationWithToken = {
  id: string;
  name: string;
  enabled: boolean;
  token: string;
};

export function listConfigurations(): Promise<ConfigurationListItem[]> {
  return apiRequest<ConfigurationListItem[]>('/api/configurations');
}

export function createConfiguration(name: string): Promise<ConfigurationWithToken> {
  return apiRequest<ConfigurationWithToken>('/api/configurations', {
    method: 'POST',
    body: { name },
  });
}

export function setConfigurationEnabled(
  id: string,
  enabled: boolean,
): Promise<ConfigurationListItem> {
  return apiRequest<ConfigurationListItem>(`/api/configurations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { enabled },
  });
}

export async function deleteConfiguration(id: string): Promise<void> {
  await apiRequest<undefined>(`/api/configurations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function rotateConfiguration(id: string): Promise<ConfigurationWithToken> {
  return apiRequest<ConfigurationWithToken>(
    `/api/configurations/${encodeURIComponent(id)}/rotate`,
    { method: 'POST' },
  );
}
