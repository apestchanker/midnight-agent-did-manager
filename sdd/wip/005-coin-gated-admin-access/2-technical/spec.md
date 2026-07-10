# Technical Spec: Coin-Gated Admin Access — Eliminate Forgeable ownPublicKey() Authorization

**Feature**: 005-coin-gated-admin-access
**Version**: 1.0
**Status**: Draft
**Date**: 2026-07-09
**Refs**: `1-functional/spec.md`

## Architecture Overview

The unified `did_registry.compact.template` contract currently authorizes every admin-tier
operation (`mint_capability_tokens`, `issue_did`, `grant_role`, `revoke_role`, `revoke_did`)
by comparing `ownPublicKey()` against a role recorded in `role_by_key`. `ownPublicKey()` is
not cryptographically bound to the transaction's actual signer (confirmed via source
inspection of the Compact compiler/runtime/ledger plus an empirical PoC), so this identity
check is forgeable. This spec replaces it with the same possession-and-consumption
mechanism the contract already uses for non-admin gated circuits (`consumeToken`), applied
to a new, dedicated admin-colored token.

Three new/changed surfaces carry the fix:

1. **Contract (`contracts/did_registry.compact.template`)** — the constructor mints the
   genesis admin token atomically at deploy time; a new `consumeAdminToken()` helper
   becomes the sole authorization path for the five admin-gated circuits; `issuerRole()`
   and the ISSUER check are deleted; a new `rotate_admin_tokens` circuit lets a holder
   replace their admin token atomically; `request_update_did` gains a DID-linked color
   assert.
2. **Client (`src/lib/registry/unified-registry-api.ts`)** — `deploy()` passes the extra
   constructor arguments (recipient, nonce, supply) instead of a bare `salt`; a new
   `_buildAdminCoin()` helper locates a spendable admin-colored coin (mirroring
   `_buildCoin()`); `registerInitialAdmin()` is removed; `mintTokens`, `issueDid`,
   `grantRole`, `revokeRole`, `revokeDid` are updated to pass an admin coin; a new
   `rotateAdminTokens()` method is added.
3. **Legacy removal** — `src/lib/did/api.ts` and `src/lib/didContract.ts` (the orphaned,
   `ownPublicKey()`-based bootstrap client code) are deleted in full, along with the 5
   pre-unification test files that exercise them. `src/lib/did/app-api.ts`, `src/App.tsx`,
   and `src/components/OwnerVaultPanel.tsx` are updated to remove/repoint the resulting
   dead references.

```
                         BEFORE (forgeable)                      AFTER (coin-gated)
                         ──────────────────                      ──────────────────

  deploy()  ──────────►  constructor(salt)                       constructor(salt,
                          admin_registered=false                    admin_recipient,
                                                                     admin_coin_nonce,
  register_initial_       │                                        admin_supply)
  admin() (separate,      │ ownPublicKey() ==                     ──► mints admin_supply+1
  ownPublicKey()-gated)   │ caller, no proof                          admin-colored coin
      │                   │ of possession                            directly to
      ▼                   ▼                                          admin_recipient
  role_by_key[caller,   FORGEABLE:                                ──► admin_registered=true
  ADMIN] = true          any caller can                               (same tx, atomic)
                          claim admin
  mint_capability_tokens,                                          mint_capability_tokens,
  issue_did, grant_role,  assertRole(adminRole())                  issue_did, grant_role,
  revoke_role, revoke_did │ ownPublicKey() ==                      revoke_role, revoke_did
                          │ caller compared to                     consumeAdminToken(coin)
                          ▼ role_by_key                             │ coin.color ==
                                                                     │ admin_token_color
                                                                     │ nullifier unused
                                                                     │ coin burned/returned
                                                                     ▼
                                                                    rotate_admin_tokens(coin,
                                                                    new_recipient, new_nonce)
                                                                    ──► atomic burn + remint
```

## Architecture Decision Records

### ADR-001: `consumeAdminToken()` reuses `consumeToken()`'s mechanics and shared nullifier map

- **Status**: Accepted
- **Context**: The contract already has an audited, single-purpose helper (`consumeToken`)
  that validates a `ShieldedCoinInfo`'s color/value, enforces single-use via
  `used_capability_nullifiers`, takes custody of the coin, and returns change to the
  caller. Admin authorization needs the identical possession-and-consumption guarantee,
  just checked against a different, single admin color instead of the `valid_colors` set.
- **Decision**: Introduce `consumeAdminToken(coin: ShieldedCoinInfo): []` as a structural
  near-clone of `consumeToken()`, with one difference: it asserts
  `disclose(coin.color) == admin_token_color` (exact equality against the single admin
  color) instead of `valid_colors.member(disclose(coin.color))` (set membership across
  many capability-token colors). It writes to and reads from the **same**
  `used_capability_nullifiers` map as `consumeToken()` — there is no separate
  `used_admin_nullifiers` map.
- **Consequences**: One audited spend-and-return-change code path is extended rather than
  duplicated; admin and capability token nullifiers share one replay-protection
  namespace. Collision risk between an admin-coin nullifier and a capability-coin
  nullifier is bounded by `persistentHash` collision resistance over independently
  random 32-byte nonces — not a practical concern. Reviewers auditing gating logic only
  need to understand one nullifier map's invariants, not two.
