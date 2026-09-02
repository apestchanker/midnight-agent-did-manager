# Changelog

## v0.9.3

### Fixed
- **`Balance failed: Insufficient funds for fallible segment` on gated actions, even with a freshly funded token color.** v0.9.2 changed `_buildCoin()` / `_buildAdminCoin()` to present the wallet's *full aggregate balance* for the color as the coin value. Verified against the Midnight wallet SDK source (`midnight-wallet` `balanceFallibleSection` / `Balancer.doBalance`) that the number after "fallible segment" is a **segment id, not an amount**, and that the balancer **combines multiple UTXOs** to cover a segment — it fails only when the wallet's *total* holdings of that color fall short. Passing the full balance therefore left **zero headroom**: any gap between `getShieldedBalances()` and what the balancer can actually source made every call fail. Reverted to presenting the circuit minimum (`value: 2n`); `consumeToken` / `consumeAdminToken` only require `>= 2` and the balancer covers the rest.
- **`_buildCoin()` now selects the verified color with the largest balance**, instead of the first one over the minimum, so an older near-depleted capability-token color is never chosen over a freshly funded one.
  Reason/impact: supersedes the "pass the full balance" half of the v0.9.2 fix. The stable-color-per-recipient fix from v0.9.2 is unchanged. See `sdd/features/005-coin-gated-admin-access/defect-log-2026-09-02.md` for the full evidence trail.

## v0.9.2

### Fixed
- **Capability-token top-ups no longer mint a new color every time.** `UnifiedRegistryAPI.mintTokens()` derived the `mint_capability_tokens` subscription key from `Date.now()`, so each grant to a recipient produced a fresh, separately-tracked token color instead of topping up their existing one. The key is now deterministic per `(recipient coin public key, contract address)`, with an explicit `rotation` opt-in for the rare case of deliberately moving a recipient onto a new color. `generateSubscriptionKey` and `grantSubscription` updated accordingly; the persisted `action_token_grants.subscription_key_hex` becomes an audit record rather than the source of truth for the color. Colors minted before this change stay valid and spendable but won't be topped up — mint one fresh batch on the new stable color.
- **Gated actions no longer fragment the wallet into unspendable 1-unit coins.** `_buildCoin()` / `_buildAdminCoin()` handed the circuit a synthetic coin with a hardcoded `value: 2n`; because `consumeToken`/`consumeAdminToken` return `value - 1` as a single change coin, every action collapsed the caller's balance to a 1-unit crumb, until the connected wallet's balancer could no longer source a `>= 2` input and failed with `Balance failed: Insufficient funds for fallible segment`. They now pass the wallet's real aggregate balance for the color, so the change comes back as one consolidated coin. First spend after upgrading still needs the wallet to combine any pre-existing fragments once.
  Reason/impact: both bugs are in the TypeScript layer of feature `005-coin-gated-admin-access`; the Compact contract is unchanged. See `sdd/features/005-coin-gated-admin-access/defect-log-2026-09-02.md`.

## v0.9.1

### Fixed
- Fixed a selected agent rendering with no DID whenever the connected wallet supplies an indexer endpoint the dApp's origin cannot reach. The indexer URL was taken solely from the wallet's `getConfiguration()`, and every contract read goes through the provider built from it, so one unreachable endpoint disabled all on-chain reads at once. `VITE_INDEXER_URI` now takes priority over the wallet's value when set, mirroring how `VITE_PROVER_SERVER_URI` already overrides the wallet's prover URL; both vars were already declared and populated but nothing read them.
  Reason/impact: 1AM's preprod build returns a pre-authenticated URL on `api-preprod.1am.xyz` that is currently answering `502 Bad Gateway`. The 502 carries no `Access-Control-Allow-Origin`, so the browser reported it as a CORS failure and the SDK surfaced `IndexerQueryError: Internal Server Error`; `UnifiedRegistryAPI.join()` then failed and no DID could be displayed. The app could not diagnose this on its own, because a CORS rejection reaches JavaScript as a bare network error indistinguishable from the chain having no record. **This fix is inert until `VITE_INDEXER_URI` is set in the deployment environment** — it is a build-time `VITE_` variable and needs a rebuild, not a restart.

