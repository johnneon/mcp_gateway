import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const publishPath = path.join(repoRoot, '.github', 'workflows', 'publish-image.yml');
const checksPath = path.join(repoRoot, '.github', 'workflows', 'ci.yml');

type StepInput = string | boolean;

type WorkflowStep = {
  name?: string;
  id?: string;
  run?: string;
  uses?: string;
  with?: Record<string, StepInput>;
};

type WorkflowJob = {
  id: string;
  runsOn?: string;
  steps: WorkflowStep[];
};

type WorkflowFile = {
  name?: string;
  triggers: Record<string, unknown>;
  permissions: Record<string, string>;
  jobs: WorkflowJob[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function expectRecord(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(message);
  }
  return value;
}

function parseWorkflow(raw: string): WorkflowFile {
  const root = expectRecord(parse(raw), 'Workflow root must be a mapping');
  const triggers = expectRecord(root['on'], 'Workflow on must be a mapping');

  const permissionsValue = root['permissions'];
  const permissions: Record<string, string> = {};
  if (isRecord(permissionsValue)) {
    for (const [key, entry] of Object.entries(permissionsValue)) {
      if (typeof entry === 'string') {
        permissions[key] = entry;
      }
    }
  }

  const jobsValue = expectRecord(root['jobs'], 'Workflow jobs must be a mapping');
  const jobs: WorkflowJob[] = [];
  for (const [jobId, jobValue] of Object.entries(jobsValue)) {
    if (!isRecord(jobValue)) {
      continue;
    }
    const stepsValue = jobValue['steps'];
    const steps: WorkflowStep[] = [];
    if (Array.isArray(stepsValue)) {
      for (const stepValue of stepsValue) {
        if (!isRecord(stepValue)) {
          continue;
        }
        const step: WorkflowStep = {};
        const name = readString(stepValue['name']);
        if (name !== undefined) {
          step.name = name;
        }
        const id = readString(stepValue['id']);
        if (id !== undefined) {
          step.id = id;
        }
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
          const withEntries: Record<string, StepInput> = {};
          for (const [key, entry] of Object.entries(withValue)) {
            if (typeof entry === 'string' || typeof entry === 'boolean') {
              withEntries[key] = entry;
            }
          }
          step.with = withEntries;
        }
        steps.push(step);
      }
    }
    const job: WorkflowJob = { id: jobId, steps };
    const runsOn = readString(jobValue['runs-on']);
    if (runsOn !== undefined) {
      job.runsOn = runsOn;
    }
    jobs.push(job);
  }

  const workflow: WorkflowFile = { triggers, permissions, jobs };
  const name = readString(root['name']);
  if (name !== undefined) {
    workflow.name = name;
  }
  return workflow;
}

function requireJob(workflow: WorkflowFile, id: string): WorkflowJob {
  const job = workflow.jobs.find((item) => item.id === id);
  if (job === undefined) {
    throw new Error(`Missing job ${id}`);
  }
  return job;
}

function stepIndex(job: WorkflowJob, predicate: (step: WorkflowStep) => boolean): number {
  return job.steps.findIndex(predicate);
}

function requireStep(job: WorkflowJob, predicate: (step: WorkflowStep) => boolean): WorkflowStep {
  const step = job.steps.find(predicate);
  if (step === undefined) {
    throw new Error('Missing workflow step');
  }
  return step;
}

function inputString(step: WorkflowStep, key: string): string | undefined {
  const value = step.with?.[key];
  return typeof value === 'string' ? value : undefined;
}

function splitList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function secretNames(raw: string): string[] {
  const names: string[] = [];
  for (const match of raw.matchAll(/secrets\.([A-Za-z0-9_]+)/g)) {
    const name = match[1];
    if (name !== undefined) {
      names.push(name);
    }
  }
  return names;
}

describe('ghcr-image-publish: Publish workflow runs on push to main', () => {
  it('Workflow publishes only from a push to main', () => {
    const publishRaw = readFileSync(publishPath, 'utf8');
    const publish = parseWorkflow(publishRaw);
    const checksRaw = readFileSync(checksPath, 'utf8');
    const checks = parseWorkflow(checksRaw);

    expect(publish.name).toBe('publish-image');
    expect(Object.keys(publish.triggers)).toEqual(['push']);
    const push = expectRecord(publish.triggers['push'], 'push trigger must be a mapping');
    expect(push['branches']).toEqual(['main']);
    expect(push['tags']).toBeUndefined();
    expect(publish.triggers['pull_request']).toBeUndefined();
    expect(publish.triggers['workflow_dispatch']).toBeUndefined();
    expect(publishRaw).not.toContain('pull_request');
    expect(publishRaw).not.toContain('workflow_dispatch');

    expect(publish.permissions).toEqual({
      contents: 'read',
      packages: 'write',
    });

    const job = requireJob(publish, 'publish');
    expect(job.runsOn).toBe('ubuntu-24.04');

    const login = requireStep(
      job,
      (step) => step.uses?.startsWith('docker/login-action@') === true,
    );
    expect(inputString(login, 'registry')).toBe('ghcr.io');
    expect(inputString(login, 'password')).toContain('GITHUB_TOKEN');
    const secrets = secretNames(publishRaw);
    expect(secrets.length).toBeGreaterThan(0);
    expect(secrets.every((name) => name === 'GITHUB_TOKEN')).toBe(true);

    const pullRequest = expectRecord(
      checks.triggers['pull_request'],
      'pull_request trigger must be a mapping',
    );
    expect(isStringArray(pullRequest['branches'])).toBe(true);
    if (isStringArray(pullRequest['branches'])) {
      expect(pullRequest['branches']).toContain('main');
    }
    expect(checks.triggers['push']).toBeUndefined();
    expect(checksRaw).not.toContain('ghcr.io/johnneon/mcp_gateway');
  });
});

