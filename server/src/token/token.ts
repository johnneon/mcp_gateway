import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 32 cryptographically random bytes as base64url without padding. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 of the exact token string, lowercase hex. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Compare a candidate bearer string to a stored hash using timing-safe equality
 * of the digests (after hashing the candidate the same way).
 */
export function tokenMatchesHash(candidate: string, tokenHash: string): boolean {
  const candidateHash = hashToken(candidate);
  const a = Buffer.from(candidateHash, 'utf8');
  const b = Buffer.from(tokenHash, 'utf8');
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
