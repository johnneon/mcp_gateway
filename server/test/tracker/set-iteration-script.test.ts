import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const scriptPath = path.join(
  repoRoot,
  '.cursor',
  'skills',
  'tracker',
  'scripts',
  'set-iteration.sh',
);

describe('tracker-board-scripts: Script documents calendar-day iteration selection', () => {
  it('set-iteration.sh documents Iteration field and calendar-day selection', () => {
    expect(existsSync(scriptPath)).toBe(true);

    const text = readFileSync(scriptPath, 'utf8');

    expect(text).toContain('Iteration');
    expect(text).toMatch(/calendar/i);
    expect(text).toMatch(/ymd_add_days|AddDays|calendar dates/i);
    expect(text).not.toMatch(/\*\s*86400|86400\s*\*/);
    expect(text).toMatch(/latest start|prefer.*latest|currentStart/i);
    expect(text).toContain('#$Issue -> $currentTitle');
  });
});
