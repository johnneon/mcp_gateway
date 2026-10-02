# publish-ghcr-image

## Result
blockers: 0

## Spec
- Publish workflow runs on push to main: met
- Image tags and platform: met
- Package visibility is public and repeatable: met
- README documents pull and run: met
- Finish bumps the root package version: met

## Checks
- tests: passed — 425 tests (server 380, web 45), including `server/test/ci/publish-image.test.ts`
- type check: passed
- lint: passed
- format check: passed
- build: passed

## Review
- note: In `.github/workflows/publish-image.yml`, a failed PATCH under `set -euo pipefail` exits before the confirming GET. The already-public path still exits 0, and the step never requests `private`.

## E2E
- Workflow publishes only from a push to main: passed — `publish-image.yml` triggers only on `push` to `main`, permissions are `contents: read` and `packages: write`, the job runs on `ubuntu-24.04`, and login uses `ghcr.io` with `secrets.GITHUB_TOKEN`. `ci.yml` still triggers on `pull_request` to `main` and does not name `ghcr.io/johnneon/mcp_gateway`.
- Workflow declares latest, a 7-character SHA, the package version, and amd64: passed — tags are `latest`, `${GITHUB_SHA:0:7}`, and `steps.version.outputs.version` on `ghcr.io/johnneon/mcp_gateway`, platform `linux/amd64`, no `arm64`, no `v` prefix, no MAJOR-only or MAJOR.MINOR tag.
- Job fails when the package version is missing or not three numeric components: passed — the `version` step reads root `package.json` after Node 22 and before the image push, exits 1 unless the field matches `^[0-9]+\.[0-9]+\.[0-9]+$`, and does not write a replacement version. Root `package.json` still has no `version` field.
- Visibility step sets public and succeeds when already public: passed — the push step precedes `user/packages/container/mcp_gateway`. The step maps `secrets.GITHUB_TOKEN` to `GH_TOKEN` and does not expand `$GITHUB_TOKEN`. With `GITHUB_TOKEN` unset, `GH_TOKEN` set, and a local `gh` stub that returned `public`, the script printed `Package is already public.` and exited 0. The stub recorded one GET and no `private`, PUT, or PATCH. GHCR was not called. Docker is absent on this machine and was not required.
- README shows the published image and the local compose build: passed — under "Run in a container", `docker pull ghcr.io/johnneon/mcp_gateway:latest`, the 7-character SHA, and `ghcr.io/johnneon/mcp_gateway:0.1.0` sit together, with no `v` prefix and no floating MAJOR or MAJOR.MINOR tag. `docker run` passes only `ENCRYPTION_KEY`, publishes `3100` and `127.0.0.1:3200`, and mounts a volume at `/data`. `docker compose up -d --build` remains.
- Finish instructions bump the root version before push: passed — `.cursor/skills/commits/SKILL.md` and `.cursor/agents/developer.md` contain the English finish sentence, and the finish step of `docs/workflow.md` contains the Russian sentence. The version commit is after archive and before push. Propose and apply do not bump.

## Leaks
- `.github/workflows/publish-image.yml`: clean
- `README.md` published-image section: clean
- `server/test/ci/publish-image.test.ts`: clean
- commits on `change/publish-ghcr-image`: clean
- admin UI and MCP responses: not in this delta
