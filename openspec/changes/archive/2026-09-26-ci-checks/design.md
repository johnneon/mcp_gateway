# Design

## Context

See `proposal.md` — Why. Right now: npm workspaces `server`/`web`, root scripts `typecheck` / `test` / `build` / `start`, capability `process-startup`. There is no `.github/workflows/` directory. ESLint and Prettier are not wired in. The `backend`/`frontend` skills and the agents require only tests / typecheck / build. Whether a merge is required on GitHub is not set by a file in git — only by a ruleset or branch protection on the GitHub side.

## Goals / Non-Goals

**Goals:**

- One workflow on a PR into `main`: Node 22, `npm ci`, then typecheck → lint → format:check → test → build.
- One root ESLint 9 flat config for `server/` and `web/`; Prettier owns formatting through `eslint-config-prettier` last in the chain.
- Root `lint`, `format`, `format:check`; CI and agents call them from the root.
- A GitHub ruleset makes the check required with no admin bypass; it is created through `gh api` during apply.
- Delta scenarios are covered by Vitest with no GitHub API; the ruleset is a task plus a validator check through `gh`.

**Non-Goals (design level):**

- Husky / pre-commit as a required gate.
- Coverage thresholds, an OS matrix, and an npm cache beyond a reasonable Actions minimum.
- Reformatting Markdown in the vision, docs, or openspec.
- Changing the process's runtime behavior.

## Decisions

### 1. Workflow name and status check

- File: `.github/workflows/ci.yml`.
- `on.pull_request.branches: [main]`.
- One job named `checks` (the displayed status-check name is `checks`, or the full `ci / checks`, depending on how GitHub names a check from `jobs.<id>` and the workflow name). The final check name for the ruleset is fixed after the first successful run on the change branch and recorded in the ruleset task.
- `actions/setup-node@v4` with `node-version: '22'`, `cache: npm`.
- Steps: `npm ci`; `npm run typecheck`; `npm run lint`; `npm run format:check`; `npm test`; `npm run build`.
- Permissions at the minimum (`contents: read`).

**Alternative:** separate jobs for lint/test — rejected: one required check is simpler for the ruleset and the agents.

### 2. ESLint: one root flat config

- Dependencies in the root `package.json` (devDependencies): `eslint`, `typescript-eslint`, `eslint-config-prettier`, `eslint-plugin-react-hooks`, and `@eslint/js` if needed.
- File `eslint.config.js` (or `.mjs`) at the root: `typescript-eslint` configs with `strictTypeChecked` (or an equivalent type-checked strict), parserOptions.projectService / project pointing at the `server` and `web` tsconfigs.
- Rule `@typescript-eslint/no-explicit-any`: `error` everywhere, including tests. Do not disable or weaken it in overrides for `**/*.test.*`.
- Keep the unsafe-any family from strict type-checked enabled (`no-unsafe-argument`, `no-unsafe-assignment`, `no-unsafe-call`, `no-unsafe-member-access`, `no-unsafe-return`).
- For files under `web/`: add `eslint-plugin-react-hooks` recommended.
- Last item in the chain: `eslint-config-prettier`.
- Ignores: `**/dist/**`, `**/node_modules/**`, coverage, and the lockfile if needed.
- Script `"lint": "eslint ."` (or explicit paths `server` `web`), one entry for CI and agents.
- Apply brings the current skeleton to lint-clean; that is a separate task, not "leave the debt".

**Alternative:** two configs in the packages — rejected; the person preferred one root config.

### 3. Prettier

- Dependency `prettier` at the root.
- Config: `.prettierrc` / `prettier.config.*` with reasonable project defaults (no argument about Markdown style — Markdown is out of scope).
- Ignore: `.prettierignore` — `package-lock.json`, `dist`, `node_modules`, `docs/**`, `openspec/**`, `mcp-gateway-spec.md`, and other generated artifacts.
- Include: `server/**/*.{ts,tsx,css,json}`, `web/**/*.{ts,tsx,css,json}`, `.github/workflows/*.{yml,yaml}`, and root configs Prettier should own (`package.json`, eslint/prettier/tsconfig as needed).
- Scripts: `"format": "prettier --write …"`, `"format:check": "prettier --check …"`.
- Do not add Husky.

### 4. Scenario automated tests (no GitHub)

