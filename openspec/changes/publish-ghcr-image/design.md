# Design

## Context

See `proposal.md` — Why. On `main` today: `Dockerfile` runs one process (`node server/dist/main.js`) and listens on `3100` and `3200`; `docker-compose.yml` builds that file locally as image `mcp-gateway`; `.github/workflows/ci.yml` runs checks on `pull_request` into `main` and does not push an image. Capability `pull-request-checks` covers that checks workflow only. This machine has no Docker. The image name, tags, platform, public package, and push-to-`main` trigger are already decided.

## Goals / Non-Goals

**Goals:**

- One new workflow file publishes on every push to `main`.
- Tags `latest` and a fixed 7-character SHA. Platform `linux/amd64` only.
- `GITHUB_TOKEN` with `contents: read` and `packages: write`. No other token.
- After the push, the user-owned package `mcp_gateway` becomes public, and a later run still succeeds.
- README documents anonymous pull and run. Compose still builds locally.
- Vitest reads the YAML and the README. No GHCR call, no `docker` CLI.

**Non-Goals:**

- Editing `.github/workflows/ci.yml`, the Dockerfile, or `docker-compose.yml`.
- Multi-arch, semver tags, tag-push or `workflow_dispatch` publishes, another registry.
- Attestations that need `id-token: write`.

## Decisions

### 1. Workflow file and trigger

- File: `.github/workflows/publish-image.yml`. Workflow name `publish-image`. One job id `publish`.
- `runs-on: ubuntu-24.04`, the same runner as `ci.yml`.
- Trigger only:

```yaml
on:
  push:
    branches:
      - main
```

- No `pull_request`, no `tags`, no `workflow_dispatch`, no path filter. Every push to `main` publishes, including pushes that do not touch the Dockerfile.
- Permissions at the workflow level, nothing broader:

```yaml
permissions:
  contents: read
  packages: write
```

- Checkout with `actions/checkout@v7`, matching `ci.yml`. Default fetch depth is enough: the short tag comes from `GITHUB_SHA`, not from git history.

**Alternative:** add a publish job to `ci.yml` — rejected. That file is the pull-request checks contract. A pull request must not push.

### 2. Build and tags

- Login: `docker/login-action` at the current v3 major, registry `ghcr.io`, username `${{ github.repository_owner }}`, password `${{ secrets.GITHUB_TOKEN }}`.
- Build: `docker/setup-buildx-action` and `docker/build-push-action` at their current majors (v3 and v6 as of this proposal). Do not add `docker/setup-qemu-action`. The runner is already amd64.
- Inputs that the spec checks: `push: true`, `platforms: linux/amd64`, `file: Dockerfile`, `context: .`, tags:

```text
ghcr.io/johnneon/mcp_gateway:latest
ghcr.io/johnneon/mcp_gateway:${{ steps.image.outputs.short_sha }}
```

- Short SHA, fixed length 7, from the Actions environment (always 40 hex characters):

```yaml
- name: Short SHA
  id: image
  run: echo "short_sha=${GITHUB_SHA:0:7}" >> "$GITHUB_OUTPUT"
```

  Do not use `git rev-parse --short`. That length grows when the prefix is ambiguous.

- `provenance: false` and `sbom: false` so the job does not request `id-token: write`.
- Label `org.opencontainers.image.source=https://github.com/${{ github.repository }}` so the package links to this repository. Linking inherits repository access; it does not set visibility. The package is still private on first create.

**Alternative:** `docker/metadata-action` for tags — rejected. It exists to emit semver and floating tags this change does not want.

### 3. Make the package public, and allow a repeat

Owner is the user `johnneon`, not an organization. Package type `container`, name `mcp_gateway`. API path: `user/packages/container/mcp_gateway`. `gh` is already on GitHub-hosted Ubuntu runners. `GH_TOKEN` is `${{ secrets.GITHUB_TOKEN }}`.

The step runs after the push in the same job. It is safe to repeat because it never sends `private`, and it exits 0 when the package is already public:

