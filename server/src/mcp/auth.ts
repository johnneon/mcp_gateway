import type { JsonObject } from '../store/codec.js';
import type { EncryptedStore } from '../store/store.js';
import { tokenMatchesHash } from '../token/token.js';

export type ActiveConfiguration = {
  id: string;
  name: string;
  tokenHash: string;
  enabled: boolean;
  accountIds: string[];
};

/**
 * Parse Authorization for Bearer. Scheme is case-insensitive; exactly one space
 * after the scheme; token is the exact remainder (no trim). Returns null when
 * the header is missing or the shape is wrong. An empty remainder is "".
 */
export function parseBearerToken(authorization: string | undefined): string | null {
  if (authorization === undefined) {
    return null;
  }
  if (authorization.length < 7) {
    return null;
  }
  if (authorization.slice(0, 6).toLowerCase() !== 'bearer') {
    return null;
  }
  if (authorization.charAt(6) !== ' ') {
    return null;
  }
  return authorization.slice(7);
}

function isConfigurationAuthRow(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === 'string' &&
    typeof row.name === 'string' &&
    typeof row.tokenHash === 'string' &&
    typeof row.enabled === 'boolean'
  );
}

function readAccountIds(row: Record<string, unknown>): string[] {
  if (!Array.isArray(row.accountIds)) {
    return [];
  }
  return row.accountIds.filter((id): id is string => typeof id === 'string');
}

function readAuthRows(document: JsonObject): ActiveConfiguration[] {
  const raw = document.configurations;
  if (!Array.isArray(raw)) {
    return [];
  }
  const rows: ActiveConfiguration[] = [];
  for (const value of raw) {
    if (!isConfigurationAuthRow(value)) {
      continue;
    }
    rows.push({
      id: value.id as string,
      name: value.name as string,
      tokenHash: value.tokenHash as string,
      enabled: value.enabled as boolean,
      accountIds: readAccountIds(value),
    });
  }
  return rows;
}

/**
 * Full-scan bearer resolution. Always compares every stored hash. Returns the
 * first enabled hash match in document order, or null when none accept.
 */
export function resolveActiveConfiguration(
  store: EncryptedStore,
  token: string,
): ActiveConfiguration | null {
  if (token.length === 0) {
    return null;
  }
  let accepted: ActiveConfiguration | null = null;
  for (const row of readAuthRows(store.read())) {
    if (tokenMatchesHash(token, row.tokenHash) && row.enabled) {
      if (accepted === null) {
        accepted = row;
      }
    }
  }
  return accepted;
}

/**
 * Full-scan bearer check against every stored configuration hash.
 * Accepts only when at least one match is enabled. Always scans all rows.
 */
export function authenticateBearer(store: EncryptedStore, token: string): boolean {
  return resolveActiveConfiguration(store, token) !== null;
}
