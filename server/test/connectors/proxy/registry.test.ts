import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConnectorModule } from '../../../src/connectors/contract.js';
import {
  buildConnectorRegistry,
  ConnectorRegistryError,
  productionConnectorRegistry,
} from '../../../src/connectors/registry.js';

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'proxy-registry-'));
  tempDirs.push(dir);
  return dir;
}

async function readLaunchCount(filePath: string): Promise<number> {
  const text = await readFile(filePath, 'utf8');
  const parsed = Number.parseInt(text.trim(), 10);
  if (!Number.isInteger(parsed)) {
    throw new Error(`Invalid launch count in ${filePath}`);
  }
  return parsed;
}

describe('proxy-runtime: Production registry still rejects proxy', () => {
  it('Proxy kind fails registry build and starts no child', async () => {
    const dir = await makeTempDir();
    const countFile = path.join(dir, 'launches.txt');
    await writeFile(countFile, '0', 'utf8');

    const proxyModule: ConnectorModule = {
      id: 'proxyfake',
      name: 'Proxy fake',
      kind: 'proxy',
      fields: [{ name: 'token', label: 'Token', type: 'secret', required: true }],
      allowedDestinations: [{ host: 'example.test', port: 443 }],
      checkConnection: () => {
        writeFileSync(countFile, '1', 'utf8');
      },
      tools: [],
    };

    expect(() => buildConnectorRegistry([proxyModule])).toThrow(ConnectorRegistryError);
    expect(await readLaunchCount(countFile)).toBe(0);
  });

  it('Production registry includes Gmail and no proxy connector', () => {
    const listed = productionConnectorRegistry.listPublic();
    expect(listed.map((connector) => connector.id)).toContain('gmail');
    expect(listed.some((connector) => connector.kind === 'proxy')).toBe(false);
  });
});