1. GET the package. The first push can return 404 until the package is indexed, so retry that GET a few times with a short sleep.
2. If `.visibility` is `public`, print `Package is already public.` and `exit 0`.
3. If the GET never returns a visibility, fail the job.
4. Otherwise PUT that path with `visibility=public`. If PUT is rejected (method not allowed or not found) and the package is still not public, PATCH the same path with the same field. Then GET again and fail the job unless `.visibility` is `public`.

GitHub does not let a public package become private again. This step only ever asks for `public`.

**Alternative:** a personal access token with admin rights — rejected. The decision is `GITHUB_TOKEN` and `packages: write`.

**Alternative:** leave the package private and document `docker login` — rejected. An anonymous pull is the outcome.

### 4. README, without changing Compose

Under the existing "Run in a container" section, add a published-image subsection. Keep `docker compose up -d --build` as the local build. Do not point `docker-compose.yml` at GHCR.

Document:

- No registry login. `docker pull ghcr.io/johnneon/mcp_gateway:latest`.
- The other tag is `ghcr.io/johnneon/mcp_gateway:` plus the 7-character commit SHA.
- `docker run` passes only `ENCRYPTION_KEY`. The image already sets `MCP_HOST`, `MCP_PORT`, `ADMIN_HOST`, `ADMIN_PORT`, and `DATA_DIR`. Do not tell the operator to pass the host `.env` from the non-container "Run" section: that file binds different hosts and ports.
- Ports: `-p 3100:3100` and `-p 127.0.0.1:3200:3200`. Volume: a named volume mounted at `/data` (the same role as Compose's `gateway-data`).
- Admin stays on loopback. MCP health is `GET http://127.0.0.1:3100/health`. The UI is `http://127.0.0.1:3200`.

### 5. Tests read files

New Vitest file `server/test/ci/publish-image.test.ts`. Reuse the `yaml` parser style from `server/test/ci/workflow.test.ts`. Do not change that file's parser so it still requires a `pull_request` trigger; the publish file has no such trigger.

One test per delta scenario. The test name includes the requirement name and the scenario name, as the `tests` skill requires. Assertions read the workflow YAML and `README.md`. They do not spawn `docker` and do not call `gh` or GHCR.

The visibility scenario asserts, from the step script text, that:

- the push step precedes the visibility step;
- the script names `user/packages/container/mcp_gateway`, sets visibility `public`, and uses `GITHUB_TOKEN`;
- when visibility is already `public` the script takes a path that `exit 0`;
- the script does not request visibility `private`.

The pull-request file assertion reads `.github/workflows/ci.yml` and checks its `on` mapping and that the image name is absent. Do not edit that file.

`npm run format:check` includes `.github/workflows/*.{yml,yaml}`. Format the new workflow with the project Prettier before the task is done. README is outside that script.

## Risks / Trade-offs

- [The first push creates a private package, and `GITHUB_TOKEN` may get 403 on the visibility write] → The job fails unless a follow-up GET reports `public`. Do not add a PAT in this change. A green run is the signal that anonymous pull can work. If the first run on `main` fails here, that is a follow-up, not a silent private package.
- [PUT is no longer the update verb] → The same step falls back to PATCH on the same path. The spec checks the outcome, not the verb.
- [Public cannot be reversed] → The step never sends `private`. Rollback of the workflow does not make the package private.
- [Two pushes finish out of order, so `latest` can briefly point at the older SHA] → Accepted. The SHA tag stays exact. This repository does not publish concurrently often enough to add a queue.
- [No Docker on the apply machine] → Tests never run the daemon. The anonymous pull is checked by a person after the workflow has run on `main`.

## Migration Plan

Adding the workflow and the README does not change the running process. The image appears on GHCR only after this change is on `main`.

Rollback: remove the workflow. Images already pushed remain. A public package stays public; deleting versions is a separate GitHub action and is not part of this change.

## Open Questions

None. Trigger, tags, platform, image name, token, and public visibility are decided. The PUT-then-PATCH fallback stays inside the visibility step and does not change the spec or the task split.
