import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const trackerSkill = path.join(repoRoot, '.cursor', 'skills', 'tracker', 'SKILL.md');
const commitsSkill = path.join(repoRoot, '.cursor', 'skills', 'commits', 'SKILL.md');

describe('tracker-board-scripts: Tracker and commits skills document POSIX body files', () => {
  it('both skills document POSIX temp body files and Windows here-strings', () => {
    const tracker = readFileSync(trackerSkill, 'utf8');
    const commits = readFileSync(commitsSkill, 'utf8');

    for (const [name, text] of [
      ['tracker', tracker],
      ['commits', commits],
    ] as const) {
      expect(text, name).toMatch(/mktemp|temp file|message file|bodyFile/i);
      expect(text, name).toMatch(/POSIX|macOS|Linux/);
      expect(text, name).toMatch(/New-TemporaryFile|@"/);
      expect(text, name).toMatch(/--body-file|git commit -F/);
    }
  });
});
