import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

const fakePackageSchema = z
  .object({
    version: z.string(),
  })
  .passthrough();

const serverPackageSchema = z
  .object({
    dependencies: z.record(z.string()),
  })
  .passthrough();

describe('proxy-runtime: Pinned package and spawn without download', () => {
  it('Server depends on the exact installed package', async () => {
    const fakeManifest = fakePackageSchema.parse(
      JSON.parse(
        await readFile(path.join(repoRoot, 'packages', 'fake-stdio-mcp', 'package.json'), 'utf8'),
      ) as unknown,
    );
    const serverManifest = serverPackageSchema.parse(
      JSON.parse(await readFile(path.join(repoRoot, 'server', 'package.json'), 'utf8')) as unknown,
    );

    expect(fakeManifest.version).toBe('1.0.0');
    expect(serverManifest.dependencies['@mcp-gateway/fake-stdio-mcp']).toBe(
      'file:../packages/fake-stdio-mcp',
    );
  });
});
