import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');

const BADLY_FORMATTED = 'export const value=1\n';
const fixtureDir = path.join(repoRoot, 'server', 'test', 'ci', 'format-fixture');
const fixtureFile = path.join(fixtureDir, 'badly-formatted.ts');

afterEach(async () => {
  await rm(fixtureDir, { recursive: true, force: true });
});

async function runPrettierCheck(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(repoRoot, 'node_modules', 'prettier', 'bin', 'prettier.cjs'), '--check', filePath],
      {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    child.on('error', reject);
    child.on('close', (code) => {
      resolve(code ?? 1);
    });
  });
}

async function runPrettierWrite(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(repoRoot, 'node_modules', 'prettier', 'bin', 'prettier.cjs'), '--write', filePath],
      {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    child.on('error', reject);
    child.on('close', (code) => {
      resolve(code ?? 1);
    });
  });
}

describe('pull-request-checks: format:check различает сломанный и нормальный фрагмент', () => {
  it('format:check падает на сломанном фрагменте', async () => {
    await mkdir(fixtureDir, { recursive: true });
    await writeFile(fixtureFile, BADLY_FORMATTED, 'utf8');

    const exitCode = await runPrettierCheck(fixtureFile);
    expect(exitCode).not.toBe(0);
  });

  it('format:check проходит на отформатированном фрагменте', async () => {
    await mkdir(fixtureDir, { recursive: true });
    await writeFile(fixtureFile, BADLY_FORMATTED, 'utf8');

    const writeCode = await runPrettierWrite(fixtureFile);
    expect(writeCode).toBe(0);

    const checkCode = await runPrettierCheck(fixtureFile);
    expect(checkCode).toBe(0);
  });
});
