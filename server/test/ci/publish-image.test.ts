import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const publishPath = path.join(repoRoot, '.github', 'workflows', 'publish-image.yml');
const checksPath = path.join(repoRoot, '.github', 'workflows', 'ci.yml');
const readmePath = path.join(repoRoot, 'README.md');
const commitsSkillPath = path.join(repoRoot, '.cursor', 'skills', 'commits', 'SKILL.md');
const workflowDocPath = path.join(repoRoot, 'docs', 'workflow.md');
const developerPath = path.join(repoRoot, '.cursor', 'agents', 'developer.md');

const finishVersionEnglish =
  'At finish, after the archive commit and before push, create one chore commit that sets the root package.json version. Keep that commit separate from the archive docs commit. If the version field is absent, set 0.1.0. If the person named major, minor, or patch for this change, bump that component and reset lower components to 0. Otherwise bump patch. Do not bump the version during propose or apply. Do not add or change version in a workspace package.json.';

const finishVersionRussian =
  'После коммита archive и до push — один отдельный коммит chore, который задаёт version в корневом package.json. Если поля нет, записать 0.1.0. Если человек для этого изменения назвал major, minor или patch, увеличить этот компонент и обнулить младшие до 0. Иначе увеличить patch. Во время propose и apply версию не менять. В package.json воркспейсов поле version не добавлять и не менять. Коммит archive (docs) остаётся отдельным.';

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

describe('ghcr-image-publish: README documents pull and run', () => {
  it('README shows the published image and the local compose build', () => {
    const readme = readFileSync(readmePath, 'utf8').replace(/\r\n/g, '\n');
    const sectionStart = readme.indexOf('## Run in a container');
    const sectionEnd = readme.indexOf('\n## ', sectionStart + 1);
    expect(sectionStart).toBeGreaterThanOrEqual(0);
    expect(sectionEnd).toBeGreaterThan(sectionStart);
    const section = readme.slice(sectionStart, sectionEnd);

    expect(section).toContain('docker compose up -d --build');

    const publishedStart = section.indexOf('### Published image');
    expect(publishedStart).toBeGreaterThanOrEqual(0);
    const published = section.slice(publishedStart);
    expect(published).toContain('No registry login');
    expect(published).not.toContain('docker login');
    expect(published).toContain('docker pull ghcr.io/johnneon/mcp_gateway:latest');

    const latestAt = published.indexOf('ghcr.io/johnneon/mcp_gateway:latest');
    const shaAt = published.indexOf('7-character');
    const semverAt = published.indexOf('ghcr.io/johnneon/mcp_gateway:0.1.0');
    expect(latestAt).toBeGreaterThanOrEqual(0);
    expect(shaAt).toBeGreaterThanOrEqual(0);
    expect(semverAt).toBeGreaterThanOrEqual(0);
    const positions = [latestAt, shaAt, semverAt].sort((left, right) => left - right);
    const first = positions[0] ?? 0;
    const last = positions[2] ?? 0;
    expect(last - first).toBeLessThan(600);
    expect(published).toContain('package.json');
    expect(published).not.toContain('ghcr.io/johnneon/mcp_gateway:v');

    const imageTags = [
      ...published.matchAll(/ghcr\.io\/johnneon\/mcp_gateway:([A-Za-z0-9._-]+)/g),
    ].map((match) => match[1] ?? '');
    expect(imageTags).toContain('latest');
    expect(imageTags).toContain('0.1.0');
    for (const tag of imageTags) {
      expect(tag.startsWith('v')).toBe(false);
      expect(/^\d+$/.test(tag) || /^\d+\.\d+$/.test(tag)).toBe(false);
    }

    const runMatch = published.match(/```bash\n(docker run[\s\S]*?)```/);
    const run = runMatch?.[1] ?? '';
    expect(run).toContain('-e ENCRYPTION_KEY');
    expect(run).toContain('-p 3100:3100');
    expect(run).toContain('-p 127.0.0.1:3200:3200');
    expect(run).toMatch(/-v \S+:\/data/);
    expect(run.match(/-e \S+/g)).toEqual(['-e ENCRYPTION_KEY']);
    expect(run).not.toContain('--env-file');
    expect(run).not.toContain('MCP_HOST');
  });
});

describe('ghcr-image-publish: Finish bumps the root package version', () => {
  it('Finish instructions bump the root version before push', () => {
    const commits = readFileSync(commitsSkillPath, 'utf8').replace(/\r\n/g, '\n');
    const workflow = readFileSync(workflowDocPath, 'utf8').replace(/\r\n/g, '\n');
    const developer = readFileSync(developerPath, 'utf8').replace(/\r\n/g, '\n');

    expect(commits).toContain(finishVersionEnglish);
    expect(developer).toContain(finishVersionEnglish);

    const table = commits.slice(
      commits.indexOf('## When to commit'),
      commits.indexOf('## Message'),
    );
    expect(table).toContain('| `chore:` |');
    expect(table).toContain(finishVersionEnglish);

    const pushSection = commits.slice(commits.indexOf('## Push and pull request'));
    const versionInPush = pushSection.indexOf(finishVersionEnglish);
    const suiteInPush = pushSection.indexOf('The tree is clean and the full test suite passes.');
    const gitPush = pushSection.indexOf('git push -u origin');
    expect(versionInPush).toBeGreaterThanOrEqual(0);
    expect(suiteInPush).toBeGreaterThan(versionInPush);
    expect(gitPush).toBeGreaterThan(suiteInPush);

    const devFinish = developer.slice(developer.indexOf('## Finish'));
    const archiveAt = devFinish.indexOf('commit the archive with `docs:`');
    const versionAt = devFinish.indexOf(finishVersionEnglish);
    const suiteAt = devFinish.indexOf('Run the full test suite once more.');
    const pushAt = devFinish.indexOf('Push and open the pull request');
    expect(archiveAt).toBeGreaterThanOrEqual(0);
    expect(versionAt).toBeGreaterThan(archiveAt);
    expect(suiteAt).toBeGreaterThan(versionAt);
    expect(pushAt).toBeGreaterThan(suiteAt);

    const finishStart = workflow.indexOf('### 6. Finish');
    const finishEnd = workflow.indexOf('### 7. Merge');
    expect(finishStart).toBeGreaterThanOrEqual(0);
    expect(finishEnd).toBeGreaterThan(finishStart);
    const finish = workflow.slice(finishStart, finishEnd);
    expect(finish).toContain(finishVersionRussian);
    const archiveStep = finish.indexOf('Коммит `docs:`');
    const versionStep = finish.indexOf(finishVersionRussian);
    const pushStep = finish.indexOf('git push -u origin');
    expect(archiveStep).toBeGreaterThanOrEqual(0);
    expect(versionStep).toBeGreaterThan(archiveStep);
    expect(pushStep).toBeGreaterThan(versionStep);
    expect(finish).not.toContain('full test suite');
    expect(finish).not.toContain('npm test');
  });
});
