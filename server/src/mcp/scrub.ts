import type { AccountField, AccountFieldValues, NativeToolResult } from '../connectors/contract.js';

export const REDACTED_SECRET = '[redacted]';

/**
 * Non-empty secret field values, longer first so overlapping secrets redact fully.
 */
export function collectNonEmptySecrets(
  fields: readonly AccountField[],
  accountValues: AccountFieldValues,
): string[] {
  const secrets: string[] = [];
  for (const field of fields) {
    if (field.type !== 'secret') {
      continue;
    }
    const value = accountValues[field.name];
    if (typeof value === 'string' && value.length > 0) {
      secrets.push(value);
    }
  }
  secrets.sort((a, b) => b.length - a.length);
  return secrets;
}

export function scrubSecretsInText(text: string, secrets: readonly string[]): string {
  let result = text;
  for (const secret of secrets) {
    if (secret.length === 0) {
      continue;
    }
    result = result.split(secret).join(REDACTED_SECRET);
  }
  return result;
}

export function scrubSecretsInToolResult(
  result: NativeToolResult,
  secrets: readonly string[],
): NativeToolResult {
  if (secrets.length === 0) {
    return result;
  }
  return {
    content: result.content.map((part) => ({
      type: 'text' as const,
      text: scrubSecretsInText(part.text, secrets),
    })),
  };
}
