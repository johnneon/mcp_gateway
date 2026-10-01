# Proposal

Issue: #48

## Why

The repository already builds a container, but nothing publishes it. After a merge into `main`, an operator still has to build on the machine that runs the gateway. A public image on GHCR lets that machine `docker pull` without a registry login.

## What Changes

- On every push to `main`, a new GitHub Actions workflow builds the existing Dockerfile for `linux/amd64` and pushes `ghcr.io/johnneon/mcp_gateway` with tags `latest` and the 7-character commit SHA.
- The workflow uses `GITHUB_TOKEN` with `contents: read` and `packages: write`. It does not run on `pull_request`.
- GitHub creates the package private. After the push, the workflow sets that package to public through the packages visibility API. Repeating the step when the package is already public succeeds.
- README documents an anonymous pull and a run of the published image. Compose keeps building locally; the published image is another way to run the same process.
- Automated checks read the workflow YAML and the README. They do not call GHCR.

## Non-goals

- Multi-arch images, including `linux/arm64`.
- Semver or other tags besides `latest` and the 7-character SHA.
- Publishing on tag pushes or `workflow_dispatch`.
- Changing the Dockerfile runtime, the image command, or the ports the image listens on.
- A registry other than GHCR.
- Switching Compose from a local build to the published image.
- Folding publish behavior into `pull-request-checks` or changing that workflow's job.
- A live GHCR or `docker pull` call in unit tests.
- Edits to `mcp-gateway-spec.md` or `openspec/specs/` before archive.

## Capabilities

### New Capabilities

- `ghcr-image-publish`: the repository contract for publishing `ghcr.io/johnneon/mcp_gateway` on push to `main` (Ubuntu, `GITHUB_TOKEN`, `linux/amd64`, tags `latest` and the 7-character SHA, public package, repeatable visibility step) and for README pull/run instructions. Scenarios are checked by reading files, not by calling GHCR.

### Modified Capabilities

- (none — `pull-request-checks` stays the pull-request job only; process, MCP, and admin behavior stay the same)

## Impact

- New workflow file under `.github/workflows/`. `.github/workflows/ci.yml` keeps its current job.
- README section for the published image, beside the existing Compose instructions.
- Vitest under `server/test/` that parses the workflow YAML and reads the README, same style as the pull-request checks workflow test.
- No change to `server/` or `web/` runtime, the Dockerfile command, or `docker-compose.yml`.
- The image does not exist on GHCR until the first push of this workflow to `main`. An anonymous pull is a check after that push, not a unit test.