## v0.9.0

### Fixed
- Fixed the DID directory rendering empty for a returning user opening an existing agent. `GET /api/registry/dids` is session-gated, but the effect that calls it keys off `contractAddress`, which `src/App.tsx` restores from `localStorage` at mount — long before a wallet is connected, and well before `login()` has completed its nonce -> sign -> session round trip. The call therefore fired unauthenticated, took a 401, and never retried, because its only other trigger was `didRecord.status` changing.
  Reason/impact: only affected users with a saved contract/agent in `localStorage` (i.e. anyone revisiting an agent they had already opened), which is why it presented as "existing agents can't show their DID" rather than as a general breakage. The session token is held in memory only (ADR-002), so every page load starts unauthenticated and this race was lost on every visit.
- Fixed the same premature-fetch race in the customer/request loader, which called `GET /api/customers/by-wallet` and `GET /api/did-requests` as soon as a wallet address existed, rather than once a session existed. This one self-healed via its 5-second poll, so it surfaced as recurring 401 noise in the console rather than as broken UI.
  Reason/impact: both loaders now route their guard through a single `canLoadSessionScopedData()` predicate in `src/lib/auth-session.ts` and list `authSession` as an effect dependency, which both suppresses the doomed call and supplies the retry that was missing.
- Fixed the API server exiting on an unhandled `'error'` event whenever Postgres terminated a connection while the server was idle (`docker stop` on the database, a managed-host failover, a server-side idle timeout). The `pg` Pool in `server/db.js` had no `'error'` listener, and node-postgres emits `'error'` on the Pool for failures on *idle* clients — an EventEmitter `'error'` with no listener throws, so the process died even though nothing was in flight and no request was affected.
  Reason/impact: reproduced and verified against a real database — the process now logs and stays up, and recovers on its own once the database returns, since the pool discards the broken client and dials a fresh one on the next query. The handler logs the error as message + code rather than as the object, because `pg` attaches the failed client (including its resolved connection parameters) to these errors and `console.error` is teed into the in-memory buffer that `/api/logs` serves.

## v0.8.8

### Fixed — BREAKING (contract)
- **Critical**: `admin_token_color` is no longer computed in the `did_registry` contract's constructor — it's now computed inside `register_initial_admin()`, the same circuit that actually mints the coin. Verified against two distinct real preprod deployments (different `registry_salt`, confirming genuinely different contracts) that `tokenType(adminDomainSep(), kernel.self())` evaluated inside the constructor produced the *same* color for both — `kernel.self()` was not behaving as a per-contract-unique identifier there, which broke the security model this was built on (the admin token was not actually bound to a specific contract deployment).
  Reason/impact: any contract deployed before this fix (including ones deployed earlier the same day) has the bug baked in on-chain and cannot be patched — redeploy required. This was a previously-flagged, never-confirmed-necessary open question from the original 005-coin-gated-admin-access technical spec.
- Split the "Deploy Unified Registry" UI action into two independent, separately-retryable steps: **Step 2 (Deploy)** only deploys the contract; the new **Step 3 (Initialize Admin)** mints the genesis admin token as its own transaction, any time after deploy, without needing to redeploy on failure.
  Reason/impact: the two transactions were previously chained in one function, so a failure in the second was indistinguishable from a failure in the first, making failures on remote (non-local) proof-server/indexer infra very difficult to diagnose.
- Fixed the deployed Static Site failing to serve the app's own custom circuit keys and the protocol's builtin proving keys (`midnight/zswap/{spend,output,sign}`, `midnight/dust/spend`), needed whenever a circuit calls `mintShieldedToken`. Root causes: (1) generated ZK artifacts for `register_initial_admin` were never committed for the Static Site build (only some of `keys/`/`zkir/` made earlier commits); (2) Render's CDN decodes `%2F` in URLs back to `/` before resolving static files, so a first attempt at serving the builtin keys under percent-encoded flat filenames 404'd — fixed by serving them from real nested directories instead.
- Fixed wallet connect losing the session when a wallet extension opens its approval prompt in a detached window instead of an anchored popup: removed a hardcoded 15-second timeout racing the connect call, which abandoned the connection attempt (even though the wallet would have resolved fine) whenever a human took longer than 15s to notice and approve a detached prompt.
- Fixed the wallet-selection dropdown reverting to the previously-connected wallet immediately after picking a different one: the wallet-detection effect had the selected wallet in its own dependency array, so choosing a new wallet re-triggered detection, which re-read the (stale) last-connected wallet from `localStorage` and overwrote the live selection.

