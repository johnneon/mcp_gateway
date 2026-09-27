import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateToken, hashToken, tokenMatchesHash } from '../../src/token/token.js';

describe('configurations-api: Bearer token generation and hash persistence', () => {
  it('generated token round-trips through hash and compare', () => {
    const token = generateToken();
    expect(token.length).toBeGreaterThan(0);
    // base64url alphabet, no padding
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token).not.toContain('=');

    const digest = hashToken(token);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenMatchesHash(token, digest)).toBe(true);
  });

  it('compare rejects a different string', () => {
    const token = generateToken();
    const digest = hashToken(token);
    expect(tokenMatchesHash(`${token}x`, digest)).toBe(false);
    expect(tokenMatchesHash(generateToken(), digest)).toBe(false);
  });

  it('hash equals Node createHash sha256 of the token string', () => {
    const token = generateToken();
    const expected = createHash('sha256').update(token, 'utf8').digest('hex');
    expect(hashToken(token)).toBe(expected);
  });
});
