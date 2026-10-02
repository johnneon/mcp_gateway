# ghcr-image-publish Specification

## Purpose

Defines how the repository publishes the gateway container image to GHCR on a push to main, including the exact root package version tag, makes that package public, documents pull and run, and requires finish to bump that version. The contract is checked by reading files, without calling GHCR.

## Requirements

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

The publish workflow SHALL build the repository Dockerfile and push `ghcr.io/johnneon/mcp_gateway` for platform `linux/amd64` only. The pushed tags SHALL be `latest`, the first 7 hexadecimal characters of the commit SHA, and the exact `version` value from the root `package.json` of the commit being built. That version SHALL match MAJOR.MINOR.PATCH using digits only: no `v` prefix, no prerelease, and no build metadata. The workflow SHALL NOT push a tag that is only MAJOR or only MAJOR.MINOR. The workflow SHALL NOT target `linux/arm64` or any other platform. When the root `package.json` has no `version` field, or that field is not exactly three numeric components, the publish job SHALL fail and SHALL NOT invent a version tag.

#### Scenario: Workflow declares latest, a 7-character SHA, the package version, and amd64

- **GIVEN** the publish workflow file
- **WHEN** the test reads that file without calling GHCR
- **THEN** the pushed image name is `ghcr.io/johnneon/mcp_gateway`
- **AND** one tag is `latest`
- **AND** one tag is the first 7 characters of the commit SHA, expressed as a fixed length of 7 rather than a variable-length short revision
- **AND** one tag is the exact `version` field of the root `package.json` of the commit being built
- **AND** that version tag has no `v` prefix
- **AND** the file does not push a tag that is only MAJOR or only MAJOR.MINOR
- **AND** the platform is `linux/amd64`
- **AND** the file does not mention `arm64`

#### Scenario: Job fails when the package version is missing or not three numeric components

- **GIVEN** the publish workflow file
- **WHEN** the test reads that file without calling GHCR
- **THEN** the job reads the `version` field from the root `package.json` of the commit being built
- **AND** that read happens before the image push
- **AND** the job fails when that field is missing
- **AND** the job fails when that field is not exactly three numeric components
- **AND** the job does not write a replacement version when the field is missing or invalid

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

The repository README SHALL document an anonymous `docker pull` of `ghcr.io/johnneon/mcp_gateway:latest` and a `docker run` of that image. The README SHALL document the semver tag next to `latest` and the 7-character SHA: `ghcr.io/johnneon/mcp_gateway` plus the root `package.json` version, with no `v` prefix. The README SHALL NOT document a floating tag that is only MAJOR or only MAJOR.MINOR. The run instructions SHALL supply `ENCRYPTION_KEY`, publish MCP on port `3100`, publish the admin port on host loopback port `3200`, and mount a volume for the data directory. The README SHALL still document running through Compose by building the image locally.

#### Scenario: README shows the published image and the local compose build

- **GIVEN** the repository README
- **WHEN** the test reads that file without calling GHCR
- **THEN** it documents `docker pull` of `ghcr.io/johnneon/mcp_gateway:latest`
- **AND** it documents the semver tag of `ghcr.io/johnneon/mcp_gateway` next to `latest` and the 7-character SHA, with no `v` prefix
- **AND** it does not document a floating tag that is only MAJOR or only MAJOR.MINOR
- **AND** it documents `docker run` with `ENCRYPTION_KEY`, port `3100`, loopback port `3200`, and a data volume
- **AND** it still documents `docker compose` building the image locally

### Requirement: Finish bumps the root package version

`.cursor/skills/commits/SKILL.md`, the finish step of `docs/workflow.md`, and the finish list of `.cursor/agents/developer.md` SHALL require one `chore` commit that sets the root `package.json` `version`, after the archive commit and before push. That commit SHALL stay separate from the archive `docs` commit. Those files SHALL require: if the field is absent, set `0.1.0`; if the person named `major`, `minor`, or `patch` for the change, bump that component and reset lower components to `0`; otherwise bump `patch`. Those files SHALL require that propose and apply do not bump the version, and that a workspace `package.json` `version` is not added or changed. The commits skill and the developer finish list SHALL contain the same English sentence. The workflow finish step SHALL contain the Russian sentence that states that same rule.

#### Scenario: Finish instructions bump the root version before push

- **GIVEN** `.cursor/skills/commits/SKILL.md`, `docs/workflow.md`, and `.cursor/agents/developer.md`
- **WHEN** the test reads those files without calling GHCR
- **THEN** `.cursor/skills/commits/SKILL.md` and `.cursor/agents/developer.md` each contain the sentence `At finish, after the archive commit and before push, create one chore commit that sets the root package.json version. Keep that commit separate from the archive docs commit. If the version field is absent, set 0.1.0. If the person named major, minor, or patch for this change, bump that component and reset lower components to 0. Otherwise bump patch. Do not bump the version during propose or apply. Do not add or change version in a workspace package.json.`
- **AND** the finish step of `docs/workflow.md` contains the sentence `После коммита archive и до push — один отдельный коммит chore, который задаёт version в корневом package.json. Если поля нет, записать 0.1.0. Если человек для этого изменения назвал major, minor или patch, увеличить этот компонент и обнулить младшие до 0. Иначе увеличить patch. Во время propose и apply версию не менять. В package.json воркспейсов поле version не добавлять и не менять. Коммит archive (docs) остаётся отдельным.`