describe('ghcr-image-publish: Image tags and platform', () => {
  it('Workflow declares latest, a 7-character SHA, the package version, and amd64', () => {
    const publishRaw = readFileSync(publishPath, 'utf8');
    const publish = parseWorkflow(publishRaw);
    const job = requireJob(publish, 'publish');

    const shortSha = requireStep(job, (step) => step.id === 'image');
    expect(shortSha.run).toContain('${GITHUB_SHA:0:7}');
    expect(shortSha.run).not.toContain('rev-parse');
    expect(publishRaw).not.toContain('rev-parse');

    const build = requireStep(
      job,
      (step) => step.uses?.startsWith('docker/build-push-action@') === true,
    );
    expect(build.with?.['push']).toBe(true);
    expect(inputString(build, 'platforms')).toBe('linux/amd64');
    expect(inputString(build, 'file')).toBe('Dockerfile');
    expect(inputString(build, 'context')).toBe('.');
    expect(publishRaw.toLowerCase()).not.toContain('arm64');

    const tags = splitList(inputString(build, 'tags') ?? '');
    expect(tags).toEqual([
      'ghcr.io/johnneon/mcp_gateway:latest',
      'ghcr.io/johnneon/mcp_gateway:${{ steps.image.outputs.short_sha }}',
      'ghcr.io/johnneon/mcp_gateway:${{ steps.version.outputs.version }}',
    ]);
    expect(tags.some((tag) => tag.includes(':v'))).toBe(false);
    expect(tags.some((tag) => /:\d+$/.test(tag) || /:\d+\.\d+$/.test(tag))).toBe(false);
  });

  it('Job fails when the package version is missing or not three numeric components', () => {
    const publishRaw = readFileSync(publishPath, 'utf8');
    const publish = parseWorkflow(publishRaw);
    const job = requireJob(publish, 'publish');

    const nodeIndex = stepIndex(
      job,
      (step) => step.uses?.startsWith('actions/setup-node@') === true,
    );
    const versionIndex = stepIndex(job, (step) => step.id === 'version');
    const pushIndex = stepIndex(
      job,
      (step) => step.uses?.startsWith('docker/build-push-action@') === true,
    );
    expect(nodeIndex).toBeGreaterThanOrEqual(0);
    expect(versionIndex).toBeGreaterThan(nodeIndex);
    expect(pushIndex).toBeGreaterThan(versionIndex);

    const node = job.steps[nodeIndex];
    expect(node).toBeDefined();
    expect(inputString(node ?? { with: {} }, 'node-version')).toBe('22');

    const version = requireStep(job, (step) => step.id === 'version');
    const run = version.run ?? '';
    expect(run).toContain("readFileSync('package.json'");
    expect(run).toContain('.version');
    expect(run).not.toContain('server/package.json');
    expect(run).not.toContain('web/package.json');
    expect(run).toContain("typeof version !== 'string'");
    expect(run).toContain('/^[0-9]+\\.[0-9]+\\.[0-9]+$/');
    expect(run).toContain('process.exit(1)');
    expect(run.indexOf('GITHUB_OUTPUT')).toBeGreaterThan(run.indexOf('process.exit(1)'));
    expect(run).toContain('echo "version=${version}"');
    expect(run).not.toMatch(/echo "version=[0-9]/);
    expect(run).not.toMatch(/['"]\d+\.\d+\.\d+['"]/);
    expect(run).not.toContain('.replace(');
    expect(run).not.toContain('??');
    expect(publishRaw).not.toContain('continue-on-error');
  });
});

describe('ghcr-image-publish: Package visibility is public and repeatable', () => {
  it('Visibility step sets public and succeeds when already public', () => {
    const publish = parseWorkflow(readFileSync(publishPath, 'utf8'));
    const job = requireJob(publish, 'publish');

    const pushIndex = stepIndex(
      job,
      (step) =>
        step.uses?.startsWith('docker/build-push-action@') === true && step.with?.['push'] === true,
    );
    const visibilityIndex = stepIndex(
      job,
      (step) => step.run?.includes('user/packages/container/mcp_gateway') === true,
    );
    expect(pushIndex).toBeGreaterThanOrEqual(0);
    expect(visibilityIndex).toBeGreaterThan(pushIndex);

    const visibility = requireStep(
      job,
      (step) => step.run?.includes('user/packages/container/mcp_gateway') === true,
    );
    const script = visibility.run ?? '';
    expect(script).toContain('gh api');
    expect(script).toContain('user/packages/container/mcp_gateway');
    expect(script).toContain('visibility=public');
    expect(script).toContain('GITHUB_TOKEN');
    expect(script).toMatch(/if \[ "\$visibility" = "public" \]; then[\s\S]*?exit 0/);
    expect(script).not.toContain('private');
  });
});
