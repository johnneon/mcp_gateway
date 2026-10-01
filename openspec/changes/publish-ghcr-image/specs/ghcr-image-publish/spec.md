# Spec Delta

## Purpose

Defines how the repository publishes the gateway container image to GHCR on a push to `main`, makes that package public, and documents pull and run. The contract is checked by reading the workflow file and the README, without calling GHCR.

## ADDED Requirements

### Requirement: Publish workflow runs on push to main

The repository SHALL contain a GitHub Actions workflow file under `.github/workflows/` that publishes the image. That file SHALL be distinct from the workflow that runs checks on `pull_request` into `main`. The publish workflow SHALL run on `push` to the branch `main` and SHALL NOT run on `pull_request`, on tag pushes, or on `workflow_dispatch`. The job SHALL run on an Ubuntu runner. Workflow permissions SHALL grant `contents: read` and `packages: write`. Registry login SHALL use `ghcr.io` and the workflow `GITHUB_TOKEN`, and SHALL NOT use a different token secret.

#### Scenario: Workflow publishes only from a push to main

- **GIVEN** the publish workflow file and the pull-request checks workflow file under `.github/workflows/`
- **WHEN** the test reads both files without calling the GitHub API or GHCR
- **THEN** the publish workflow trigger is `push` to `main`
- **AND** the publish workflow trigger does not include `pull_request`, `workflow_dispatch`, or a tag filter
- **AND** the publish workflow permissions include `contents: read` and `packages: write`
- **AND** the publish job runs on an Ubuntu runner
- **AND** registry login uses `ghcr.io` and `GITHUB_TOKEN` and no other token secret
- **AND** the pull-request checks workflow still triggers on `pull_request` to `main`, does not trigger on `push`, and does not name `ghcr.io/johnneon/mcp_gateway`

### Requirement: Image tags and platform

The publish workflow SHALL build the repository Dockerfile and push `ghcr.io/johnneon/mcp_gateway` for platform `linux/amd64` only. The pushed tags SHALL be `latest` and the first 7 hexadecimal characters of the commit SHA. The workflow SHALL NOT target `linux/arm64` or any other platform.

#### Scenario: Workflow declares latest, a 7-character SHA, and amd64

- **GIVEN** the publish workflow file
- **WHEN** the test reads that file without calling GHCR
- **THEN** the pushed image name is `ghcr.io/johnneon/mcp_gateway`
- **AND** one tag is `latest`
- **AND** the other tag is the first 7 characters of the commit SHA, expressed as a fixed length of 7 rather than a variable-length short revision
- **AND** the platform is `linux/amd64`
- **AND** the file does not mention `arm64`

### Requirement: Package visibility is public and repeatable

After the image push in the same job, the workflow SHALL set the user-owned container package `mcp_gateway` to visibility `public` through the GitHub packages API, authenticated with `GITHUB_TOKEN`. When the package is already public, that step SHALL succeed and SHALL NOT fail the job. The step SHALL NOT set visibility to `private`.

#### Scenario: Visibility step sets public and succeeds when already public

- **GIVEN** the publish workflow file
- **WHEN** the test reads the job steps in order without calling the GitHub API
- **THEN** a step that pushes the image comes before the step that changes package visibility
- **AND** the visibility step calls the packages API for container package `mcp_gateway` with visibility `public` using `GITHUB_TOKEN`
- **AND** the visibility step exits successfully when the current visibility is already `public`
- **AND** the visibility step does not request visibility `private`

### Requirement: README documents pull and run

The repository README SHALL document an anonymous `docker pull` of `ghcr.io/johnneon/mcp_gateway:latest` and a `docker run` of that image. The run instructions SHALL supply `ENCRYPTION_KEY`, publish MCP on port `3100`, publish the admin port on host loopback port `3200`, and mount a volume for the data directory. The README SHALL still document running through Compose by building the image locally.

#### Scenario: README shows the published image and the local compose build

- **GIVEN** the repository README
- **WHEN** the test reads that file without calling GHCR
- **THEN** it documents `docker pull` of `ghcr.io/johnneon/mcp_gateway:latest`
- **AND** it documents `docker run` with `ENCRYPTION_KEY`, port `3100`, loopback port `3200`, and a data volume
- **AND** it still documents `docker compose` building the image locally
