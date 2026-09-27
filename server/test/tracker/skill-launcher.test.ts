import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const skillPath = path.join(repoRoot, '.cursor', 'skills', 'tracker', 'SKILL.md');

describe('tracker-board-scripts: Skill documents PowerShell-first then bash fallback', () => {
  it('tracker skill prefers .ps1 when PowerShell is on PATH else bash scripts', () => {
    const text = readFileSync(skillPath, 'utf8');

    expect(text).toMatch(/powershell.*pwsh|pwsh.*powershell/i);
    expect(text).toMatch(/\.ps1/);
    expect(text).toContain('set-status.sh');
    expect(text).toContain('set-iteration.sh');
    expect(text).toMatch(/bash \.cursor\/skills\/tracker\/scripts\/set-status\.sh/);
    expect(text).toMatch(/bash \.cursor\/skills\/tracker\/scripts\/set-iteration\.sh/);
    expect(text).toMatch(/ProgramFiles.*GitHub CLI\\gh\.exe/);
    expect(text).toMatch(/Windows-only|Windows only/i);
    expect(text).not.toMatch(/install PowerShell on macOS/i);
  });
});
