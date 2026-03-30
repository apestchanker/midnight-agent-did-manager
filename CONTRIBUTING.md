# Contributing

## Scope

Contributions are welcome for:

- DID registry contract improvements
- Midnight SDK integration fixes
- API and persistence improvements
- UI and workflow improvements
- DID / VC interoperability work
- documentation and developer tooling

Keep changes focused. Do not mix unrelated refactors, formatting churn, and feature work in the same pull request.

## Before Opening a Pull Request

Every pull request is expected to:

1. compile successfully
2. include verification for the changed area
3. avoid unrelated file changes
4. update documentation when behavior, configuration, or workflow changes

## Required Checks

At minimum, contributors must run:

```bash
npm test
npm run build
```

When the change affects Compact contracts or managed artifacts, also run:

```bash
npm run compile-contract
npm run doctor:preprod
```

When the change affects the local DID service or database workflow, verify the API against a running Postgres instance and document the manual checks performed.

## Tests

This repository includes an automated test suite via Vitest.

Contributors must run all relevant validation steps for their change and report them in the PR:

- `npm test`
- `npm run build`
- `npm run compile-contract` when contract/runtime changes are involved
- `npm run doctor:preprod` when Midnight environment assumptions are involved
- manual workflow verification for UI, API, DB, or wallet integration changes

Current automated tests cover:

- `tests/server-utils.test.ts`
  - server utility helpers
  - DID derivation helpers
  - HTTP response/request helpers
- `tests/explorer.test.ts`
  - explorer URL generation
- `tests/vc-service.test.ts`
  - VC verification
  - presentation validation
  - holder/subject mismatch rejection

If you add or modify behavior in a core module, extend or update the automated tests in the same PR when feasible.

## Pull Request Guidelines

Each PR should include:

- a short problem statement
- the exact change made
- risks or behavioral tradeoffs
- verification performed
- screenshots for UI changes when relevant

Recommended PR template content:

```text
Summary
- What problem does this change solve?

Changes
- What was changed?

Verification
- npm test
- npm run build
- other commands run
- manual checks performed

Risks
- any behavior that needs careful review
```

## Change Complexity

Prefer small and reviewable pull requests.

Guidelines:

- small PR: one bug fix or one focused UI/API change
- medium PR: one coherent feature across a few modules
- large PR: contract + API + UI + persistence changes together

Large PRs are allowed only when the work is tightly coupled and cannot be split cleanly.
If a change is large, explain why it was not separated.

## Contract and Midnight Changes

For changes touching:

- `contracts/`
- `contracts/managed/`
- `public/contracts/managed/`
- `src/generated/`
- Midnight provider setup

the PR must clearly state:

- whether the Compact source changed
- whether managed artifacts were regenerated
- whether the frontend/runtime interface changed
- what was tested on-chain or in preprod tooling

## Database Changes

For changes touching:

- `server/schema.sql`
- `server/db.js`
- `server/registry-service.js`

the PR must state:

- whether schema changes are backward compatible
- whether existing data needs migration or repair
- how the new behavior was verified against Postgres

## Documentation

If your change affects:

- environment variables
- API endpoints
- deployment steps
- wallet behavior
- DID / VC workflow

update the relevant docs in the same PR.

## Code Quality Expectations

Contributors should:

- keep naming clear and consistent
- avoid dead code and unused files
- avoid placeholder comments left without implementation
- preserve existing behavior unless the PR explicitly changes it
- prefer straightforward implementations over clever abstractions
- add or update tests when changing stable business logic or shared utilities

## Security and Privacy

Do not commit:

- real secrets
- private keys
- production wallet credentials
- `.env`
- local-only debugging notes
- generated local logs

Follow `.gitignore` and keep local-only material outside the published repo surface.
