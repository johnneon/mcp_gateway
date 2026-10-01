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
- tests: passed — 380 server + 45 web (425 total). `publish-image.test.ts` has 6 tests, one per delta scenario. All 4 tasks in `tasks.md` are checked. `npx openspec validate publish-ghcr-image` passed.
- type check: passed
- lint: passed
- format check: passed
- build: passed

## Review
- blocker: `.github/workflows/publish-image.yml` lines 61–65 set `GH_TOKEN` from `secrets.GITHUB_TOKEN`, then `set -euo pipefail` and `export GH_TOKEN="${GITHUB_TOKEN}"`. `GITHUB_TOKEN` is not a default Actions environment variable, so the shell exits on an unbound variable before `gh api`. The package is never set to `public`, and the already-public `exit 0` path never runs. `server/test/ci/publish-image.test.ts` only checks that the run script contains the string `GITHUB_TOKEN`.
- note: If PUT fails and PATCH returns non-zero, `set -e` leaves the visibility step before the confirming GET in design decision 3. The job still fails. This is not a second blocker.
- note: `git diff origin/main...HEAD` does not change `server/src`, `web/`, `Dockerfile`, `docker-compose.yml`, `.github/workflows/ci.yml`, `package.json`, `mcp-gateway-spec.md`, or `openspec/specs/`. No explicit `any`. Login, tags `latest` / 7-character `GITHUB_SHA` / root `version`, `linux/amd64`, the README pull and run text, and the finish sentences in `.cursor/skills/commits/SKILL.md`, `docs/workflow.md`, and `.cursor/agents/developer.md` match the delta.

## E2E
- Workflow publishes only from a push to main: passed — file-read contract, no admin UI or MCP surface. Read locally; GHCR was not called.
- Workflow declares latest, a 7-character SHA, the package version, and amd64: passed — file-read contract, no admin UI or MCP surface. Read locally; GHCR was not called.
- Job fails when the package version is missing or not three numeric components: passed — file-read contract, no admin UI or MCP surface. The version step calls `process.exit(1)` before the echo that writes `GITHUB_OUTPUT`, and it does not substitute another version. GHCR was not called.
- Visibility step sets public and succeeds when already public: failed — file-read contract, no admin UI or MCP surface. The script aborts on unbound `GITHUB_TOKEN` before the packages API and before `exit 0`. GHCR was not called. Docker is not installed on this machine; that absence is not a failure.
- README shows the published image and the local compose build: passed — file-read contract, no admin UI or MCP surface. README shows `docker pull ghcr.io/johnneon/mcp_gateway:latest`, the 7-character SHA, `ghcr.io/johnneon/mcp_gateway:0.1.0`, `docker run` with `ENCRYPTION_KEY`, `-p 3100:3100`, `-p 127.0.0.1:3200:3200`, `-v gateway-data:/data`, and `docker compose up -d --build`.
- Finish instructions bump the root version before push: passed — file-read contract, no admin UI or MCP surface. The English sentence is in the commits skill and `developer.md`. The Russian sentence is in the finish step of `docs/workflow.md`.

## Leaks
- `.github/workflows/publish-image.yml`: clean
- `README.md` published-image section: clean
- `server/test/ci/publish-image.test.ts`: clean
- `git diff origin/main...HEAD`: clean
- admin UI and MCP responses: clean — this change has no admin or MCP surface; no screen or MCP body was produced
