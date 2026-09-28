import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const isWin = process.platform === 'win32';
const setStatusScript = path.join(
  repoRoot,
  '.cursor',
  'skills',
  'tracker',
  'scripts',
  isWin ? 'set-status.ps1' : 'set-status.sh',
);

const PROJECT_ID = 'PVT_test_project';
const STATUS_FIELD_ID = 'PVTSSF_status';
const OPTION_IN_PROGRESS = 'PVTSSO_in_progress';
const ITEM_ID = 'PVTI_on_board';

type FakeGhConfig = {
  itemsJson: string;
  fieldListJson?: string;
};

function defaultFieldListJson(): string {
  return JSON.stringify({
    fields: [
      {
        id: STATUS_FIELD_ID,
        name: 'Status',
        options: [
          { id: 'PVTSSO_backlog', name: 'Backlog' },
          { id: 'PVTSSO_ready', name: 'Ready' },
          { id: OPTION_IN_PROGRESS, name: 'In progress' },
          { id: 'PVTSSO_in_review', name: 'In review' },
          { id: 'PVTSSO_done', name: 'Done' },
        ],
      },
    ],
  });
}

function installFakeGh(config: FakeGhConfig): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tracker-fake-gh-'));
  const fieldList = config.fieldListJson ?? defaultFieldListJson();

  if (isWin) {
    writeFileSync(path.join(dir, 'field-list.json'), fieldList, 'utf8');
    writeFileSync(path.join(dir, 'items.json'), config.itemsJson, 'utf8');
    // Get-Command resolves gh.ps1 as ExternalScript; & $gh @args keeps the
    // argument array intact (no cmd %* / PATHEXT .cmd splitting).
    writeFileSync(
      path.join(dir, 'gh.ps1'),
      `# Fake gh for tracker set-status.ps1 tests
$ErrorActionPreference = 'Stop'
if ($args.Count -lt 1) {
  [Console]::Error.WriteLine('fake gh: missing args')
  exit 1
}
$cmd = $args[0]
$hereDir = $PSScriptRoot
if ($cmd -eq 'project') {
  if ($args.Count -lt 2) {
    [Console]::Error.WriteLine('fake gh: missing project subcommand')
    exit 1
  }
  $sub = $args[1]
  switch ($sub) {
    'view' {
      Write-Output '{"id":"${PROJECT_ID}"}'
      exit 0
    }
    'field-list' {
      Write-Output ([IO.File]::ReadAllText((Join-Path $hereDir 'field-list.json')))
      exit 0
    }
    'item-list' {
      Write-Output ([IO.File]::ReadAllText((Join-Path $hereDir 'items.json')))
      exit 0
    }
    'item-edit' {
      exit 0
    }
    default {
      [Console]::Error.WriteLine("fake gh: unsupported project $sub")
      exit 1
    }
  }
}
[Console]::Error.WriteLine("fake gh: unsupported $cmd")
exit 1
`,
      'utf8',
    );
    return dir;
  }

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
      field-list)
        cat <<'FIELDJSON'
${fieldList}
FIELDJSON
        ;;
      item-list)
        cat <<'ITEMSJSON'
${config.itemsJson}
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

function runSetStatus(
  fakeGhDir: string,
  issue: string,
  status: string,
): { status: number | null; stdout: string; stderr: string } {
  const result = isWin
    ? spawnSync(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', setStatusScript, issue, status],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${fakeGhDir}${path.delimiter}${process.env.PATH ?? ''}`,
          },
        },
      )
    : spawnSync('bash', [setStatusScript, issue, status], {
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

describe('tracker-board-scripts: Missing board membership fails with a clear message', () => {
  it('set-status.sh fails when issue 99999 is not on the board', () => {
    const fakeGhDir = installFakeGh({
      itemsJson: JSON.stringify({
        items: [
          {
            id: ITEM_ID,
            content: { number: 1, repository: 'johnneon/mcp_gateway' },
          },
        ],
      }),
    });

    const outcome = runSetStatus(fakeGhDir, '99999', 'In progress');

    expect(outcome.status).not.toBe(0);
    expect(outcome.stderr).toMatch(/Issue #99999.*not on project 2/i);
  });
});

describe('tracker-board-scripts: Unknown Status fails with a clear message', () => {
  it('set-status.sh fails when Status is not an option of the Status field', () => {
    const fakeGhDir = installFakeGh({
      itemsJson: JSON.stringify({
        items: [
          {
            id: ITEM_ID,
            content: { number: 31, repository: 'johnneon/mcp_gateway' },
          },
        ],
      }),
    });

    const outcome = runSetStatus(fakeGhDir, '31', 'NotAStatus');

    expect(outcome.status).not.toBe(0);
    expect(outcome.stderr).toMatch(/Status 'NotAStatus' is not an option of the Status field/);
  });
});
