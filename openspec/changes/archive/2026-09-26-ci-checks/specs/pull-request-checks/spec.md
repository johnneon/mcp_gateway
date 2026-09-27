# Spec Delta

## Purpose

Defines the repository contract for checks before a merge into `main`: the GitHub Actions workflow contents, ESLint rejecting explicit `any`, and Prettier `format:check` behavior — all verifiable locally without calling the GitHub API.

## ADDED Requirements

### Requirement: Workflow on pull_request into main

The repository SHALL contain a GitHub Actions workflow file that runs on the `pull_request` event targeting `main`. The job SHALL use Node.js 22. After installing dependencies, the job SHALL run the root scripts `typecheck`, `lint`, `format:check`, `test`, and `build` (in any order agreed in the design). The workflow file SHALL live under `.github/workflows/`.

#### Scenario: Workflow declares Node 22 and every check

- **GIVEN** the repository has a workflow file under `.github/workflows/` for a pull request into `main`
- **WHEN** the test reads that file (without calling the GitHub API)
- **THEN** the trigger includes `pull_request` to the branch `main`
- **AND** the job specifies Node.js version `22`
- **AND** the steps include running the root scripts `typecheck`, `lint`, `format:check`, `test`, and `build`

### Requirement: ESLint rejects explicit any in server and web

The root ESLint configuration SHALL treat `@typescript-eslint/no-explicit-any` as an error for sources and tests under `server/` and under `web/`. Running ESLint (CLI or API) on a TypeScript snippet with an explicit `any` type SHALL fail on that rule. An escape hatch that disables the `any` ban for the whole project or for tests by default SHALL NOT be part of the configuration.

#### Scenario: Explicit any in a server snippet is an error

- **GIVEN** the project's root ESLint configuration is loaded
- **WHEN** ESLint checks a temporary TypeScript snippet with a path like `server/` (for example under `server/`) and an explicit `any` type
- **THEN** the result contains an error for the rule `@typescript-eslint/no-explicit-any`
- **AND** the check's exit code is non-zero (or the API reports failure)

#### Scenario: Explicit any in a web snippet is an error

- **GIVEN** the project's root ESLint configuration is loaded
- **WHEN** ESLint checks a temporary TypeScript snippet with a path like `web/` (for example under `web/`) and an explicit `any` type
- **THEN** the result contains an error for the rule `@typescript-eslint/no-explicit-any`
- **AND** the check's exit code is non-zero (or the API reports failure)

### Requirement: format:check distinguishes a broken snippet from a formatted one

The root script `format:check` SHALL exit non-zero on a TypeScript snippet (or another file type Prettier includes under `server/` / `web/`) that breaks the project's Prettier rules, and SHALL exit zero on the same snippet after it is formatted with those rules. The check SHALL run locally through Prettier or the npm script, without calling GitHub.

#### Scenario: format:check fails on a broken snippet

- **GIVEN** a temp directory on a path the project's Prettier covers (for example under `server/` or `web/`) contains a file with intentionally broken formatting
- **WHEN** the root `format:check` runs (or the equivalent Prettier check with the project config) on that snippet
- **THEN** the exit code is non-zero

#### Scenario: format:check passes on a formatted snippet

- **GIVEN** the same snippet has been formatted with the project's Prettier rules (for example via `format` or Prettier write)
- **WHEN** `format:check` (or the equivalent Prettier check) runs again on that snippet
- **THEN** the exit code is zero
