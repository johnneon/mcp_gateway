import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'ci.yml');

type WorkflowStep = {
  run?: string;
  uses?: string;
  with?: Record<string, string>;
};

type WorkflowJob = {
  steps: WorkflowStep[];
};

type WorkflowFile = {
  pullRequestBranches: string[];
  jobs: WorkflowJob[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function parseWorkflow(raw: string): WorkflowFile {
  const root: unknown = parse(raw);
  if (!isRecord(root)) {
    throw new Error('Workflow root must be a mapping');
  }

  const onValue = root['on'];
  if (!isRecord(onValue)) {
    throw new Error('Workflow on must be a mapping');
  }
  const pullRequest = onValue['pull_request'];
  if (!isRecord(pullRequest)) {
    throw new Error('Workflow pull_request must be a mapping');
  }
  const branchesValue = pullRequest['branches'];
  if (!Array.isArray(branchesValue) || !branchesValue.every((item) => typeof item === 'string')) {
    throw new Error('Workflow pull_request.branches must be a string array');
  }

  const jobsValue = root['jobs'];
  if (!isRecord(jobsValue)) {
    throw new Error('Workflow jobs must be a mapping');
  }

  const jobs: WorkflowJob[] = [];
  for (const jobValue of Object.values(jobsValue)) {
    if (!isRecord(jobValue)) {
      continue;
    }
    const stepsValue = jobValue['steps'];
    if (!Array.isArray(stepsValue)) {
      continue;
    }
    const steps: WorkflowStep[] = [];
    for (const stepValue of stepsValue) {
      if (!isRecord(stepValue)) {
        continue;
      }
      const step: WorkflowStep = {};
      const run = readString(stepValue['run']);
      if (run !== undefined) {
        step.run = run;
      }
      const uses = readString(stepValue['uses']);
      if (uses !== undefined) {
        step.uses = uses;
      }
      const withValue = stepValue['with'];
      if (isRecord(withValue)) {
        const withEntries: Record<string, string> = {};
        for (const [key, entry] of Object.entries(withValue)) {
          if (typeof entry === 'string') {
            withEntries[key] = entry;
          }
        }
        step.with = withEntries;
      }
      steps.push(step);
    }
    jobs.push({ steps });
  }

  return {
    pullRequestBranches: branchesValue,
    jobs,
  };
}

function collectRunCommands(workflow: WorkflowFile): string[] {
  const commands: string[] = [];
  for (const job of workflow.jobs) {
    for (const step of job.steps) {
      if (step.run !== undefined) {
        commands.push(step.run);
      }
    }
  }
  return commands;
}

function findNodeVersion(workflow: WorkflowFile): string | undefined {
  for (const job of workflow.jobs) {
    for (const step of job.steps) {
      if (step.uses?.startsWith('actions/setup-node@') === true) {
        return step.with?.['node-version'];
      }
    }
  }
  return undefined;
}

describe('pull-request-checks: Workflow на pull_request в main', () => {
  it('Workflow объявляет Node 22 и все проверки', () => {
    const workflow = parseWorkflow(readFileSync(workflowPath, 'utf8'));

    expect(workflow.pullRequestBranches).toContain('main');
    expect(findNodeVersion(workflow)).toBe('22');

    const commands = collectRunCommands(workflow);
    expect(commands.some((command) => command.includes('npm run typecheck'))).toBe(true);
    expect(commands.some((command) => command.includes('npm run lint'))).toBe(true);
    expect(commands.some((command) => command.includes('npm run format:check'))).toBe(true);
    expect(commands.some((command) => /(^|\s)npm test(\s|$)/.test(command))).toBe(true);
    expect(commands.some((command) => command.includes('npm run build'))).toBe(true);
  });
});
