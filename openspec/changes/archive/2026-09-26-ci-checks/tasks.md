# Tasks

## 1. Prettier and root format scripts

- [x] 1.1 Add Prettier to the root devDependencies, a config, and `.prettierignore` (exclude `package-lock.json`, `dist`, `node_modules`, `docs/**`, `openspec/**`, `mcp-gateway-spec.md`; format TS/TSX/CSS/JSON under `server/` and `web/`, workflow YAML, and root configs per design). Root scripts `format` and `format:check`. Check: `npm run format:check` exits 0 after an initial `format` of the included paths (without rewriting Markdown under docs/openspec).

## 2. ESLint

- [x] 2.1 Add an ESLint 9 flat config at the root (typescript-eslint `strictTypeChecked` or equivalent, `@typescript-eslint/no-explicit-any` as an error everywhere including tests, the unsafe-any family enabled, `eslint-plugin-react-hooks` recommended for `web/`, and `eslint-config-prettier` last; ignore `dist`/`node_modules`/coverage). Root script `lint`. Check: `npm run lint` runs (it may fail on the skeleton until task 2.2).

- [x] 2.2 Bring the existing `server/` and `web/` code to lint-clean and format-clean without weakening `any`/unsafe and without an escape hatch for tests. Check: `npm run lint` and `npm run format:check` exit 0; `npm run typecheck` passes.

## 3. GitHub Actions workflow

- [x] 3.1 Add `.github/workflows/ci.yml`: `pull_request` → `main`, Node.js 22, `npm ci`, then `typecheck`, `lint`, `format:check`, `test`, `build`; job id aligned with design (`checks`). Check: the file exists; the automated test of the delta scenario "Workflow declares Node 22 and every check" passes (read the YAML without the GitHub API).

## 4. Delta automated tests

- [x] 4.1 Automated tests of the ESLint scenarios: explicit `any` in temp snippets on paths like `server/` and `web/` produces an `@typescript-eslint/no-explicit-any` error (ESLint API or spawn). Test names include the requirement id and the scenario name. Check: the tests pass under `npm test` (the workspace from design).

- [x] 4.2 Automated tests of the `format:check` scenarios: non-zero exit on a broken snippet, zero on a formatted one. Check: the tests pass; full `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, and `npm run build` from the root exit 0.

## 5. Agents and skills

- [x] 5.1 Update only the listed files: `.cursor/skills/backend/SKILL.md`, `.cursor/skills/frontend/SKILL.md`, `.cursor/agents/developer.md`, `.cursor/agents/validator.md`, `docs/workflow.md`, `.cursor/skills/code-review/SKILL.md`, and apply guidance in `openspec/config.yaml` — lint/format check commands, the no explicit `any` rule, a blocker in code-review, and the validator Checks lines. Do not touch `openspec-*` skills, `mcp-gateway-spec.md`, or `openspec/specs/`. Check: each file mentions lint and format check (and any/blockers where the proposal says so).

## 6. Repository ruleset (not in git)

- [x] 6.1 During apply the developer creates (or updates) an active repository ruleset on `main` through `gh api`: the required status check is the check from the workflow (`checks` / the name confirmed after the first run), with no bypass for admins (`bypass_actors` empty). If `gh` is not authorized or the API rejects the call (403 and similar) — **stop and tell the person** (admin/ruleset rights are required); do not treat the task as done on the advice of "just click in the UI" without someone carrying out the equivalent. Check: `gh api` shows an active ruleset on `main` with the required check and no admin bypass; the validator later confirms the same way. There is no Vitest scenario for a live merge.
