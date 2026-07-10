# Proposal: Coin-Gated Admin Access — Eliminate Forgeable ownPublicKey() Authorization

## Intent

`contracts/did_registry.compact` currently gates ADMIN/ISSUER operations (`mint_capability_tokens`, `issue_did`, `grant_role`, `revoke_role`, `revoke_did`, and the bootstrap `register_initial_admin`) using `ownPublicKey()` role checks. Source-code inspection of the Compact compiler/runtime/ledger plus an empirical PoC confirmed `ownPublicKey()` is not cryptographically bound to the actual transaction signer — it is forgeable, meaning any caller can potentially claim ADMIN authority. This is a confirmed access-control vulnerability in a live contract, not a hardening request. The fix replaces `ownPublicKey()`-based role checks with authorization rooted entirely in shielded-coin possession and consumption, per the user's explicit and non-negotiable constraint of zero long-lived-secret-based authentication.

## Scope

### In Scope
- `contracts/did_registry.compact.template`: constructor mints the genesis admin token atomically (removes the two-step `register_initial_admin()` bootstrap gated only by `ownPublicKey()`).
- New `consumeAdminToken()` helper replacing `assertRole(adminRole())` in `mint_capability_tokens`, `issue_did`, `grant_role`, `revoke_role`, `revoke_did`.
- Elimination of the ISSUER role, merged into ADMIN (`issue_did`'s inline `is_admin || is_issuer` check collapses to a single admin-token consumption check).
- New `rotate_admin_tokens` circuit for atomic per-holder burn-and-remint (replenishment/delegation), explicitly not a "global supply reaches zero" model.
- `request_update_did` gains an `coin.color == did_token_color.lookup(did_key)` assert.
- `scripts/compile-contract.js`: update the `CIRCUITS` list (add `rotate_admin_tokens`; remove `register_initial_admin` if the bootstrap circuit is eliminated).
- `src/lib/registry/unified-registry-api.ts`: update `deploy()` (constructor call, ~line 110-118) and any methods calling removed/changed circuits (`registerInitialAdmin`, `grantRole`, `revokeRole`, `revokeDid`, `issueDid`) to match the new contract interface.
- `README.md`: rewrite "On-chain" section (lines ~203-244) to reflect the actual unified v3 contract and new coin-gated admin model; rewrite/remove "Controller Model (v2)" (~472-484) and "Token Gating (v0.8)" (~486-544) as they document pre-unification architecture; remove the residual "owner witness secret" mention (line ~315) which contradicts the zero-secret constraint; add a v3.0.0-equivalent Release Notes entry documenting this security fix; correct the Contract Directory Notes (~905-921) that still list `contracts/token_gating.compact` as active when it is archived.
- `tests/unified-registry.test.ts`: update to exercise the new constructor/circuit signatures (genesis mint, `consumeAdminToken`, `rotate_admin_tokens`, ISSUER removal, color-check assert).
- Delete `src/lib/did/api.ts` (orphaned `DidRegistryAPI` class; its `self_register_did` circuit call and two-step `register_initial_admin()` bootstrap are exactly the forgeable-`ownPublicKey()` pattern this feature replaces, and the class has no live callers once the items below are updated).
- In `src/lib/did/app-api.ts`: remove `deployDidRegistry`, `updateDidOrchestrated`, `revokeDidOrchestrated` (the only three functions typed directly against `DidRegistryAPI`). As a mechanical follow-on required once `api.ts` is deleted: drop the now-dead `import { DidRegistryAPI } from "./api"` and narrow `type AnyRegistryAPI = DidRegistryAPI | UnifiedRegistryAPI` to `UnifiedRegistryAPI` only. Keep `compileDidRegistry`, `deployUnifiedRegistry`, `requestDidWithSync`, `issueDidWithSync`, `updateDidWithSync`, `revokeDidWithSync`, `getTokenBalance`, and the `mergeDidMetadata`/`syncWallet*Storage` sync helpers they call — all confirmed live (used directly by `src/App.tsx` and `src/hooks/useDeployFlow.ts`).
- Delete `src/lib/didContract.ts` in full. Grep verification (per this agent's mandate) found it *is* imported by two live files — `src/App.tsx` (`getSavedContractAddress`, `getSavedDeployment`) and `src/components/OwnerVaultPanel.tsx` (`getOwnerVaultStatus`) — but all three are pure pass-through re-exports of `./lib/did/cache` and `./lib/did/vault`, unrelated to the `DidRegistryAPI` flow being removed. Repoint those two call sites to import directly from `./lib/did/cache` / `./lib/did/vault` (and `../types/did` for the `OwnerVaultStatus` type). Every *other* export of `didContract.ts` (the `DidRegistryAPI` re-export, `deployDidRegistry`, `requestDid`, `issueDid`, `updateDid`, `revokeDid`, `fetchDidRecord`, `fetchRegistrySummary`, `fetchRegistryAccess`) has zero live callers today and would break at compile time the moment `api.ts` is removed if the file were left in place.
- Delete the 5 pre-unification test files: `src/tests/did-registry-gated.test.ts`, `token-gating.test.ts`, `token-gating-integration.test.ts`, `token-subscription.test.ts`, `token-api-layer.test.ts`. They exercise `self_register_did`/`register_initial_admin`/`ownPublicKey()` behavior that no longer exists post-unification; not rewritten to cover the current architecture, per explicit user decision.

### Out of Scope
- Any UI/UX changes to token-gating panels beyond what's strictly required to keep `unified-registry-api.ts` callers compiling against the new contract interface, and the two mechanical import-path fixes in `src/App.tsx` / `src/components/OwnerVaultPanel.tsx` noted above.
- Multi-admin governance features (quorum, timelocks) beyond the single-holder `rotate_admin_tokens` delegation primitive.

## Approach

Move authorization from an identity check (`ownPublicKey()` compared against a stored role) to a possession-and-consumption check (a shielded coin of a designated admin color must be presented and burned/re-minted within the same transaction). The constructor becomes the sole point where trust is bootstrapped: it atomically mints the genesis admin coin, closing the current window where `register_initial_admin()` is a separate, `ownPublicKey()`-gated transaction. `consumeAdminToken()` centralizes the new check so all five admin-gated circuits share one audited code path instead of five inline variants. `rotate_admin_tokens` gives admins a way to replace a compromised/lost token or delegate admin capability without ever risking permanent lockout, by making burn-and-remint atomic per holder rather than dependent on global supply reaching zero. This is consistent with the existing `consumeToken(coin)` pattern already used for non-admin gated circuits (`gated_self_register_did`, `request_update_did`) in the current contract — it extends the same mechanism to admin-tier operations instead of introducing a new paradigm. Since the vulnerable `ownPublicKey()` pattern being eliminated on-chain is the *same* pattern the orphaned `src/lib/did/api.ts`/`register_initial_admin` client code exercises, this iteration removes that client-side dead code and its now-obsolete tests in the same pass rather than leaving a second, unreachable copy of the vulnerability's call path lying around.

## Affected Areas

| Area | Impact | Description |
|------|--------|--------------|
| `contracts/did_registry.compact.template` | Modified | Constructor mints genesis admin token; `consumeAdminToken()` added; ISSUER role removed/merged into ADMIN; `rotate_admin_tokens` circuit added; `request_update_did` gains color assert |
| `contracts/did_registry.compact` (generated) | Modified (regenerated) | Output of `scripts/compile-contract.js` from the updated template — not hand-edited |
| `scripts/compile-contract.js` | Modified | `CIRCUITS` list (lines ~33-41) updated to match new/removed circuits |
| `src/lib/registry/unified-registry-api.ts` | Modified | `deploy()` (~110-118) and role/admin methods (`registerInitialAdmin` ~215, `grantRole` ~347, `revokeRole` ~362, `revokeDid` ~460, `issueDid` ~514) updated for new constructor/circuit signatures |
| `tests/unified-registry.test.ts` | Modified | Updated to cover genesis mint, `consumeAdminToken`, `rotate_admin_tokens`, ISSUER removal, color-check assert |
| `README.md` | Modified | "On-chain" (203-244), "Controller Model (v2)" (472-484), "Token Gating (v0.8)" (486-544), Release Notes (373-406), Contract Directory Notes (905-921), and removal of "owner witness secret" mention (315) |
| `src/lib/did/api.ts` | Removed | Orphaned `DidRegistryAPI` class deleted entirely; its remaining callers (`app-api.ts`, `didContract.ts`, the 5 legacy tests) are all updated or removed in this same change |
| `src/lib/did/app-api.ts` | Modified | Remove `deployDidRegistry`, `updateDidOrchestrated`, `revokeDidOrchestrated`; drop the dead `DidRegistryAPI` import; narrow `type AnyRegistryAPI` to `UnifiedRegistryAPI` only. Keep `compileDidRegistry`, `deployUnifiedRegistry`, `requestDidWithSync`, `issueDidWithSync`, `updateDidWithSync`, `revokeDidWithSync`, `getTokenBalance` (all confirmed live) |
| `src/lib/didContract.ts` | Removed | Deleted in full; its 3 live re-exports (`getSavedContractAddress`, `getSavedDeployment`, `getOwnerVaultStatus`) are pass-throughs of `./did/cache`/`./did/vault` with no dependency on the deleted `DidRegistryAPI` flow |
| `src/App.tsx` | Modified | Import `getSavedContractAddress`/`getSavedDeployment` from `./lib/did/cache` instead of the deleted `./lib/didContract` |
| `src/components/OwnerVaultPanel.tsx` | Modified | Import `getOwnerVaultStatus`/`OwnerVaultStatus` from `./lib/did/vault` (and `../types/did`) instead of the deleted `../lib/didContract` |
| `src/tests/did-registry-gated.test.ts`, `token-gating.test.ts`, `token-gating-integration.test.ts`, `token-subscription.test.ts`, `token-api-layer.test.ts` | Removed | Pre-unification tests exercising the `self_register_did`/`register_initial_admin`/`ownPublicKey()` architecture being eliminated; deleted rather than rewritten, per explicit user decision — see Risks |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Genesis admin token could be minted to the wrong recipient or lost immediately after deploy, causing permanent lockout before `rotate_admin_tokens` is ever usable | Low | Constructor mints directly to the deployer's own coin public key in the same transaction as deployment; deploy flow in `unified-registry-api.ts` must confirm mint success before reporting deploy complete; technical spec must define an explicit break-glass/redeploy procedure for this edge case |
| Removing ISSUER and merging into ADMIN changes the authorization surface for `issue_did` — any caller previously relying on an ISSUER-only (non-ADMIN) identity loses access | Medium | No current production deployment has non-admin ISSUER holders per exploration report (feature is not yet deployed to a live network with real users); document the merge explicitly in Release Notes as a breaking change |
| `rotate_admin_tokens` burn-then-remint must be atomic — a partial failure (burn succeeds, remint fails) could destroy the only admin token in circulation | Medium | Technical spec must specify this as a single circuit with both operations in the same transaction (not two sequential calls), consistent with Compact's guaranteed-phase atomicity; must be covered by an explicit test case for the failure path |
| README rewrite is extensive (5 sections) and could drift from the final contract shape if written before implementation stabilizes | Low | README updates happen last, in the same PR, after the technical spec and implementation are finalized — not drafted speculatively against the proposal alone |
| Deleting `src/lib/did/api.ts` and `src/lib/didContract.ts` touches a small dependency chain (`app-api.ts`'s `AnyRegistryAPI` type + import, and the two import-path fixes in `App.tsx`/`OwnerVaultPanel.tsx`) — missing any one reference breaks the TypeScript build rather than failing silently | Low | Mechanical, fully grep-verified in the proposal (no other callers found beyond those listed in Affected Areas); `npm run build` is a Success Criterion and will catch any missed reference immediately |
| Deleting the 5 pre-unification test files removes their test cases outright rather than porting them forward, so raw test-file count and assertion count drop | Low | Not a real coverage loss: those files exercised `self_register_did`/`register_initial_admin`/`ownPublicKey()` behavior that no longer exists in the current v3 contract (confirmed pre-orphaned per exploration report). Going forward, `tests/unified-registry.test.ts` (already in scope, updated for the new constructor/circuit signatures) is the intended coverage for these code paths — if its coverage of admin-token flows turns out thin once written, that's a technical-spec/build-phase concern, not a reason to keep the deleted files |

## Rollback Plan

This is a pre-mainnet, pre-production contract change (per exploration report, no live deployment with real user funds was found). Rollback is a straightforward `git revert` of the PR: no on-chain migration, no data backfill, and no live admin tokens to reconcile, since the vulnerable `register_initial_admin()`/`ownPublicKey()` flow being replaced has not been exercised against a persistent production ledger. If a devnet/testnet deployment exists at merge time, redeploy the reverted contract to a fresh address rather than attempting in-place migration — shielded-coin state under the old and new authorization models is not compatible.

## Dependencies

- Ninguna dependencia externa.

## Success Criteria

- [ ] Constructor mints the genesis admin token atomically; no separate `ownPublicKey()`-gated bootstrap transaction exists.
- [ ] `consumeAdminToken()` is the sole authorization path for `mint_capability_tokens`, `issue_did`, `grant_role`, `revoke_role`, `revoke_did` — no remaining `assertRole(adminRole())` or `ownPublicKey()`-based identity check on these circuits.
- [ ] ISSUER role is fully removed from the contract; `issue_did` requires only admin-token consumption.
- [ ] `rotate_admin_tokens` performs an atomic burn-and-remint for a single holder in one transaction, with a passing test for both the success path and the atomic-failure path.
- [ ] `request_update_did` rejects a coin whose `color` does not match `did_token_color.lookup(did_key)`.
- [ ] `npm test` and `npm run build` pass for all in-scope files (`tests/unified-registry.test.ts`, `unified-registry-api.ts`, `compile-contract.js`).
- [ ] README's On-chain, Controller Model (v2), Token Gating (v0.8), Release Notes, and Contract Directory Notes sections accurately describe the shipped contract, with zero remaining references to witness-secret-based ownership.
- [ ] Legacy orphaned code (`src/lib/did/api.ts` and unused `app-api.ts` exports) and the 5 pre-unification test files are deleted; `npm run build` and `npm test` pass with zero references to the removed files.
