import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { afterEach, describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');

const tempFiles: string[] = [];

afterEach(async () => {
  while (tempFiles.length > 0) {
    const filePath = tempFiles.pop();
    if (filePath === undefined) {
      continue;
    }
    await rm(filePath, { force: true });
  }
});

async function lintExplicitAnySnippet(relativePath: string): Promise<{
  errorCount: number;
  ruleIds: string[];
}> {
  const absolutePath = path.join(repoRoot, relativePath);
  tempFiles.push(absolutePath);
  await writeFile(absolutePath, 'export const value: any = 1;\n', 'utf8');

  const eslint = new ESLint({ cwd: repoRoot });
  const results = await eslint.lintFiles([absolutePath]);
  const result = results[0];
  if (result === undefined) {
    throw new Error(`ESLint returned no result for ${relativePath}`);
  }

  return {
    errorCount: result.errorCount,
    ruleIds: result.messages
      .map((message) => message.ruleId)
      .filter((ruleId): ruleId is string => ruleId !== null),
  };
}

describe('pull-request-checks: ESLint rejects explicit any in server and web', () => {
  it('Explicit any in a server snippet is an error', async () => {
    const outcome = await lintExplicitAnySnippet(
      path.join('server', 'test', 'ci', 'explicit-any.fixture.ts'),
    );

    expect(outcome.errorCount).toBeGreaterThan(0);
    expect(outcome.ruleIds).toContain('@typescript-eslint/no-explicit-any');
  });

  it('Explicit any in a web snippet is an error', async () => {
    const outcome = await lintExplicitAnySnippet(
      path.join('web', 'src', 'test', 'explicit-any.fixture.ts'),
    );

    expect(outcome.errorCount).toBeGreaterThan(0);
    expect(outcome.ruleIds).toContain('@typescript-eslint/no-explicit-any');
  });
});
