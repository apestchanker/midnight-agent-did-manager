# Functional Spec: Coin-Gated Admin Access — Eliminate Forgeable ownPublicKey() Authorization

**Feature**: 005-coin-gated-admin-access
**Version**: 1.0
**Status**: Draft
**Date**: 2026-07-09

## Overview

This feature replaces the DID registry's administrative authorization model with one rooted entirely in the possession and consumption of a shielded coin. Today, administrative operations — minting capability tokens, issuing DIDs, granting or revoking roles, and revoking DIDs — are protected only by a check of the caller's public key, and that check is not cryptographically bound to the actual transaction signer. Any caller can potentially forge admin authority. Going forward, every administrative action requires the caller to present and spend (consume) a specific admin token in the same transaction as the action; there is no fallback to identity checks, passwords, witness secrets, or any other long-lived secret.

At deployment, the registry mints exactly one genesis admin token directly to the deploying party, closing the current window where a separate, forgeable transaction is needed to claim admin status after deployment. An admin can rotate (replace) their admin token in a single atomic operation, so a lost or compromised token can be replaced without the registry ever passing through a state in which zero valid admin tokens exist. The separate ISSUER role is eliminated outright: any operation that previously accepted ISSUER-only authority now requires ADMIN admin-token possession and consumption only. End users updating their own DID must present the token specifically linked to that DID's color, so an unrelated token cannot be used to authorize someone else's DID update.

This iteration also removes the legacy client-side code paths and pre-unification tests that exercised the old, vulnerable identity-based bootstrap flow, so that after this change the codebase has exactly one authorization mechanism for admin operations, exercised end to end, with no orphaned copy of the vulnerable pattern left reachable or referenced anywhere in the build.

## Actors

| Actor | Description |
|-------|-------------|
| End User (DID holder) | A party who holds a DID and the shielded token linked to that specific DID. Interacts with the registry to request, update, or otherwise manage their own DID. |
| Admin (admin token holder) | A party who possesses a valid admin token. Performs privileged registry operations — minting capability tokens, issuing DIDs, granting/revoking roles, revoking DIDs — and may rotate (replace) the admin token itself. |
| Registry Contract | The on-chain registry that enforces authorization by requiring consumption of a specific shielded token (the admin token, or a DID-linked token) rather than any identity- or secret-based check. |

## Requirements

### REQ-01: Genesis Admin Token Minted at Deployment

The registry contract MUST mint exactly one admin token to the deploying party atomically, within the same transaction that deploys the contract. No separate operation to claim, register, or bootstrap initial admin status SHALL exist or be required after deployment.

#### Scenarios

**Scenario 01: Deployment mints the genesis admin token**
```
Given the registry contract has not yet been deployed
When a deployer deploys the registry contract
Then the deployment transaction completes and the deployer holds exactly one admin token as a direct result of that same transaction, with no further action required to obtain admin authority
```

**Scenario 02: No separate bootstrap operation exists**
```
Given the registry contract has been deployed
When any party inspects or attempts to invoke a "claim admin" or "register initial admin" style operation on the registry
Then no such operation is available, and the admin token minted at deployment remains the only source of initial admin authority
```

### REQ-02: Admin-Token-Gated Registry Operations

Minting capability tokens, issuing a DID, granting a role, revoking a role, and revoking a DID each MUST require the caller to present and consume (spend) a valid admin token within the same transaction as the operation. No check based on the caller's identity or public key, alone or combined with any other check, SHALL be sufficient to authorize these operations.

#### Scenarios

**Scenario 01: Admin performs a privileged operation by consuming the admin token**
```
Given a party holds a valid admin token
When that party invokes an admin-gated operation (minting capability tokens, issuing a DID, granting a role, revoking a role, or revoking a DID) and presents the admin token
Then the operation succeeds and the admin token is consumed as part of the same transaction
```

**Scenario 02: Operation rejected without a valid admin token**
```
Given a party does not hold a valid admin token
When that party attempts to invoke an admin-gated operation, regardless of which public key they present
Then the operation is rejected and no registry state changes as a result
```

### REQ-03: Removal of the ISSUER Role

The registry SHALL NOT support an ISSUER role distinct from ADMIN. DID issuance MUST require only admin-token possession and consumption; no separate ISSUER-identity check SHALL exist anywhere in the registry.

