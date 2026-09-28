import { apiRequest } from '@/shared/api';

export type AccountPublic = {
  id: string;
  connector: string;
  label: string;
  values: Record<string, string>;
  enabled: boolean;
};

export type CreateAccountInput = {
  connector: string;
  label: string;
  values: Record<string, string>;
};

export type PatchAccountInput = {
  label?: string;
  values?: Record<string, string>;
  enabled?: boolean;
};

export function listAccounts(): Promise<AccountPublic[]> {
  return apiRequest<AccountPublic[]>('/api/accounts');
}

export function createAccount(input: CreateAccountInput): Promise<AccountPublic> {
  return apiRequest<AccountPublic>('/api/accounts', {
    method: 'POST',
    body: input,
  });
}

export function patchAccount(id: string, input: PatchAccountInput): Promise<AccountPublic> {
  return apiRequest<AccountPublic>(`/api/accounts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: input,
  });
}

export async function checkAccount(id: string): Promise<void> {
  await apiRequest<undefined>(`/api/accounts/${encodeURIComponent(id)}/check`, {
    method: 'POST',
  });
}

export async function deleteAccount(id: string): Promise<void> {
  await apiRequest<undefined>(`/api/accounts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
