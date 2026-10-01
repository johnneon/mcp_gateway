# Tasks

## 1. Publish workflow

- [ ] 1.1 Add `.github/workflows/publish-image.yml` as design describes: `push` to `main` only, `ubuntu-24.04`, permissions `contents: read` and `packages: write`, login to `ghcr.io` with `GITHUB_TOKEN`, build the existing Dockerfile for `linux/amd64`, tags `latest` and the first 7 characters of `GITHUB_SHA`, then the repeatable visibility step for container package `mcp_gateway`. Do not edit `.github/workflows/ci.yml`, `Dockerfile`, or `docker-compose.yml`. Add `server/test/ci/publish-image.test.ts` that reads those YAML files and covers the delta scenarios "Workflow publishes only from a push to main", "Workflow declares latest, a 7-character SHA, and amd64", and "Visibility step sets public and succeeds when already public". Test names include the requirement name and the scenario name. The tests do not call GHCR, `gh`, or `docker`. Format the workflow with project Prettier. Check: those three tests pass, and `npm run format:check` exits 0.

## 2. README

- [ ] 2.1 In README, under "Run in a container", document an anonymous `docker pull` of `ghcr.io/johnneon/mcp_gateway:latest`, the 7-character SHA tag, and a `docker run` that passes only `ENCRYPTION_KEY`, publishes `3100` and loopback `3200`, and mounts a data volume. Keep the local `docker compose up -d --build` instructions. Extend `server/test/ci/publish-image.test.ts` with the scenario "README shows the published image and the local compose build". Check: that test passes. Do not call GHCR or `docker`.

## 3. Full package check

- [ ] 3.1 From the repository root, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, and `npm run build` all exit 0. The existing pull-request checks tests still pass. No live GHCR call.
