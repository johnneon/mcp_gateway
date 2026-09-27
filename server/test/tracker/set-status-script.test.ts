import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const scriptPath = path.join(repoRoot, '.cursor', 'skills', 'tracker', 'scripts', 'set-status.sh');

describe('tracker-board-scripts: Script documents required Status arguments', () => {
  it('set-status.sh accepts issue and Status and documents board constants', () => {
    expect(existsSync(scriptPath)).toBe(true);

    const text = readFileSync(scriptPath, 'utf8');

    expect(text).toMatch(/Issue=/);
    expect(text).toMatch(/Status=/);
    expect(text).toContain('Backlog');
    expect(text).toContain('Ready');
    expect(text).toContain('In progress');
    expect(text).toContain('In review');
    expect(text).toContain('Done');
    expect(text).toContain('ProjectNumber=2');
    expect(text).toContain("Owner='johnneon'");
    expect(text).toContain("Repo='johnneon/mcp_gateway'");
    expect(text).toContain('#$Issue -> $Status');
  });
});
