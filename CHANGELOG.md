# Changelog

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
