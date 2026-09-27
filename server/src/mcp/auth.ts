import type { JsonObject } from '../store/codec.js';
import type { EncryptedStore } from '../store/store.js';
import { tokenMatchesHash } from '../token/token.js';

type ConfigurationAuthRow = {
  tokenHash: string;
  enabled: boolean;
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

function isConfigurationAuthRow(value: unknown): value is ConfigurationAuthRow {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const row = value as Record<string, unknown>;
  return typeof row.tokenHash === 'string' && typeof row.enabled === 'boolean';
}

function readAuthRows(document: JsonObject): ConfigurationAuthRow[] {
  const raw = document.configurations;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(isConfigurationAuthRow);
}

/**
 * Full-scan bearer check against every stored configuration hash.
 * Accepts only when at least one match is enabled. Always scans all rows.
 */
export function authenticateBearer(store: EncryptedStore, token: string): boolean {
  if (token.length === 0) {
    return false;
  }
  let accepted = false;
  for (const row of readAuthRows(store.read())) {
    if (tokenMatchesHash(token, row.tokenHash) && row.enabled) {
      accepted = true;
    }
  }
  return accepted;
}