Placement: preferably `server/test/` (Vitest is already there) or a small root/server set — decided at apply: if the tests read repository files and call the ESLint/Prettier API, keep them in `server/test/ci/` or similar so `npm test -w server` picks them up. An alternative is a separate root vitest only if workspaces get in the way; by default do not add a third runner.

- Workflow: read `.github/workflows/ci.yml` (yaml parse), assert triggers, node 22, and that the script commands are present.
- ESLint: a temp file/snippet through the ESLint API or `spawn` eslint with the project config; assert the rule id.
- Prettier: a temp snippet plus `format:check` / prettier check; assert exit codes.

Do not write a scenario "merge blocked on GitHub".

### 5. Repository ruleset through `gh api` (not in git)

The workflow by itself does not block a merge. During apply the developer:

1. Makes sure the check has succeeded at least once on the change branch (or uses the known job name after the workflow is on the branch and pushed for a trial PR / `workflow_dispatch` is not required — the name from YAML is enough: a ruleset accepts the check name that will appear on the PR; record the expected name `checks` / `ci / checks` in the task and confirm it through `gh`).
2. Creates a ruleset on the branch `main` through the GitHub API (`gh api` REST: repository rulesets), with:
   - target: branch `main` (include `refs/heads/main`);
   - enforcement: `active`;
   - required status checks: that check from the workflow;
   - `strict_required_status_checks_policy`: true (the branch is up to date with the base, where that applies);
   - **no admin bypass**: `bypass_actors` empty / do not include an organization admin bypass; in UI terms, "Do not allow bypassing" / no bypass for admins.
3. Who does it: **the developer agent at the apply step** (a task in `tasks.md`), with `gh` authorized as the repo owner/admin who can edit rulesets. If `gh api` returns 403/404 or the ruleset is not created — **apply stops and tells the person**: ruleset rights are required and the task must be retried; do not leave "click in the UI" as the only plan without stating that the UI is a fallback only if the person carries out the same ruleset contract, and the agent has recorded the blocker.
4. After apply, the validator confirms an active ruleset and the required check through `gh api`/`gh ruleset` (not through Vitest).

The ruleset is not committed. There is no delta scenario for a "live merge".

**Alternative:** the classic branch protection API is acceptable if rulesets are unavailable on the repo plan; prefer rulesets. If neither is possible — stop and report to the person.

### 6. Agent and skill updates (apply only)

Only where a checklist already exists, or an agent would otherwise skip lint/format:

| Path | What to add |
| --- | --- |
| `.cursor/skills/backend/SKILL.md` | lint/format check commands for `server/`; the no explicit `any` rule |
| `.cursor/skills/frontend/SKILL.md` | the same for `web/` |
| `.cursor/agents/developer.md` | in apply: lint and format check next to tests/typecheck/build |
| `.cursor/agents/validator.md` | run lint and format check; lines in the Checks template |
| `docs/workflow.md` | the apply bullet names lint and format check |
| `.cursor/skills/code-review/SKILL.md` | blocker: a new or changed file with explicit `any` or a break of the ESLint/Prettier contract; ordinary style notes are not blockers |
| `openspec/config.yaml` | apply guidance: lint and format check next to tests/typecheck/build |

Do not touch the generated `openspec-*` skills, `mcp-gateway-spec.md`, or `openspec/specs/` before archive.

## Risks / Trade-offs

- [The status check name in the UI is not `jobs.<id>`] → Mitigation: after the first run, confirm through `gh` and write the exact name into the ruleset; the ruleset task comes after the workflow.
- [Strict type-checked ESLint breaks the skeleton] → Mitigation: a separate "lint-clean" task; do not weaken `any`/unsafe.
- [The agent token has no rights to the ruleset] → Mitigation: apply stops and reports; the person grants rights or creates an equivalent ruleset from the contract in this design; the validator checks the fact.
- [ESLint/Prettier tests are fragile around temp paths] → Mitigation: write the snippet under `server/`/`web` with ignore exceptions for temp files, or `overrideConfig` with the same rules.

## Migration Plan

A pure addition of tooling and the workflow. Rollback: revert the change's commits and delete the ruleset through `gh api` (a task for the person or the agent on rollback). There is no product data.

## Open Questions

- The exact displayed name of the required check (`checks` vs `ci / checks`) is closed at apply after the first Actions run; it does not affect the specs.
- If GitHub Free or organization rights forbid rulesets without a bypass, record a blocker for the person; a workaround of "UI only, no `gh`" does not count as the agent having finished the task.