#### Scenarios

**Scenario 01: DID issuance requires only the admin token**
```
Given a party holds a valid admin token
When that party issues a DID
Then the DID is issued successfully based solely on admin-token consumption, with no separate ISSUER-role check performed
```

**Scenario 02: A former ISSUER-only party can no longer issue DIDs (breaking change)**
```
Given a party held only ISSUER-level authority under the previous role model and does not hold an admin token
When that party attempts to issue a DID
Then the operation is rejected, because ISSUER-only authority no longer exists as an authorization path in the registry
```

### REQ-04: Atomic Admin Token Rotation and Delegation

The registry MUST provide an operation that lets a current admin-token holder replace their admin token by burning the presented token and minting a new one to a chosen recipient (themselves or another party) atomically, within a single transaction. If any part of that operation fails, the entire operation MUST fail as a unit — there SHALL be no intermediate state in which the old token has been burned but no valid admin token has been minted.

#### Scenarios

**Scenario 01: Successful rotation replaces the admin token atomically**
```
Given an admin holds a valid admin token
When that admin rotates the token, presenting the current token and designating a recipient for the replacement
Then the old admin token is burned and a new admin token is minted to the designated recipient within the same transaction, and immediately afterward exactly one valid admin token exists for that holder position
```

**Scenario 02: A failed rotation leaves no orphaned or lost admin token**
```
Given an admin initiates a token rotation
When any part of the rotation (the burn or the mint) cannot complete
Then the entire rotation is rejected as a whole, the original admin token remains valid and unconsumed, and at no point does the registry pass through a state with zero valid admin tokens for that holder
```

### REQ-05: DID Update Requires the DID's Own Linked Token

Requesting an update to a DID MUST require the caller to present a token whose color matches the token color linked to that specific DID. An update presented with a token of any other color MUST be rejected.

#### Scenarios

**Scenario 01: Update succeeds with the DID's own linked token**
```
Given a DID holder holds the token whose color matches the color linked to their specific DID
When that holder requests an update to their DID, presenting that token
Then the update is accepted and applied to the DID record
```

**Scenario 02: Update rejected with a mismatched token**
```
Given a DID holder presents a token whose color does not match the color linked to the DID they are attempting to update
When that holder requests the update
Then the update is rejected and the DID record is left unchanged
```

### REQ-06: Build and Test Integrity After Migration

Once the admin-token-gated authorization model (REQ-01 through REQ-05) is implemented across the contract and the client registry API layer, the project's build and automated test suite MUST both pass with zero errors, covering all files modified for this feature.

#### Scenarios

**Scenario 01: The project builds successfully after migration**
```
Given all changes described in REQ-01 through REQ-05 have been implemented in the contract and in the client-side registry API layer
When the project's build command is run
Then the build completes with no compilation errors
```

**Scenario 02: The full test suite passes after migration**
```
Given the same completed implementation
When the project's automated test suite is run
Then all tests pass, including coverage for genesis minting, admin-token-gated operations, token rotation (both the success path and the atomic-failure path), ISSUER removal, and the DID-linked token color check
```

### REQ-07: Accurate System Documentation

The project's user-facing documentation MUST describe the coin-gated admin authorization model as actually shipped, and MUST contain zero remaining references to witness-secret-based ownership or to pre-unification registry architecture.

#### Scenarios

**Scenario 01: Documentation reflects the current authorization model**
```
Given the coin-gated admin access model has been implemented
When a reader consults the project's documentation describing on-chain authorization
Then the documentation describes the genesis admin token, admin-token consumption for privileged operations, admin token rotation, and the removal of the ISSUER role, with no mention of any witness-secret-based ownership mechanism
```

**Scenario 02: Stale architecture references are removed**
```
Given the documentation previously described a pre-unification controller model and a separate token-gating architecture that predate this feature
When a reader consults those same documentation sections after this change ships
Then those sections either no longer exist or have been rewritten to describe only the shipped architecture, with no dangling references to removed contracts, removed operations, or the previous bootstrap flow
```

### REQ-08: Removal of Legacy Orphaned Code and Pre-Unification Tests

Client-side code that exercises the old, identity-based admin bootstrap flow, and the automated tests written against that pre-unification architecture, MUST be deleted rather than rewritten. After removal, the project's build and test commands MUST both succeed with zero references anywhere to the removed files.

