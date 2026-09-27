import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const setIterationSh = path.join(
  repoRoot,
  '.cursor',
  'skills',
  'tracker',
  'scripts',
  'set-iteration.sh',
);

const PROJECT_ID = 'PVT_test_project';
const ITERATION_FIELD_ID = 'PVTIF_iteration';
const ITEM_ID = 'PVTI_on_board';
const ISSUE_NUMBER = 31;

type IterationFixture = {
  id: string;
  title: string;
  startDate: string;
  duration: number;
};

function formatLocalYmd(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${String(year)}-${month}-${day}`;
}

function addLocalDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function graphqlPayload(iterations: IterationFixture[]): string {
  return JSON.stringify({
    data: {
      user: {
        projectV2: {
          field: {
            id: ITERATION_FIELD_ID,
            configuration: { iterations },
          },
        },
      },
    },
  });
}

function installFakeGh(iterations: IterationFixture[]): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tracker-fake-gh-iter-'));
  const itemsJson = JSON.stringify({
    items: [
      {
        id: ITEM_ID,
        content: {
          number: ISSUE_NUMBER,
          repository: 'johnneon/mcp_gateway',
        },
      },
    ],
  });
  const graphqlJson = graphqlPayload(iterations);
  const script = `#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -lt 1 ]; then
  echo "fake gh: missing args" >&2
  exit 1
fi
cmd="$1"
shift
case "$cmd" in
  project)
    sub="$1"
    shift
    case "$sub" in
      view)
        echo '{"id":"${PROJECT_ID}"}'
        ;;
      item-list)
        cat <<'ITEMSJSON'
${itemsJson}
ITEMSJSON
        ;;
      item-edit)
        exit 0
        ;;
      *)
        echo "fake gh: unsupported project $sub" >&2
        exit 1
        ;;
    esac
    ;;
  api)
    cat <<'GQLJSON'
${graphqlJson}
GQLJSON
    ;;
  *)
    echo "fake gh: unsupported $cmd" >&2
    exit 1
    ;;
esac
`;
  const ghPath = path.join(dir, 'gh');
  writeFileSync(ghPath, script, 'utf8');
  chmodSync(ghPath, 0o755);
  return dir;
}

function runSetIteration(fakeGhDir: string): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync('bash', [setIterationSh, String(ISSUE_NUMBER)], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeGhDir}${path.delimiter}${process.env.PATH ?? ''}`,
    },
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe('tracker-board-scripts: No covering iteration fails with a clear message', () => {
  it('set-iteration.sh fails when no iteration covers today', () => {
    const today = new Date();
    const pastStart = formatLocalYmd(addLocalDays(today, -20));
    const futureStart = formatLocalYmd(addLocalDays(today, 5));
    const fakeGhDir = installFakeGh([
      {
        id: 'iter_past',
        title: 'Past Sprint',
        startDate: pastStart,
        duration: 7,
      },
      {
        id: 'iter_future',
        title: 'Future Sprint',
        startDate: futureStart,
        duration: 14,
      },
    ]);

    const outcome = runSetIteration(fakeGhDir);
    const todayYmd = formatLocalYmd(today);

    expect(outcome.status).not.toBe(0);
    expect(outcome.stderr).toContain(
      `No current iteration covers ${todayYmd}. Create one on the Task tracker board.`,
    );
  });
});

describe('tracker-board-scripts: Overlapping iterations pick the latest start', () => {
  it('set-iteration.sh picks the covering iteration with the later start date', () => {
    const today = new Date();
    const earlierStart = formatLocalYmd(addLocalDays(today, -10));
    const laterStart = formatLocalYmd(addLocalDays(today, -2));
    const laterTitle = 'Later Covering Sprint';
    const fakeGhDir = installFakeGh([
      {
        id: 'iter_earlier',
        title: 'Earlier Covering Sprint',
        startDate: earlierStart,
        duration: 20,
      },
      {
        id: 'iter_later',
        title: laterTitle,
        startDate: laterStart,
        duration: 14,
      },
    ]);

    const outcome = runSetIteration(fakeGhDir);

    expect(outcome.status).toBe(0);
    expect(outcome.stdout.trim()).toBe(`#${String(ISSUE_NUMBER)} -> ${laterTitle}`);
  });
});
