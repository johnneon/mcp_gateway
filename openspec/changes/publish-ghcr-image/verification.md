# publish-ghcr-image

## Result
blockers: 1

## Spec
- Publish workflow runs on push to main: met
- Image tags and platform: met
- Package visibility is public and repeatable: gap
- README documents pull and run: met
- Finish bumps the root package version: met

## Checks
- tests: passed — 425 tests (server 380, web 45), including 6 in `server/test/ci/publish-image.test.ts`. All 4 tasks are checked. `npx openspec validate publish-ghcr-image` passed.
- type check: passed
- lint: passed
- format check: passed
- build: passed

## Review
- blocker: `.github/workflows/publish-image.yml` visibility step sets `GH_TOKEN` from `secrets.GITHUB_TOKEN`, then runs `set -euo pipefail` and `export GH_TOKEN="${GITHUB_TOKEN}"`. `GITHUB_TOKEN` is not a default Actions environment variable, so `set -u` exits before `gh api` and before `exit 0` when visibility is already `public`. The package is not set public, and a repeat run does not succeed. `server/test/ci/publish-image.test.ts` only searches the `run` script for the string `GITHUB_TOKEN` and does not read step `env`, so the passing file-read test does not show that path is reachable.
- note: If PUT fails and PATCH returns non-zero, `set -e` leaves the visibility step before the confirming GET in design decision 3. The job still fails. This is not a second blocker.

## E2E
- Workflow publishes only from a push to main: passed — file-read contract, no admin UI or MCP surface. `publish-image.yml` triggers only on `push` to `main`, permissions `contents: read` and `packages: write`, job `ubuntu-24.04`, login password `secrets.GITHUB_TOKEN`. `ci.yml` still triggers on `pull_request` to `main` and does not name `ghcr.io/johnneon/mcp_gateway`. No GHCR call.
- Workflow declares latest, a 7-character SHA, the package version, and amd64: passed — file-read contract, no admin UI or MCP surface. Tags are `latest`, `${GITHUB_SHA:0:7}`, and `steps.version.outputs.version` on `ghcr.io/johnneon/mcp_gateway`, platform `linux/amd64`. The file does not mention `arm64`. No Docker.
- Job fails when the package version is missing or not three numeric components: passed — file-read contract, no admin UI or MCP surface. The version step reads root `package.json` and calls `process.exit(1)` on a missing or non `MAJOR.MINOR.PATCH` value before writing `GITHUB_OUTPUT`. No live job.
- Visibility step sets public and succeeds when already public: failed — file-read contract, no admin UI or MCP surface, no GHCR call. The run script exits on unset `GITHUB_TOKEN` before the already-public `exit 0`.
- README shows the published image and the local compose build: passed — file-read contract, no admin UI or MCP surface. README documents `docker pull ghcr.io/johnneon/mcp_gateway:latest`, the 7-character SHA tag, `ghcr.io/johnneon/mcp_gateway:0.1.0` with no `v` prefix, `docker run` with only `ENCRYPTION_KEY`, ports `3100` and `127.0.0.1:3200`, a volume at `/data`, and `docker compose up -d --build`. No `docker pull`.
- Finish instructions bump the root version before push: passed — file-read contract, no admin UI or MCP surface. The English sentence is in `.cursor/skills/commits/SKILL.md` and `.cursor/agents/developer.md`. The Russian sentence is in the finish step of `docs/workflow.md`. Root `package.json` has no `version` field.

## Leaks
- `.github/workflows/publish-image.yml`: clean
- `README.md`: clean
- `server/test/ci/publish-image.test.ts`: clean
- `git diff origin/main...HEAD`: clean
- admin UI and MCP responses: no surface in this delta
