# Proposal

## Why

After the process skeleton, merging into `main` is unprotected: GitHub has no required checks, and locally there is no single lint/format contract. Stage 2 of the former roadmap (`docs/roadmap.md`) and the person's extension close that gap before the next product changes.

## What Changes

- On every pull request into `main`, GitHub Actions on Node.js 22 runs the root `typecheck`, `lint`, `format:check`, `test`, and `build` for the `server` and `web` workspaces.
- A repository ruleset (or equivalent) makes that status check required to merge into `main`, with no administrator bypass. It is created through `gh api` during apply and is not stored in git.
- ESLint 9 flat config with typescript-eslint type-checked strict (including a ban on explicit `any` and the unsafe-any family); for `web`, react-hooks recommended; `eslint-config-prettier` last in the chain. Root script `lint`. The existing skeleton is brought to lint-clean during apply.
- Prettier: root `format` and `format:check` for TS/TSX/CSS/JSON under `server/` and `web/`, workflow YAML, and root configs that Prettier owns. Markdown under `docs/`, `openspec/`, and `mcp-gateway-spec.md` is not reformatted.
- Skills and agents (`backend`, `frontend`, `developer`, `validator`, `code-review`, `docs/workflow.md`, apply guidance in `openspec/config.yaml`) learn the lint/format check and the "no explicit any" rule.

Extension beyond the stage 2 roadmap text: ESLint, Prettier, agent/skill updates, and an explicit ruleset plan through `gh` (not only the workflow file).

## Non-goals

- Deploy / CD, releases, Dependabot, coverage thresholds, and required pre-commit/Husky (CI is the only required gate).
- Reformatting Markdown in `docs/`, `openspec/`, and `mcp-gateway-spec.md`.
- Gateway product behavior (routes, connectors, UI).
- Edits to `mcp-gateway-spec.md` and `openspec/specs/` outside this change's archive.
- Edits to the generated `openspec-*` skills.

## Capabilities

### New Capabilities

- `pull-request-checks`: the repository check contract — a workflow on a PR into `main` (Node 22, typecheck/lint/format check/test/build), ESLint rejecting explicit `any` in `server` and `web`, and `format:check` behavior on a formatted snippet and a broken one. The required GitHub ruleset is in design/tasks, not in delta scenarios.

### Modified Capabilities

- (none — `process-startup` does not change; process startup behavior stays the same)

## Impact

- A new `.github/workflows/*.yml`, root ESLint/Prettier dependencies and scripts, and ignore configs.
- Skeleton edits in `server/` / `web/` only so lint/format pass (apply).
- Vitest tests of the workflow contents and of the ESLint/Prettier contract, with no GitHub API calls.
- Updates to project skills/agents and `docs/workflow.md` / `openspec/config.yaml` (apply guidance).
- Outside git: a repository ruleset on GitHub (the developer creates it through `gh api` during apply; the validator confirms it through `gh`).