- **Alternatives considered**: A fully separate `used_admin_nullifiers: Map<Bytes<32>,
  Boolean>` ledger field was considered for stronger namespace isolation, but rejected —
  it doubles the ledger surface for a guarantee (replay prevention) that
  `persistentHash(coin.nonce)` already provides across domains, since coin nonces are
  independently random regardless of which mint path produced them.

### ADR-002: Admin token follows the same batch-credit model as capability tokens; `rotate_admin_tokens` is self-service replenishment, not remint-per-call

- **Status**: Accepted
- **Context**: `mint_capability_tokens` already mints `amount + 1` units per recipient (1
  permanent anchor + N spendable credits), and `consumeToken` spends 2 units and returns
  the remainder as change. Admin tokens need the same shape so `consumeAdminToken()` can
  literally reuse that mechanic (ADR-001) instead of inventing a second value model.
- **Decision**: The genesis admin token is minted as `admin_supply + 1` units (1 anchor +
  `admin_supply` spendable credits) to the deploying party. Every admin-gated circuit
  spends exactly 2 units via `consumeAdminToken()` and receives 1 unit back as change,
  identical to capability-token consumption. `rotate_admin_tokens` is **not** invoked on
  every admin action — it is a rare, explicit, self-service operation a holder calls when
  they want to replace a lost/compromised token, hand admin capability to a new recipient,
  or replenish their spendable credits. It takes a `new_supply: Uint<64>` parameter — the
  same `+1` anchor convention used by `mint_capability_tokens`'s `amount` — performs a full
  burn (no change returned) of the presented coin, and mints a fresh `new_supply + 1`-unit
  admin coin (1 anchor + `new_supply` credits) to the chosen recipient. `new_supply` MUST be
  `>= 1` (enforced by an `assert`, mirroring the constructor's `admin_supply` guard) so a
  rotation can never leave the recipient with zero spendable credits.
- **Consequences**: No new value-accounting *model* is introduced — rotation reuses the
  same `amount + 1` minting shape as `mint_capability_tokens` — but rotation now doubles as
  the on-chain "top-up" path: an admin whose spendable credits run low can call
  `rotate_admin_tokens` with a larger `new_supply` to replenish in the same operation that
  replaces the coin, rather than needing a separate replenishment primitive. A dedicated
  admin-only `mint_admin_tokens` circuit (mirroring `mint_capability_tokens`) remains
  unnecessary for this reason and stays out of scope (see proposal.md's Out of Scope:
  "governance features beyond the single-holder `rotate_admin_tokens` primitive").
- **Alternatives considered**: A "global admin supply counter that decrements to zero"
  model was explicitly rejected in the proposal (Risks table) because it risks permanent
  lockout if the last unit is spent without a replacement minted in the same transaction.
  The chosen per-holder atomic burn-and-remint sidesteps that failure mode entirely. A
  **fixed 2-unit remint** (no `new_supply` parameter — every rotation always mints exactly
  1 anchor + 1 credit, regardless of the caller's prior balance) was also tried briefly
  during implementation, matching an earlier draft of this ADR. It was discarded before
  this feature's implementation completed: it forces the admin to call
  `rotate_admin_tokens` after *every single* admin-gated action (since each consumption
  leaves only 1 spendable credit as change), which is unacceptable operational friction
  compared to a configurable batch size the admin controls directly, as
  `mint_capability_tokens` already lets non-admin recipients do.

### ADR-003: Constructor signature, genesis mint, and `rotate_admin_tokens`

- **Status**: Accepted
- **Context**: Today's constructor is `constructor(salt: Bytes<32>)`; admin status is
  claimed afterward via the separate, `ownPublicKey()`-gated `register_initial_admin()`.
  Closing that window (REQ-01) requires the constructor itself to mint the genesis admin
  coin, which requires the constructor to know the recipient's coin public key, a nonce
  for the mint, and how many credits to issue.
- **Decision**: The constructor signature becomes:

  ```
  constructor(
    salt: Bytes<32>,
    admin_recipient: ZswapCoinPublicKey,
    admin_coin_nonce: Bytes<32>,
    admin_supply: Uint<64>
  ) {
    registry_salt = disclose(salt);
    total_active_dids = 0 as Uint<64>;

    const public_recipient = disclose(admin_recipient);
    const public_nonce = disclose(admin_coin_nonce);
    const public_supply = disclose(admin_supply);
    const total = (public_supply + (1 as Uint<64>)) as Uint<64>;

    admin_token_color = tokenType(adminDomainSep(), kernel.self());

    mintShieldedToken(
      adminDomainSep(),
      total,
      public_nonce,
      left<ZswapCoinPublicKey, ContractAddress>(public_recipient)
      );

    admin_registered = true;
    initial_admin = public_recipient;
    role_by_key.insert(roleKey(public_recipient, adminRole()), true);
    role_by_key.insert(roleKey(public_recipient, userRole()), true);
  }
  ```

  `register_initial_admin()` is deleted outright — there is no post-deploy bootstrap step.
  `rotate_admin_tokens` is added as:

  ```
  export circuit rotate_admin_tokens(
                   coin: ShieldedCoinInfo,
                   new_recipient: ZswapCoinPublicKey,
                   new_coin_nonce: Bytes<32>,
                   new_supply: Uint<64>
                   ): [] {
    assert(disclose(coin.color) == admin_token_color, "Invalid admin token color");
    assert(disclose(coin.value) >= (1 as Uint<128>), "Insufficient admin token value");
    assert(disclose(new_supply) >= (1 as Uint<64>), "new_supply must be at least 1");
    const nullifier_proxy = persistentHash<Vector<2, Bytes<32>>>(
                               [disclose(coin.color), disclose(coin.nonce)]
                               );
    assert(!used_capability_nullifiers.member(nullifier_proxy), "Admin token already used");
    receiveShielded(disclose(coin));
    used_capability_nullifiers.insert(nullifier_proxy, true);

    const total = (disclose(new_supply) + (1 as Uint<64>)) as Uint<64>;

    mintShieldedToken(
      adminDomainSep(),
      total,
      disclose(new_coin_nonce),
      left<ZswapCoinPublicKey, ContractAddress>(disclose(new_recipient))
      );
  }
  ```

  `new_supply` follows the same `+1` anchor convention as `mint_capability_tokens`'s
  `amount` parameter (see ADR-002) — the caller chooses how many spendable credits the
  rotated coin carries, rather than always receiving a fixed 1-credit balance. The
  `nullifier_proxy` hash is namespaced by `(coin.color, coin.nonce)`, not `coin.nonce`
  alone, so it cannot collide with a capability-token nullifier that happens to share the
  same nonce in the shared `used_capability_nullifiers` map — see the post-quality-gate fix
  recorded in `4-implementation/progress.md`, applied identically to `consumeToken()` and
  `consumeAdminToken()`.

  Both the burn (`receiveShielded` + nullifier insert) and the mint happen in the same
  circuit body, so they execute as one atomic unit of the transaction — there is no
  intermediate committed state where the old token is spent but no new one exists (see
  Error Handling).

  On the client, `UnifiedRegistryAPI.deploy()` derives `admin_recipient` from
  `providers.shieldedCoinPublicKeyHex` (already available on `AppProviders`, used
  elsewhere for `access$()`), generates a random 32-byte `admin_coin_nonce`, and passes a
  fixed initial `admin_supply` (default proposed: `5n`, matching the existing default
  batch size used for capability-token mints — confirm against
  `generateSubscriptionKey`/mint UI defaults at implementation time, not a spec-blocking
  detail).

- **Consequences**: Deployment becomes strictly one transaction for full admin bootstrap;
  the forgeable two-step flow is structurally impossible to reintroduce because
  `register_initial_admin()` no longer exists in the contract. `rotate_admin_tokens`
  gives a recovery/delegation path without ever passing through a zero-valid-admin-token
  state (REQ-04).
- **Verification status — `mintShieldedToken()` in a constructor**: **CONFIRMED, not an
  open question.** This was empirically verified in a prior session of this project: a
  minimal test contract with a constructor calling `mintShieldedToken()` with a
  parameter-supplied recipient was compiled (`compact compile --skip-zk`, exit 0, no
  "coin operations not allowed in constructor" error) and executed via
  `@midnight-ntwrk/compact-runtime`, producing `constructor_ran: true, genesis_minted:
  true, zswap_outputs_count: 1, zswap_currentIndex: 1` — a real Zswap output, not just a
  type-check pass. This pattern is safe to implement as designed above.
- **Verification Result — `kernel.self()` / `tokenType(domainSep, kernel.self())` inside
  a constructor: CONFIRMED, works as designed.** (Task 1, 2026-07-09.)
  - **Method**: A minimal throwaway spike contract (`pragma language_version >= 0.23 &&
    <= 0.23`) was written with a constructor of the shape:
    ```
    constructor(admin_recipient: ZswapCoinPublicKey, admin_coin_nonce: Bytes<32>) {
      admin_token_color = tokenType(adminDomainSep(), kernel.self());
      mintShieldedToken(adminDomainSep(), 2 as Uint<64>, admin_coin_nonce,
        left<ZswapCoinPublicKey, ContractAddress>(admin_recipient));
      constructor_ran = true;
    }
    ```
    exposing `admin_token_color: Bytes<32>` and `constructor_ran: Boolean` as ledger
    fields, with `adminDomainSep()` matching this spec's `pad(32,
    "didmn:admin-token:v1")` pure circuit.
  - **Compilation**: `compact compile --skip-zk contracts/did_registry_spike_task1.compact
    <outdir>` — compiler v0.31.1 (project's pinned toolchain for language_version
    0.23.x) — **exit code 0**, no diagnostics, no "coin operations/kernel access not
    allowed in constructor" error or any other error.
  - **Execution**: The compiled `contract/index.js` was loaded and its constructor run
    via `@midnight-ntwrk/compact-runtime` (`rt.createConstructorContext({}, COIN_PK)` +
    `contract.initialState(ctorCtx, admin_recipient, admin_coin_nonce)`), following this
    project's existing `src/tests/token-gating.test.ts` setup pattern. Observed result:
    - The constructor executed without throwing.
    - `ledger(state).constructor_ran === true`.
    - `ledger(state).admin_token_color` is a real, non-zero 32-byte value:
      `cfb3b670a3eb4a54fe3f718fa3fa745ca2e1913ef78da3f0adbfc24bfb135d9a`.
    - `currentZswapLocalState.outputs` contains exactly one real Zswap output with
      `coinInfo.value === 2n` (matching the `2 as Uint<64>` mint amount) and
      `coinInfo.color` **exactly equal** to the `admin_token_color` value read from the
      ledger. This is the decisive evidence: `tokenType(adminDomainSep(),
      kernel.self())`, computed explicitly in the constructor body and stored to the
      ledger, and the color `mintShieldedToken()` independently derived internally
      (using the same domain separator and the same `kernel.self()`-resolved contract
      address) for the actual Zswap commitment, are byte-for-byte identical. This proves
      `kernel.self()` resolves to a real, consistent contract address at constructor
      execution time — not a placeholder/zero value — and that value is immediately
      usable to compute a token color that matches genuine mint output.
  - **Verdict**: **CONFIRMED — `kernel.self()` and `tokenType(domainSep,
    kernel.self())` are legal and functional inside a Compact constructor.** The
    happy-path design in this ADR (constructor computing `admin_token_color =
    tokenType(adminDomainSep(), kernel.self())` directly, as shown in the Decision
    above) is safe to implement as written. The fallback described below is **not
    required** and Task 2 should proceed with the happy-path constructor as specified.
  - **Cleanup**: The spike `.compact` file, its compiled output directory, and the
    Node.js execution script were all deleted after this verification — no trace left
    under `contracts/`, `src/`, or `scripts/`, per Task 1's acceptance criteria.
  - **Fallback (not needed, retained for record)**: had this been REFUTED, the documented
    fallback would have been to move the
    `admin_token_color = tokenType(adminDomainSep(), kernel.self())` computation out of
    the constructor into a small internal circuit invoked as the very first admin-gated
    call after deploy (worse UX — one extra transaction — but not a design blocker,
    since the genesis *mint* itself, the security-critical part, still happens
    atomically in the constructor; only the *color-recording* step would have moved
    out). This fallback is now moot.
- **Alternatives considered**: Minting a fixed, hardcoded number of genesis credits
  (no `admin_supply` parameter) was considered to shrink the constructor's parameter
  list, but rejected — it removes a legitimate deploy-time configuration point for no
  real simplification, since the client already has to supply `admin_recipient` and
  `admin_coin_nonce` regardless.

> **Post-implementation correction (2026-07-09)**: ADR-002 and this ADR's
> `rotate_admin_tokens` signature/body were revised after implementation to add the
> `new_supply: Uint<64>` parameter, reconciling this document with the code as actually
> shipped (tasks 3/8 fix, approved by the user — see
> `4-implementation/progress.md`'s "Fix de diseño sobre tasks 3/8" entry for the full
> rationale and verification trail). No other ADR in this document changed as part of this
> correction.

### ADR-004: ISSUER role eliminated; `issue_did` gains a `coin` parameter and `consumeAdminToken()` as its first instruction

- **Status**: Accepted
- **Context**: `issue_did` currently checks `is_admin || is_issuer` via two separate
  `role_by_key` lookups. Per REQ-03, ISSUER ceases to exist as a distinct authorization
  path; DID issuance becomes admin-token-gated like the other four privileged circuits.
- **Decision**: Delete the `issuerRole()` pure circuit and the `admin_lookup_key` /
  `issuer_lookup_key` / `is_admin` / `is_issuer` block entirely. `issue_did`'s signature
  gains `coin: ShieldedCoinInfo` as its **first** parameter:

  ```
  export circuit issue_did(
                   coin: ShieldedCoinInfo,
                   did_key: Bytes<32>,
                   did_commitment: Bytes<32>,
                   doc_commitment: Bytes<32>,
                   proof_commitment: Bytes<32>
                   ): [] {
    consumeAdminToken(coin);

    const public_did_key = disclose(did_key);
    ... (unchanged body below this point)
  }
  ```

  `consumeAdminToken(coin)` is the first instruction, consistent with the existing
  codebase convention of checking authorization before touching any other state (see the
  current contract's `mint_capability_tokens` comment: "chequeo de rol ADMIN como
  PRIMERA instrucción"). The same ordering — `consumeAdminToken(coin)` first — is applied
  to `mint_capability_tokens`, `grant_role`, `revoke_role`, and `revoke_did` for
  consistency across all five admin-gated circuits, replacing their existing
  `assertRole(adminRole())` calls (which were already first-instruction in
  `mint_capability_tokens`; `grant_role`/`revoke_role`/`revoke_did` move their
  `assertRole` + later `consumeToken(coin)` pair into a single `consumeAdminToken(coin)`
  call at the top).
- **Consequences**: One authorization surface (`consumeAdminToken`) replaces two
  (`assertRole` for admin identity, `consumeToken` for generic capability-token spend) in
  `grant_role`/`revoke_role`/`revoke_did`; `mint_capability_tokens` and `issue_did` each
  go from zero or identity-only checks to full coin-consumption checks.
  `deriveRegistryAccess()` in `src/lib/did/ledger.ts` already hardcodes
  `isIssuer: false` in its returned `RegistryAccess` shape, so no additional client-side
  change is required there — this was previously dead-lettered UI state and is now
  simply accurate.
- **Alternatives considered**: Keeping ISSUER as an alias that also satisfies
  `consumeAdminToken` (i.e., an ISSUER-colored token distinct from the admin color) was
  considered, to preserve a narrower-privilege issuance-only role. Rejected per explicit
  functional requirement REQ-03 and the proposal's approved scope — reintroducing any
  ISSUER-equivalent authorization path defeats the stated goal of collapsing to one
  admin-tier gate.

### ADR-005: `request_update_did` gains a DID-linked color assert

- **Status**: Accepted
- **Context**: `request_update_did` already calls `consumeToken(coin)`, which only checks
  `coin.color` against the global `valid_colors` set — any valid capability-token color
  can currently authorize an update to *any* DID, not just the one the presented token was
  originally minted for. REQ-05 requires the presented token to be the one specifically
  linked to the DID being updated.
- **Decision**: Insert one assert immediately after the four existing preconditions and
  immediately before `consumeToken(coin)`:

  ```
  export circuit request_update_did(
                   coin: ShieldedCoinInfo,
                   subject_nonce: Bytes<32>,
                   doc_commitment: Bytes<32>,
                   cap_commitment: Bytes<32>
                   ): [] {
    const controller = ownPublicKey();
    const public_nonce = disclose(subject_nonce);
    const did_key = disclose(deriveDidKey(controller, public_nonce));

    assert(did_controller.member(did_key), "DID not registered");
    assert(did_controller.lookup(did_key) == controller, "Caller is not DID controller");
    assert(party_status.member(did_key), "DID not registered");
    assert(party_status.lookup(did_key) == (2 as Uint<8>), "DID is not active");
    assert(disclose(coin.color) == did_token_color.lookup(did_key), "Token does not match this DID");

    consumeToken(coin);
    ...
  }
  ```

  No `did_token_color.member(did_key)` guard is needed before the `.lookup()` call: the
  three preceding asserts already establish `did_controller.member(did_key)` and
  `party_status.lookup(did_key) == 2` (active), and `did_token_color.insert(did_key, ...)`
  is written unconditionally in `gated_self_register_did` in the same transaction that
  first creates `did_controller[did_key]` — so `did_token_color` is guaranteed to have an
  entry for any `did_key` that reaches this point.
- **Consequences**: An attacker holding an unrelated but valid capability token can no
  longer submit updates to a DID they don't control the token for, even if they somehow
  satisfied the controller check (which independently requires `ownPublicKey() ==
  did_controller.lookup(did_key)` — this assert is defense-in-depth on top of that, closing
  the gap where any valid-colored token, not necessarily *that* DID's token, was
  previously accepted).
- **Alternatives considered**: Checking the color inside `consumeToken()` itself (making
  it take an expected-color parameter) was considered, to avoid duplicating a color
  check pattern. Rejected — `consumeToken()` is shared by circuits with different color
  semantics (global `valid_colors` membership for capability tokens vs. exact
  DID-linked-color equality here); parameterizing it would complicate its one existing
  call site's contract instead of adding one line at this call site.

## Component Design

### Contract: `contracts/did_registry.compact.template`

**Responsabilidad**: On-chain enforcement of coin-gated admin and DID-update
authorization.

**New ledger field**:
```
export ledger admin_token_color: Bytes<32>;
```
Single value (not a map) — there is exactly one admin color for the life of the
contract, set once in the constructor and never reassigned.

**New pure circuit**:
```
pure circuit adminDomainSep(): Bytes<32> {
  return pad(32, "didmn:admin-token:v1");
}
```
Fixed, contract-wide domain separator distinct from the per-subscription domain
separators used by `mint_capability_tokens` (`persistentHash<Bytes<32>>(subscription_key)`),
guaranteeing `admin_token_color` cannot collide with any capability-token color.

**New circuit** (internal, not exported): `consumeAdminToken(coin: ShieldedCoinInfo): []`
— see ADR-001 for full body.

**New circuit** (exported): `rotate_admin_tokens(coin, new_recipient, new_coin_nonce,
new_supply): []` — see ADR-003 for full body.

**Removed**: `register_initial_admin()` (exported circuit), `issuerRole()` (pure
circuit).

**Modified signatures**:
| Circuit | Before | After |
|---|---|---|
| `constructor` | `(salt: Bytes<32>)` | `(salt: Bytes<32>, admin_recipient: ZswapCoinPublicKey, admin_coin_nonce: Bytes<32>, admin_supply: Uint<64>)` |
| `mint_capability_tokens` | `(subscription_key, recipient, coin_nonce, amount)` | `(coin: ShieldedCoinInfo, subscription_key, recipient, coin_nonce, amount)` |
| `issue_did` | `(did_key, did_commitment, doc_commitment, proof_commitment)` | `(coin: ShieldedCoinInfo, did_key, did_commitment, doc_commitment, proof_commitment)` |
| `grant_role` | `(coin, did_key, role)` | unchanged signature; body replaces `assertRole` + later `consumeToken` with one `consumeAdminToken(coin)` first |
| `revoke_role` | `(coin, did_key, role)` | unchanged signature; same body change as `grant_role` |
| `revoke_did` | `(coin, did_key)` | unchanged signature; same body change as `grant_role` |
| `request_update_did` | `(coin, subject_nonce, doc_commitment, cap_commitment)` | unchanged signature; body gains the color assert (ADR-005) |

**Bookkeeping clarification (not an authorization mechanism)**: the constructor still
writes `role_by_key.insert(roleKey(admin_recipient, adminRole()), true)` and the
`userRole()` equivalent, mirroring what `register_initial_admin()` used to do. This is
retained **purely as a read-model signal** — `deriveRegistryAccess()` in
`src/lib/did/ledger.ts` reads `role_by_key` to populate the UI's `isRegistryAdmin` flag,
and removing this write would silently break that display. It is explicitly **not** an
authorization source after this change: no circuit consults `role_by_key` to authorize
an admin-gated operation any more; `consumeAdminToken()` is the sole authorization path.

**Post-migration housekeeping note (non-blocking)**: `assertRole()` (the pure circuit
checking `role_by_key`) has no remaining callers inside the contract once all five
admin-gated circuits move to `consumeAdminToken()`. It is left in place as a
general-purpose helper (available for a future USER/AGENT-gated circuit) rather than
deleted, since it carries no ledger footprint of its own and removing it is not required
by any REQ. Confirm at implementation time whether the Compact compiler flags unused
top-level circuits; if so, either remove it or add a trivial internal caller.

**Dependencias**: `CompactStandardLibrary` (`mintShieldedToken`, `tokenType`,
`receiveShielded`, `sendImmediateShielded`, `persistentHash`, `pad`, `disclose`).

### Client: `src/lib/registry/unified-registry-api.ts`

**Responsabilidad**: TypeScript-side orchestration of contract calls, coin selection, and
DID-record caching.

**Modified `deploy()`**:
```ts
static async deploy(providers: AppProviders): Promise<UnifiedRegistryAPI> {
  const module = await loadUnifiedModule();
  const compiledContract = await UnifiedRegistryAPI._makeCompiled(module);

  const salt = randomBytes(32);
  const adminRecipientBytes = fromHex(providers.shieldedCoinPublicKeyHex);
  const adminCoinNonce = crypto.getRandomValues(new Uint8Array(32));
  const adminSupply = 5n; // batch-credit default, mirrors mint_capability_tokens sizing

  const deployed = await deployContract(providers as never, {
    compiledContract: compiledContract as never,
    args: [salt, { bytes: adminRecipientBytes }, adminCoinNonce, adminSupply],
  });
  ...
}
```

**New private helper**: `_buildAdminCoin(): Promise<{ coin: ShieldedCoin; colorHex: string }>`
— mirrors `_buildCoin()` (lines 183-211 today) but filters the caller's shielded
balances against `ledger.admin_token_color` specifically (single value equality) instead
of `fetchVerifiedTokenColors()` (multi-color `valid_colors` membership). Throws the same
shape of "no spendable admin credits" error if none found.

**New public method**:
```ts
async rotateAdminTokens(opts: {
  newRecipientBytes: Uint8Array;
  newSupply: bigint;
}): Promise<{ txHash: string; txId?: string }> {
  const { coin } = await this._buildAdminCoin();
  const newCoinNonce = crypto.getRandomValues(new Uint8Array(32));
  const tx = await (
    this.contract.callTx.rotate_admin_tokens as (
      coin: ShieldedCoin,
      newRecipient: { bytes: Uint8Array },
      newCoinNonce: Uint8Array,
      newSupply: bigint,
    ) => Promise<TxResult>
  )(coin, { bytes: opts.newRecipientBytes }, newCoinNonce, opts.newSupply);
  return { txHash: String(tx.public.txHash || ""), txId: String(tx.public.txId || "") };
}
```
`newSupply` follows the same caller-chosen-batch-size convention as `mintTokens()`'s
credit amount (see ADR-002) — the admin picks how many spendable credits the rotated coin
carries, rather than always receiving a fixed 1-credit balance.

**Removed method**: `registerInitialAdmin()` (lines 215-223 today) — no longer a valid
circuit call once `register_initial_admin` is removed from the contract.

**Modified methods** (each gains an admin coin via `_buildAdminCoin()` before calling the
underlying `contract.callTx.*`, matching the new circuit signatures in ADR-003/ADR-004):
`mintTokens` (passes `coin` as new first `callTx` argument), `issueDid` (same), plus
`grantRole`/`revokeRole`/`revokeDid`, which already build a coin via `_buildCoin()` today
— that call is replaced with `_buildAdminCoin()` so the presented coin is specifically
admin-colored rather than any valid capability color.

**Dependencias**: `../../../lib/providers` (`AppProviders.shieldedCoinPublicKeyHex`,
already populated in `lib/providers.ts` via `extractShieldedCoinPublicKeyHex`), generated
runtime module (`../../generated/didRegistryContract.runtime.js`).

### Build script: `scripts/compile-contract.js`

**Responsabilidad**: Regenerates `did_registry.compact` from the template and compiles
circuit keys.

**`CIRCUITS` array change** (currently lines 31-41):
```diff
 const CIRCUITS = [
   "contract_version",
-  "register_initial_admin",
   "mint_capability_tokens",
   "gated_self_register_did",
   "request_update_did",
   "issue_did",
   "grant_role",
   "revoke_role",
   "revoke_did",
+  "rotate_admin_tokens",
 ];
```
`consumeAdminToken` is not added — it is an internal (non-exported) circuit, consistent
with `consumeToken` not appearing in this list today.

### Legacy Code Removal Plan

This is a mechanical deletion pass, fully grep-verified in `proposal.md`'s Affected Areas
table. Restated here as the implementation checklist:

1. **Delete** `src/lib/did/api.ts` in full (orphaned `DidRegistryAPI` class; its
   `self_register_did`/`register_initial_admin()` client flow is the same forgeable
   pattern being eliminated on-chain).
2. **Delete** `src/lib/didContract.ts` in full.
3. **In `src/lib/did/app-api.ts`**: remove `deployDidRegistry`, `updateDidOrchestrated`,
   `revokeDidOrchestrated` (the only three functions typed against `DidRegistryAPI`);
   remove `import { DidRegistryAPI } from "./api"`; narrow
   `type AnyRegistryAPI = DidRegistryAPI | UnifiedRegistryAPI` to
   `type AnyRegistryAPI = UnifiedRegistryAPI`. Keep `compileDidRegistry`,
   `deployUnifiedRegistry`, `requestDidWithSync`, `issueDidWithSync`,
   `updateDidWithSync`, `revokeDidWithSync`, `getTokenBalance`, and the
   `mergeDidMetadata`/`syncWallet*Storage` sync helpers unchanged.
4. **In `src/App.tsx`**: repoint the `getSavedContractAddress`/`getSavedDeployment`
   import from `./lib/didContract` to `./lib/did/cache`.
5. **In `src/components/OwnerVaultPanel.tsx`**: repoint the `getOwnerVaultStatus` import
   from `../lib/didContract` to `../lib/did/vault`, and `OwnerVaultStatus` (the type) to
   `../types/did`.
6. **Delete** the 5 pre-unification test files: `src/tests/did-registry-gated.test.ts`,
   `src/tests/token-gating.test.ts`, `src/tests/token-gating-integration.test.ts`,
   `src/tests/token-subscription.test.ts`, `src/tests/token-api-layer.test.ts`. Not
   ported forward — they exercise `self_register_did`/`register_initial_admin`/
   `ownPublicKey()` behavior that no longer exists.

`npm run build` (TypeScript compilation across the whole project) is the mechanical
backstop: any missed reference to a deleted export fails the build immediately rather
than silently, satisfying REQ-08 Scenario 02.

## Data Model

```
// New
export ledger admin_token_color: Bytes<32>;   // single admin color, set once in constructor

// Unchanged in shape, but semantics narrow to "read-model only" for admin authorization:
export ledger role_by_key: Map<Bytes<32>, Boolean>;   // no longer consulted by any
                                                        // admin-gated circuit; UI-display
                                                        // signal only (deriveRegistryAccess)
export ledger admin_registered: Boolean;               // now set atomically in constructor,
                                                        // never by a separate transaction
export ledger initial_admin: ZswapCoinPublicKey;        // now set from the constructor's
                                                        // admin_recipient parameter

// Removed circuits (no ledger shape change, but authorization-relevant):
// register_initial_admin() — deleted entirely
// issuerRole() — deleted entirely
```

No ledger field is removed. `did_token_color: Map<Bytes<32>, Bytes<32>>` (already present)
gains a new reader in `request_update_did` (ADR-005) but no shape change.

## API Contract

Sin cambios en API pública HTTP/REST — this feature is entirely contract-circuit and
registry-client-library surface. The "API contract" here is the set of exported Compact
circuit signatures (documented in Component Design above) and the corresponding
`UnifiedRegistryAPI` TypeScript method signatures. Any UI component calling
`registerInitialAdmin()` must be updated or removed as part of this change — grep
confirms `unified-registry-api.ts` is the only caller of the contract's
`register_initial_admin` circuit today (no UI component calls
`UnifiedRegistryAPI.registerInitialAdmin()` directly per the exploration referenced in
`meta.md`; confirm with a fresh grep at implementation start since this spec does not
re-derive that finding from scratch).

## Error Handling

- **Coin-consumption failures** (`consumeAdminToken`, `consumeToken`, `rotate_admin_tokens`)
  surface as Compact `assert` failures, which abort the entire transaction — no partial
  ledger mutation is persisted. This is the mechanism REQ-04's atomicity requirement
  (Scenario 02: "no orphaned or lost admin token") relies on: if `rotate_admin_tokens`'s
  `mintShieldedToken` call were to fail after the burn's `receiveShielded` +
  nullifier-insert already executed, the whole circuit invocation — burn included —
  rolls back as one unit, because both statements are in the same circuit body executed
  within the same transaction. There is no code path that commits the burn without also
  committing the mint.
- **Client-side errors**: `_buildAdminCoin()` throws a descriptive error
  ("No spendable admin credits found...") when the caller holds no admin-colored coin
  with sufficient value, mirroring `_buildCoin()`'s existing error message shape. This
  surfaces to the UI's existing error-display path (token-gating panel; see
  `4833d48 fix(ui): show registry join error in token gating panel when contract not
  connected` for the precedent of how coin/gating errors are already surfaced).
- **Build-time errors**: any reference to a deleted export (`DidRegistryAPI`,
  `registerInitialAdmin`, deleted test files' imports) fails `tsc`/`npm run build`
  immediately — this is the intended detection mechanism for REQ-08, not something to
  suppress or work around.

## Testing Strategy

- **Unit/contract-simulator tests** (`@midnight-ntwrk/compact-runtime`, via
  `tests/unified-registry.test.ts`): exercise each circuit's ledger-state transitions in
  isolation — genesis mint sets `admin_token_color` and mints the expected coin value;
  `consumeAdminToken` accepts a correctly-colored coin and rejects a wrong-colored one;
  `rotate_admin_tokens` success and failure paths.
- **Integration tests** (same file, full deploy-then-call sequences against the
  simulator): the REQ-06 Scenario 02 "full test suite" bar requires these to cover the
  entire lifecycle — deploy → mint capability tokens → issue DID → grant/revoke role →
  revoke DID → rotate admin token — using the new coin-gated signatures throughout.
- **Build-level checks**: `npm run build` and `npm test` as the final gate for REQ-06 and
  REQ-08; no dedicated test asserts "file X does not exist" — the compiler's import
  resolution is the check.

REQ → test type mapping (referencing `1-functional/spec.md` scenario numbering):

| REQ | Scenario(s) | Test type |
|---|---|---|
| REQ-01 (genesis mint) | 01, 02 | Integration (deploy + ledger-state assertions); negative check that no `register_initial_admin` circuit exists post-compile |
| REQ-02 (admin-token-gated ops) | 01, 02 | Integration, one case per gated circuit (success with valid admin coin; rejection with none/wrong coin) |
| REQ-03 (ISSUER removal) | 01, 02 | Unit (compile-time absence of `issuerRole`); integration (issue_did rejects a caller with only a legacy-shaped non-admin role and no admin coin) |
| REQ-04 (atomic rotation) | 01, 02 | Integration, success path; integration, forced-failure path (e.g. reusing a nullifier or presenting insufficient value) verifying original token remains valid and unconsumed |
| REQ-05 (DID-linked token check) | 01, 02 | Integration: update with matching-color coin succeeds; update with a differently-colored, otherwise-valid coin is rejected |
| REQ-06 (build/test integrity) | 01, 02 | Build-level (`npm run build`, `npm test`) — gate, not a unit test |
| REQ-07 (documentation) | 01, 02 | Manual review / `/sdd.verify` doc-accuracy pass — not automated |
| REQ-08 (legacy removal) | 01, 02 | Build-level (`npm run build`, `npm test` with zero references to deleted files); manual `grep` sweep for `DidRegistryAPI`/`didContract`/`registerInitialAdmin` as a pre-merge check |

Every scenario in `1-functional/spec.md` REQ-01 through REQ-05 MUST have at least one
corresponding integration test in `tests/unified-registry.test.ts` before this feature is
considered verifiable (`/sdd.verify`).

## Non-Functional Requirements

- **Performance**: `consumeAdminToken()` and `rotate_admin_tokens()` add no new
  asymptotic cost over the existing `consumeToken()` pattern — one map membership check,
  one map insert, one `receiveShielded`/`sendImmediateShielded` (or one
  `mintShieldedToken` for rotation) per call, matching current gated-circuit cost.
  `mint_capability_tokens` and `issue_did` each gain one coin-consumption's worth of
  proving cost (previously zero, for `issue_did`; previously an identity-check-only cost,
  for `mint_capability_tokens`'s `assertRole`) — this is an intentional, expected
  proving-time increase in exchange for closing the forgeable-authorization gap, not a
  regression to guard against.
- **Security**: **Authorization for every admin-tier operation is rooted entirely in
  shielded-coin possession and consumption; zero long-lived secrets are introduced
  anywhere in this design.** This is the user's explicit, non-negotiable constraint for
  this feature and the reason `consumeAdminToken()` — not a witness-secret,
  `local_secret_key()`, or any `persistentHash`-of-a-secret pattern — is the sole
  authorization mechanism. It exists because `ownPublicKey()`-based role checks
  (`assertRole(adminRole())` and the inline `is_admin || is_issuer` check in `issue_did`)
  were confirmed forgeable via source-code inspection of the Compact
  compiler/runtime/ledger plus an empirical PoC: `ownPublicKey()` is not
  cryptographically bound to the transaction's actual signer, so any caller could
  potentially claim admin authority under the previous model. Coin-gated authorization
  closes this because forging a valid `ShieldedCoinInfo` of the exact `admin_token_color`
  with an unused nonce requires either holding a genuinely minted admin coin or breaking
  the underlying shielded-coin cryptography (commitment binding, nullifier uniqueness) —
  a materially different, much stronger security property than comparing a
  self-reported public key against a ledger entry. The design must not regress to any
  witness-secret-based pattern in a future iteration (see Brownfield Annotations below,
  deprecating `002-wallet-derived-owner-secret` and `003-stable-owner-vault-secret`).
- **Observability**: No new logging/metrics infrastructure is introduced. Transaction
  hashes/IDs returned from each `UnifiedRegistryAPI` method (unchanged pattern) remain
  the primary observability surface for admin operations; `rotateAdminTokens()` follows
  the same `{ txHash, txId }` return shape as its sibling methods.

## Brownfield Annotations

<!-- overrides: sdd/wip/unified-gated-did-registry/2-technical/spec.md#adr-005-constructor-salt-bytes32-se-elimina-token_contract -->
<!-- ADR-005 of unified-gated-did-registry (constructor takes only `salt`) is overridden by this spec's ADR-003 (constructor gains admin_recipient/admin_coin_nonce/admin_supply and mints the genesis admin token atomically). -->

<!-- overrides: sdd/wip/unified-gated-did-registry/2-technical/spec.md#adr-008-mint_capability_tokens-añade-assertroleadminrole -->
<!-- ADR-008 of unified-gated-did-registry (mint_capability_tokens gated by assertRole(adminRole())) is overridden by this spec's ADR-001/ADR-004 (gated by consumeAdminToken(coin) instead). -->

<!-- overrides: sdd/wip/unified-gated-did-registry/2-technical/spec.md#adr-009-issue_did-no-se-gatéa-mantiene-solo-chequeo-de-rol -->
<!-- ADR-009 of unified-gated-did-registry (issue_did stays ungated, role-check only, ISSUER-or-ADMIN) is overridden by this spec's ADR-004 (issue_did becomes coin-gated via consumeAdminToken; ISSUER role removed entirely). -->

<!-- deprecates: sdd/features/002-wallet-derived-owner-secret -->
<!-- deprecates: sdd/features/003-stable-owner-vault-secret -->
<!-- These archived features' witness-secret-based ownership concepts remain fully deprecated by this spec's Security section; no witness-secret pattern is reintroduced anywhere in this design. -->