## v0.8.7

### Changed
- Bumped `@midnight-ntwrk/ledger-v8` (`^8.0.3` → `^8.1.0`) and the eight `@midnight-ntwrk/midnight-js-*` packages (`^4.0.2`/`^4.0.4` → `^4.1.1`) to match the official Midnight support matrix after Mainnet aligned with Preprod's infrastructure versions (Node 1.0.0, Ledger 8.1.0, Indexer 4.3.3, Proof Server 8.1.0).
  Reason/impact: keeps the client SDK compatible with the infrastructure this project targets (preprod, and mainnet going forward). Verified non-breaking for this codebase against the official release notes before applying.
- Added `@midnight-ntwrk/midnight-js-types` as an explicit direct dependency (`^4.1.1`); it was previously an undeclared transitive dependency resolving inconsistently across the lockfile.
- Updated the local `start-proof-server` script's Docker tag to `midnightntwrk/proof-server:8.1.0` (confirmed published before applying).

### Fixed
- Fixed a stale-deployment display bug: the "last deployed contract" cache (`src/lib/did/cache.ts`, and the `LAST_CONTRACT_KEY`/`LAST_AGENT_KEY`/`LAST_AGENT_SELECTION_KEY` keys in `src/App.tsx`) was not scoped by network, so a contract deployed while connected to one network (e.g. preview) would incorrectly be shown as already deployed after switching networks (e.g. preprod).
  Reason/impact: found during the pre-deploy manual smoke test — surfaced as a misleading "Deployment confirmed on-chain" banner for a contract that was never deployed on the currently-connected network.
- Split the DID registry's genesis admin-token bootstrap from one atomic constructor call into two separate transactions (deploy, then `register_initial_admin()`), per an explicit, documented project-owner decision (see `sdd/wip/005-coin-gated-admin-access/decision-log-2026-07-21.md` and the extensive inline comments in `contracts/did_registry.compact.template`). The root of trust remains coin-based, not `ownPublicKey()`-based — only the atomicity with deployment was removed, after it was found to interfere with wallet-side transaction balancing during live preprod testing. The project owner explicitly accepted the resulting bootstrap race-condition risk.

## v0.8.6

### Changed
- Bumped the application version to `0.8.6` while keeping the contract version at `3.0.0`.
  Reason/impact: closes SEC-02 from the 2026-07-09 security audit before the first public deployment.

### Fixed
- Replaced the shared, build-time-embedded `DID_API_AUTH_TOKEN` with a wallet nonce + signature challenge-response session mechanism, used identically for regular users and administrators (admin status is a server-side wallet-address comparison, not a separate code path).
  Reason/impact: the old token was baked into the public frontend bundle by design, so publishing the site for the investor demo would have handed anyone the master credential for every private REST route (approve/reject requests, admin issuance, wallet-state sync). The new flow proves wallet possession via the same `verifySignature`/`addressFromKey` primitive already used for holder-signature verification, issues short-lived opaque sessions (hashed server-side, revocable), and ties every previously client-declared `humanWalletAddress`/`adminWalletAddress`/`issuerWalletAddress`/`deployerWalletAddress` to the authenticated session instead.
- Added rate limiting (per-wallet+IP and per-IP) to `POST /api/auth/nonce`, and per-IP rate limiting to `POST /api/auth/session`, closing an unauthenticated-flood and a signature-verification CPU-amplification vector respectively.
- Added audit logging (`auth_session_created` / `auth_session_denied`) for every login attempt, success or failure, without persisting any signature or token material.

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
