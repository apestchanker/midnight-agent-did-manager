# Changelog

## v0.8.5

### Changed
- Bumped the application version to `0.8.5` while keeping the contract version at `3.0.0`.
  Reason/impact: marks the first release intended for a public online deployment (Render + Supabase), as opposed to local-only development.

### Fixed
- The API and MCP HTTP servers now honor the platform-assigned `PORT` environment variable ahead of the local-only `DID_API_PORT`/`DID_MCP_PORT` defaults.
  Reason/impact: PaaS hosts like Render assign a dynamic port at runtime; without this, the deployed service would never receive traffic.
- The Postgres connection pool now enables TLS automatically when the connection target is a managed Supabase host, while leaving local/LAN Postgres connections untouched.
  Reason/impact: Supabase requires TLS on external connections; forcing it unconditionally would have broken existing local development against a non-TLS Postgres instance.
- The issuer signing keypair can now be pinned via the `DID_ISSUER_JWK_JSON` environment variable instead of always being generated on first use and persisted to the local filesystem.
  Reason/impact: hosts with an ephemeral filesystem (e.g. Render's free tier) wipe local files on every redeploy or spin-down/spin-up cycle, which would silently rotate the issuer key and invalidate previously issued credentials.

## v0.5.2

### Changed
- Bumped the application version to `0.5.2` while keeping the contract version at `0.3.5`.
  Reason/impact: consolidates the first public GitHub release milestone after the ZK proof and VP unification work, adding conceptual documentation that makes the W3C design decisions legible to new contributors and ecosystem reviewers.

### Added
- Added five conceptual "why" explanations across the documentation suite covering: (1) why W3C DID/VC standards were chosen over a custom scheme, (2) why credentials are issued as atomic units to enable selective disclosure, (3) why verifiers can validate credentials without contacting the issuer at runtime, (4) why holder binding is needed to prevent credential theft and replay, and (5) the Holder/Issuer/Verifier trust triangle and why the issuer is not in the runtime critical path.
  Reason/impact: the existing docs accurately described the implementation but left the design rationale implicit. A reader without prior W3C background could follow the what but not the why. These additions make the codebase useful as a reference and as a contribution target for the broader Midnight ecosystem, including the MAIS MIP review.

## v0.5.1

### Changed
- Bumped the application version to `0.5.1` while keeping the contract version at `0.3.5`.
  Reason/impact: captures the verification-precision follow-up after the initial `0.5.0` native-proof milestone.

### Fixed
- Refined registry-proof verification labels, documentation, and release semantics so native proof validation is described exactly as implemented.
  Reason/impact: avoids overstating guarantees, distinguishes native statement/circuit checks from canonical external proof-blob verification, and keeps the UI/spec/README aligned with the actual backend behavior.

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
  Reason/impact: marks the first end-to-end functional milestone of the managed DID console before the later native-proof work introduced in `0.5.0`.

### Added
- Completed the DID request workflow for both human-initiated and agent-initiated creation paths, including the human approval stage required before registry issuance.
  Reason/impact: establishes the full managed-agent DID lifecycle from request intake through owner approval and final registry issuance.

- Added basic verifiable credential issuance for issued DIDs.
  Reason/impact: gives each active DID an initial VC layer that can already be consumed, inspected, bundled, and verified as part of the managed identity flow.

- Added the MCP server surface with discovery-ready docs, tools, and endpoints for agent integration.
  Reason/impact: allows external agents to discover capabilities automatically and interact with DID and VC workflows through a documented MCP interface instead of requiring custom integration glue.

- Completed the backend and UI application surfaces needed to operate the system locally.
  Reason/impact: made the product usable as a real working stack rather than just a contract or API prototype, including wallet connect, customer/account flow, DID management, approvals, and registry-facing views.

- Added the Compact DID registry contract and its operational circuits for DID registration, update, and revocation.
  Reason/impact: provides the Midnight contract foundation that anchors DID lifecycle state on-chain and supports the core managed-registry semantics.

- Added the basic DID registry view and directory behavior in the app.
  Reason/impact: gives operators and verifiers a simple registry-facing surface to inspect active DID records instead of relying only on backend queries or raw contract state.

### Release Summary
- `v0.4.5` is the milestone where the project became a complete working DID manager across contract, backend, MCP, and UI layers.
- At this point, DIDs could be requested by either humans or agents, routed through human control and approval, issued into the Midnight-backed registry, and then enriched with basic JWT VC issuance.
- The release also established the first usable registry UX and the first discovery-ready MCP integration surface, making the stack testable both by people through the dashboard and by agents through MCP.

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
