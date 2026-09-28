import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createConfigurationsService } from '../../src/configurations/service.js';
import {
  ConfigurationNotFoundError,
  ConfigurationValidationError,
} from '../../src/configurations/errors.js';
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
    expect(entry.accountIds).toEqual([]);
    expect(entry).not.toHaveProperty('token');
    expect(JSON.stringify(document)).not.toContain(created.token);
  });

  it('Missing accountIds on an existing row reads as empty', () => {
    const store = createMemoryStore({
      configurations: [
        {
          id: 'c1',
          name: 'Legacy',
          tokenHash: 'abc',
          enabled: true,
        },
      ],
    });
    const service = createConfigurationsService(store);
    expect(service.list()).toEqual([
      { id: 'c1', name: 'Legacy', enabled: true, accountIds: [] },
    ]);
  });
});

describe('configurations-api: Bearer token generation and hash persistence', () => {
  it('Create returns a token once and stores only the hash', async () => {
    const store = createMemoryStore({});
    const service = createConfigurationsService(store);
    const created = await service.create('Ops');
    expect(created.name).toBe('Ops');
    expect(created.enabled).toBe(true);
    expect(created.accountIds).toEqual([]);
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
    expect(rotated.accountIds).toEqual([]);
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
    expect(disabled).toEqual({
      id: created.id,
      name: 'Ops',
      enabled: false,
      accountIds: [],
    });
    const enabled = await service.setEnabled(created.id, true);
    expect(enabled.enabled).toBe(true);
    expect(enabled.accountIds).toEqual([]);
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

  it('Rotate success includes accountIds', async () => {
    const service = createConfigurationsService(createMemoryStore({}));
    const created = await service.create('Ops');
    await service.setAccountIds(created.id, ['a1']);
    const rotated = await service.rotate(created.id);
    expect(rotated.accountIds).toEqual(['a1']);
    expect(rotated).not.toHaveProperty('tokenHash');
  });
});

describe('configurations-api: setAccountIds and cascade helper', () => {
  it('setAccountIds preserves order and rejects duplicates', async () => {
    const service = createConfigurationsService(createMemoryStore({}));
    const created = await service.create('Ops');
    const updated = await service.setAccountIds(created.id, ['a2', 'a1']);
    expect(updated.accountIds).toEqual(['a2', 'a1']);
    await expect(service.setAccountIds(created.id, ['a1', 'a1'])).rejects.toBeInstanceOf(
      ConfigurationValidationError,
    );
    expect(service.list()[0].accountIds).toEqual(['a2', 'a1']);
  });

  it('removeAccountIdFromAll strips the id from every configuration', async () => {
    const service = createConfigurationsService(createMemoryStore({}));
    const first = await service.create('One');
    const second = await service.create('Two');
    await service.setAccountIds(first.id, ['a1', 'a2']);
    await service.setAccountIds(second.id, ['a1']);
    await service.removeAccountIdFromAll('a1');
    expect(service.list().find((row) => row.id === first.id)?.accountIds).toEqual(['a2']);
    expect(service.list().find((row) => row.id === second.id)?.accountIds).toEqual([]);
  });
});
