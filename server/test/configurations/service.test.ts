import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createConfigurationsService } from '../../src/configurations/service.js';
import { ConfigurationNotFoundError } from '../../src/configurations/errors.js';
import type { EncryptedStore } from '../../src/store/store.js';
import type { JsonObject } from '../../src/store/codec.js';
import { hashToken } from '../../src/token/token.js';

function createMemoryStore(initial: JsonObject = {}): EncryptedStore {
  let document: JsonObject = structuredClone(initial);
  return {
    read(): JsonObject {
      return structuredClone(document);
    },
    replace(next: JsonObject): Promise<void> {
      document = structuredClone(next);
      return Promise.resolve();
    },
  };
}

describe('configurations-api: Configurations document shape', () => {
  it('Empty document reads as an empty list', () => {
    const service = createConfigurationsService(createMemoryStore({}));
    expect(service.list()).toEqual([]);
  });

  it('Stored rows keep id, name, tokenHash, and enabled only', async () => {
    const store = createMemoryStore({});
    const service = createConfigurationsService(store);
    const created = await service.create('Ops');
    const document = store.read();
    const rows = document.configurations;
    expect(Array.isArray(rows)).toBe(true);
    const entry = (rows as JsonObject[])[0];
    expect(typeof entry.id).toBe('string');
    expect(typeof entry.name).toBe('string');
    expect(typeof entry.tokenHash).toBe('string');
    expect(typeof entry.enabled).toBe('boolean');
    expect(entry).not.toHaveProperty('accountIds');
    expect(entry).not.toHaveProperty('token');
    expect(JSON.stringify(document)).not.toContain(created.token);
  });
});

describe('configurations-api: Bearer token generation and hash persistence', () => {
  it('Create returns a token once and stores only the hash', async () => {
    const store = createMemoryStore({});
    const service = createConfigurationsService(store);
    const created = await service.create('Ops');
    expect(created.name).toBe('Ops');
    expect(created.enabled).toBe(true);
    expect(created.token).toMatch(/^[A-Za-z0-9_-]+$/);
    const rows = store.read().configurations as Array<{ tokenHash: string }>;
    expect(rows[0].tokenHash).toBe(hashToken(created.token));
    expect(rows[0].tokenHash).toBe(
      createHash('sha256').update(created.token, 'utf8').digest('hex'),
    );
    expect(JSON.stringify(store.read())).not.toContain(created.token);
  });

  it('Rotate replaces the hash immediately', async () => {
    const store = createMemoryStore({});
    const service = createConfigurationsService(store);
    const created = await service.create('Ops');
    const previousToken = created.token;
    const previousHash = hashToken(previousToken);
    const rotated = await service.rotate(created.id);
    expect(rotated.token).not.toBe(previousToken);
    const rows = store.read().configurations as Array<{ tokenHash: string }>;
    expect(rows[0].tokenHash).toBe(hashToken(rotated.token));
    expect(rows[0].tokenHash).not.toBe(previousHash);
  });
});

describe('configurations-api: Enable or disable a configuration', () => {
  it('Disable then enable', async () => {
    const service = createConfigurationsService(createMemoryStore({}));
    const created = await service.create('Ops');
    const disabled = await service.setEnabled(created.id, false);
    expect(disabled).toEqual({ id: created.id, name: 'Ops', enabled: false });
    const enabled = await service.setEnabled(created.id, true);
    expect(enabled.enabled).toBe(true);
  });

  it('Unknown id on setEnabled throws not found', async () => {
    const service = createConfigurationsService(createMemoryStore({}));
    await expect(service.setEnabled('missing', false)).rejects.toBeInstanceOf(
      ConfigurationNotFoundError,
    );
  });
});

describe('configurations-api: Delete a configuration', () => {
  it('Successful delete', async () => {
    const service = createConfigurationsService(createMemoryStore({}));
    const created = await service.create('Ops');
    await service.remove(created.id);
    expect(service.list()).toEqual([]);
  });

  it('Unknown id on remove throws not found', async () => {
    const service = createConfigurationsService(createMemoryStore({}));
    await expect(service.remove('missing')).rejects.toBeInstanceOf(ConfigurationNotFoundError);
  });
});

describe('configurations-api: Rotate returns a new token once', () => {
  it('Rotate unknown id throws not found', async () => {
    const service = createConfigurationsService(createMemoryStore({}));
    await expect(service.rotate('missing')).rejects.toBeInstanceOf(ConfigurationNotFoundError);
  });
});
