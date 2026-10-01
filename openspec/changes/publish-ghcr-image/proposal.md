# Proposal

Issue: #48

## Why

The repository already builds a container, but nothing publishes it. After a merge into `main`, an operator still has to build on the machine that runs the gateway. A public image on GHCR lets that machine `docker pull` without a registry login. An exact package version on that image lets the operator pin a release, and the development cycle must move that version so a later push does not slide the same tag.

## What Changes

- On every push to `main`, a new GitHub Actions workflow builds the existing Dockerfile for `linux/amd64` and pushes `ghcr.io/johnneon/mcp_gateway` with tags `latest`, the 7-character commit SHA, and the exact `version` from the root `package.json` of the commit being built. The version pattern is MAJOR.MINOR.PATCH, digits only, with no `v` prefix, no prerelease, and no build metadata. Example: `ghcr.io/johnneon/mcp_gateway:0.1.0`.
- The publish job reads that field from the commit being built. If the field is missing or is not exactly three numeric components, the job fails and does not invent a tag. The job does not push a floating tag that is only MAJOR or only MAJOR.MINOR.
- Root `package.json` has no `version` today. `server/package.json` and `web/package.json` have none. The image version is only the root field. Apply does not write it and does not bump. Finish of this change, after the archive commit and before push, sets `0.1.0` because the field is absent. Later finishes bump that field so the same tag is not pushed again. Workspace `package.json` files are not versioned by this change. `packages/fake-stdio-mcp/package.json` already has its own `version` and stays as it is.
- `.cursor/skills/commits/SKILL.md`, the finish step in `docs/workflow.md`, and the finish list in `.cursor/agents/developer.md` state that bump, the same default, and that propose and apply do not bump. The archive `docs` commit stays separate. Generated `openspec-*` skills are not edited, and no new skill file is added.
- The workflow uses `GITHUB_TOKEN` with `contents: read` and `packages: write`. It does not run on `pull_request`.
- GitHub creates the package private. After the push, the workflow sets that package to public through the packages visibility API. Repeating the step when the package is already public succeeds.
- README documents an anonymous pull and a run of the published image, including the semver tag next to `latest` and the short SHA. Compose keeps building locally; the published image is another way to run the same process.
- Automated checks read the workflow YAML, the README, and the three finish instructions. They do not call GHCR.

## Non-goals

- Multi-arch images, including `linux/arm64`.
- A floating image tag that is only MAJOR, or only MAJOR.MINOR.
- A `v` prefix, a prerelease, or build metadata on the image tag.
- Git tags, including a git tag as the version source.
- Publishing on tag pushes or `workflow_dispatch`.
- Changing the Dockerfile runtime, the image command, or the ports the image listens on.
- A registry other than GHCR.
- Switching Compose from a local build to the published image.
- Folding publish behavior into `pull-request-checks` or changing that workflow's job.
- A live GHCR or `docker pull` call in unit tests.
- A version field on `server/package.json` or `web/package.json`.
- Edits to generated `openspec-*` skills, or a new skill file.
- Edits to `mcp-gateway-spec.md` or `openspec/specs/` before archive.

## Capabilities

### New Capabilities

- `ghcr-image-publish`: the repository contract for publishing `ghcr.io/johnneon/mcp_gateway` on push to `main` (Ubuntu, `GITHUB_TOKEN`, `linux/amd64`, tags `latest`, the 7-character SHA, and the exact root `package.json` version, fail if that version is missing or not three numeric components, public package, repeatable visibility step), for README pull/run instructions including that semver tag, and for the finish-time root version bump in the commits skill, `docs/workflow.md`, and `.cursor/agents/developer.md`. Scenarios are checked by reading files, not by calling GHCR.

### Modified Capabilities

- (none — `pull-request-checks` stays the pull-request job only; process, MCP, and admin behavior stay the same)

## Impact

- New workflow file under `.github/workflows/`. `.github/workflows/ci.yml` keeps its current job.
- Root `package.json` gains `"version": "0.1.0"` in the finish chore commit of this change, because the field is absent. Apply does not edit it. Workspace package files are not given a version by this change.
- README section for the published image, beside the existing Compose instructions, naming `latest`, the short SHA, and the semver tag.
- `.cursor/skills/commits/SKILL.md`, `docs/workflow.md`, and `.cursor/agents/developer.md` gain the same finish-time bump.
- Vitest under `server/test/` that parses the workflow YAML and reads the README and those three instruction files, same style as the pull-request checks workflow test.
- No change to `server/` or `web/` runtime, the Dockerfile command, or `docker-compose.yml`.
- The image does not exist on GHCR until the first push of this workflow to `main`. An anonymous pull is a check after that push, not a unit test.
