# Changelog

## v0.5.0

### Changed
- Bumped the application version to `0.5.0` while keeping the contract version at `0.3.5`.
  Reason/impact: captures the first full Midnight-native VC proof release in the app/backend stack without changing the deployed DID registry contract semantics.

### Added
- Added a separate Compact-based native ownership proof artifact and the corresponding proving/verification flow for VC ownership claims.
  Reason/impact: enables real Midnight ZK proof generation and cryptographic verification for the ownership VC path instead of relying only on preview proof envelopes.

- Added wallet-bound proof request approval, proof submission persistence, and reusable proof verification packages.
  Reason/impact: approved proofs now remain reusable artifacts, can be copied again without silently re-triggering the wallet, and only regenerate when explicitly requested.

- Added proof history and proof-management controls in the user/admin workflows, including approval/rejection history, queue handling, and persisted verification-package access.
  Reason/impact: makes proof lifecycle testing and review understandable from the UI and reduces stale/manual DB cleanup during operator testing.

- Added a formal DID and VC specification document with field tables and JSON examples.
  Reason/impact: documents the protocol surface more clearly for integrators, reviewers, and third-party verifiers.

### Fixed
- Fixed multiple native-proof generation failures across wallet key decoding, artifact resolution, proof-server fallback usage, and native-vs-preview verification rendering.
  Reason/impact: makes the wallet/cloud prover path actually usable for native cryptographic proof generation and removes misleading verification output in the registry UI.

- Fixed proof-request persistence and reuse so proof-ready entries default to reading stored proof submissions instead of regenerating them implicitly.
  Reason/impact: keeps previously generated proofs stable and avoids unnecessary wallet prompts when users only want to copy or inspect an existing proof.

## v0.4.5

### Changed
- Bumped the application version to `0.4.5` while keeping the contract version at `0.3.5`.
  Reason/impact: captures the latest app-only presentation update before refreshing README screenshots.

## v0.4.4

### Changed
- Bumped the application version to `0.4.4` while keeping the contract version at `0.3.5`.
  Reason/impact: captures the latest app-only MCP management fix without changing contract semantics.

### Fixed
- Fixed MCP key scope management so editing scopes updates the selected existing key instead of accidentally creating a duplicate key.
  Reason/impact: makes scope changes reliable, prevents silent key duplication, and keeps agent permissions aligned with the intended MCP key.

## v0.4.3

### Changed
- Bumped the application version to `0.4.3` while keeping the contract version at `0.3.5`.
  Reason/impact: captures the latest app-only workflow fix without changing contract semantics.

### Fixed
- Fixed the agent-submitted DID flow so the human owner registers the request on-chain at approval time, and admin issuance only performs the final on-chain issue step.
  Reason/impact: restores the intended separation of responsibilities and prevents admin issuance from failing on agent-submitted requests that were never registered on-chain by the owner.

## v0.4.2

### Changed
- Bumped the application version to `0.4.2` while keeping the contract version at `0.3.5`.
  Reason/impact: captures the current app/backend integration and security-posture documentation updates without changing contract semantics.

### Added
- Added an admin `Logs` view that shows live backend API and MCP HTTP logs side by side from the admin menu.
  Reason/impact: makes local testing and debugging easier without requiring direct terminal access while verifying runtime behavior.

### Documentation
- Added an explicit non-production warning to the README stating that this version is still not hardened and is intended for testing and debugging only.
  Reason/impact: makes the current security posture unambiguous and reduces the risk of accidental production use.

## v0.4.1

### Changed
- Bumped the application version to `0.4.1` while keeping the contract version at `0.3.5`.
  Reason/impact: captures the latest app-only UI and workflow changes without changing contract semantics.

## v0.4.0

### Changed
- Bumped the application version to `0.4.0` while keeping the contract version at `0.3.5`.
  Reason/impact: separates the UI/app release from the deployed contract version so contract semantics remain unchanged.

## v0.3.5

### Added
- Added customer-side MCP key revocation from the workflow UI and corresponding backend endpoint support.
  Reason/impact: lets human users immediately invalidate agent access without direct database intervention.

## v0.3.1

### Fixed
- Standardized app and contract version resolution to use `package.json` as the single tracked source of truth via `version` and `contractVersion`.
  Reason/impact: avoids CI build failures caused by missing local `.env` files and prevents version drift between local development and GitHub Actions.

## v0.3.0

### Changed
- Refactored the DID client layer into focused modules for contract runtime loading, private-state handling, vault management, ledger/state derivation, service sync, and cache management.
  Reason/impact: reduces coupling in the app logic, makes contract interactions easier to maintain, and keeps the current behavior stable while simplifying future changes.

- Introduced a session-based `DidRegistryAPI` for deploy, join, contract calls, and observable registry state handling.
  Reason/impact: centralizes contract access, removes repeated setup work across the UI, and gives the app a cleaner lifecycle for working with a selected registry.

- Moved the React app to consume registry session state and subscriptions instead of repeatedly re-fetching contract state imperatively.
  Reason/impact: improves UI consistency, reduces duplicated state-loading logic, and makes state refresh after on-chain actions more reliable.

### Added
- Added encrypted owner-vault backup and restore support around contract-scoped Midnight private state.
  Reason/impact: preserves issuer control recovery for deployed registries without exposing the owner secret on-chain.

- Added targeted tests for DID commitments, ledger derivation, server env loading, reconnect behavior, and idempotent issuance persistence.
  Reason/impact: increases coverage around the refactored paths and protects against regressions in the contract/session layer.

- Added server-side env loading for `.env`.
  Reason/impact: ensures the DID API consistently uses the configured database connection and service settings when started locally.

### Fixed
- Fixed wallet session recovery so reconnectable provider operations update the active wallet API instead of leaving parts of the app bound to a stale session.
  Reason/impact: avoids the intermittent “wallet disconnected” failures that appeared after idle time or when switching between user and admin flows.

- Fixed duplicate admin issuance finalization so on-chain DID issuance does not trigger a second failing finalize request.
  Reason/impact: removes the backend `500` during successful admin issuance and keeps the persistence path idempotent.

- Removed stale old-contract `Agent Smith` request data from the remote DID service database.
  Reason/impact: reduces false-positive join noise caused by obsolete records tied to a previous contract deployment.
