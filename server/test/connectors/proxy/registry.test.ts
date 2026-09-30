import { describe, expect, it } from 'vitest';
import { productionConnectorRegistry } from '../../../src/connectors/registry.js';

describe('proxy-runtime: Production registry has no proxy connector', () => {
  it('Production registry includes Gmail and no proxy connector', () => {
    const listed = productionConnectorRegistry.listPublic();
    expect(listed.map((connector) => connector.id)).toContain('gmail');
    expect(listed.some((connector) => connector.kind === 'proxy')).toBe(false);
  });
});