#### Scenarios

**Scenario 01: The legacy admin-bootstrap code path no longer exists**
```
Given the project previously included a client-side module implementing a two-step, identity-based admin bootstrap flow
When this feature is delivered
Then that module no longer exists anywhere in the codebase, and no other file in the shipped application imports or references it
```

**Scenario 02: Removal does not break the build or test suite**
```
Given the legacy module and its associated pre-unification test files have been deleted
When the project's build and test commands are run
Then both complete successfully, with no errors caused by missing files, undefined imports, or references to removed exports
```

## Brownfield Annotations

This feature modifies the authorization behavior established by the `unified-gated-did-registry` feature. Specifically:

<!-- overrides: sdd/wip/unified-gated-did-registry/1-functional/spec.md#req-03-registro-del-admin-inicial-bootstrap -->
<!-- REQ-03 of unified-gated-did-registry (ownPublicKey()-gated initial admin bootstrap) is replaced in full by REQ-01 of this feature (genesis admin token minted atomically at deploy). -->

<!-- overrides: sdd/wip/unified-gated-did-registry/1-functional/spec.md#req-02-acuñación-de-tokens-de-acción-solo-admin -->
<!-- REQ-02 of unified-gated-did-registry (admin-only capability token minting, gated by identity check) is replaced by REQ-02 of this feature (admin-token consumption). -->

<!-- overrides: sdd/wip/unified-gated-did-registry/1-functional/spec.md#req-04-emisión-de-did-issuer-aprueba-did-pendiente -->
<!-- REQ-04 of unified-gated-did-registry (ISSUER approves pending DID) is overridden by REQ-02 and REQ-03 of this feature: ISSUER is removed, and DID issuance is gated by admin-token consumption only. -->

<!-- overrides: sdd/wip/unified-gated-did-registry/1-functional/spec.md#req-05-solicitud-de-actualización-de-did-gateada-por-token -->
<!-- REQ-05 of unified-gated-did-registry (token-gated DID update) is extended by REQ-05 of this feature, which adds the requirement that the presented token's color must match the color linked to the specific DID being updated. -->

<!-- overrides: sdd/wip/unified-gated-did-registry/1-functional/spec.md#req-06-revocación-de-did-solo-admin-gateada-por-token -->
<!-- overrides: sdd/wip/unified-gated-did-registry/1-functional/spec.md#req-07-gestión-de-roles-admin-gateada-por-token -->
<!-- REQ-06 (DID revocation) and REQ-07 (role management) of unified-gated-did-registry are overridden by REQ-02 of this feature: both now authorize exclusively via admin-token consumption, with the ISSUER-specific role paths removed per REQ-03. -->

<!-- deprecates: sdd/wip/002-wallet-derived-owner-secret -->
<!-- deprecates: sdd/wip/003-stable-owner-vault-secret -->
<!-- The residual "owner witness secret" concept from these earlier features, still referenced in README.md, is fully deprecated by this feature's zero-long-lived-secret constraint (REQ-01, REQ-02, REQ-07) and MUST NOT be reintroduced in contract or documentation. -->

## Out of Scope

- Any UI/UX changes to token-gating panels beyond what is strictly required to keep `unified-registry-api.ts` callers compiling against the new contract interface, plus the two mechanical import-path fixes required once orphaned modules are deleted (`src/App.tsx`, `src/components/OwnerVaultPanel.tsx`).
- Multi-admin governance features such as quorum approval or timelocks — this feature's `rotate_admin_tokens` delegation primitive is single-holder only and does not introduce multi-party admin coordination.
- Rewriting the coverage previously provided by the five deleted pre-unification test files into new equivalent tests. They exercise an architecture (`self_register_did` / `register_initial_admin` / `ownPublicKey()`) that no longer exists after this change and are deleted outright, not ported forward. Coverage for admin-token flows going forward is the responsibility of `tests/unified-registry.test.ts` (in scope, updated as part of REQ-06).
- Migration of any existing on-chain deployment or admin-token state. No live production deployment with real user funds exists at the time of this feature (per the proposal's Rollback Plan); if a devnet/testnet deployment exists at merge time, it is redeployed fresh rather than migrated in place.
