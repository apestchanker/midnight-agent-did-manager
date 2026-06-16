# Software Design Document: Self-Registered DID Controllers and Role Governance

## Status

Target design for the next DID registry iteration.

This SDD replaces the current browser-local owner-secret authority model with a Midnight-native controller model based on `ownPublicKey()` and `ZswapCoinPublicKey`. It is not yet fully implemented in `contracts/did_registry.compact`.

Feasibility was verified with the local Compact compiler using probe contracts under `.analysis/`:

- `.analysis/controller_binding_probe.compact`
- `.analysis/self_registration_probe.compact`

The probes compiled successfully and generated prover/verifier artifacts under `/tmp`.

## Problem

The current DID registry uses a local owner secret through `witness issuerSecret()` for privileged issuance, update, and revocation. That creates a poor adoption and security model:

- browser-local private state can be lost or compromised
- users must reason about a separate technical secret
- deterministic wallet signatures were tested and are not reliable enough to derive the secret
- the registry does not clearly separate user-controlled self-service updates from admin or issuer powers

The new design must let users self-register safely on a public chain without requiring an admin to approve every registration, while still preventing adversarial transactions from squatting or blocking real users.

## Goals

- No separate browser-local DID or admin secret for normal user registration and self-service DID updates.
- Let any platform user self-register from their connected Midnight wallet.
- Prevent attackers from registering a DID key that blocks another wallet.
- Bind each DID key to exactly one controller public key.
- Let the DID controller modify self-attested DID data and capability commitments.
- Let admins issue, revoke, certify, grant roles, and revoke roles.
- Let admins grant or revoke `ADMIN`, `ISSUER`, `USER`, and `AGENT` roles for registered controllers.
- Support additional admins without redeploying the registry.
- Support Dust sponsorship if the sponsored transaction still preserves the user's `ownPublicKey()` as the circuit caller.

## Non-Goals

- Do not store plain personal data on-chain.
- Do not use unshielded wallet address as the primary Compact authorization primitive.
- Do not require admin approval for every user registration.
- Do not make DID keys human-readable or globally claimable without controller binding.
- Do not rely on wallet-signed message determinism.

## Key Concepts

### `ZswapCoinPublicKey`

`ZswapCoinPublicKey` is the Compact type used to represent the controller key.

### `ownPublicKey()`

`ownPublicKey()` is the Compact primitive that returns the current caller/prover's `ZswapCoinPublicKey` inside the circuit.

The design stores `ZswapCoinPublicKey` values and compares them to `ownPublicKey()` for authorization.

### DID Key

The DID key is the registry-local DID identifier:

```text
did_key = hash("didmn:did:v1", registry_salt, ownPublicKey().bytes, subject_nonce)
```

The DID key is not equal to the controller public key. The contract stores a mapping:

```text
did_controller[did_key] = ownPublicKey()
```

Later self-service mutations recompute the DID key from the caller's current `ownPublicKey()` and the same subject nonce, then check:

```text
did_controller[did_key] == ownPublicKey()
```

This is the core anti-squatting and authorization rule.

### Subject Nonce

`subject_nonce` lets a wallet create more than one DID under the same registry.

For one DID per wallet, the product can use a fixed nonce. For multiple agents per wallet, the platform can generate one nonce per agent slot.

The nonce is not an authority secret. It only selects a DID slot under the controller key. If an attacker sees the nonce, their `ownPublicKey()` is different, so they derive a different DID key.

## High-Level Architecture

```text
Wallet tx caller
  -> Compact ownPublicKey()
  -> derive did_key from registry_salt + ownPublicKey().bytes + subject_nonce
  -> store did_controller[did_key] = ownPublicKey()
  -> later self-service updates must come from same ownPublicKey()

Admin wallet caller
  -> Compact ownPublicKey()
  -> role_key = hash("didmn:role:v1", ownPublicKey().bytes, role)
  -> role_by_key[role_key] must be true for privileged actions
```

## On-Chain State

Target ledgers:

```compact
export ledger initialized: Boolean;
export ledger registry_salt: Bytes<32>;
export ledger admin_registered: Boolean;
export ledger initial_admin: ZswapCoinPublicKey;

export ledger did_controller: Map<Bytes<32>, ZswapCoinPublicKey>;
export ledger did_status: Map<Bytes<32>, Uint<8>>;
export ledger did_commitments: Map<Bytes<32>, Bytes<32>>;
export ledger document_commitments: Map<Bytes<32>, Bytes<32>>;
export ledger proof_commitments: Map<Bytes<32>, Bytes<32>>;
export ledger capability_commitments: Map<Bytes<32>, Bytes<32>>;
export ledger revocation_commitments: Map<Bytes<32>, Bytes<32>>;

export ledger role_by_key: Map<Bytes<32>, Boolean>;
export ledger party_status: Map<Bytes<32>, Uint<8>>;
export ledger total_requests: Uint<64>;
export ledger total_active_dids: Uint<64>;
export ledger registry_nonce: Counter;
```

Status codes:

```text
0 = none
1 = registered / pending issuance
2 = active
3 = revoked
4 = pending update
5 = pending revocation
```

Role identifiers:

```text
ADMIN
ISSUER
USER
AGENT
```

## Circuit Design

### Helper Circuits

```compact
circuit deriveDidKey(controller: ZswapCoinPublicKey, subject_nonce: Bytes<32>): Bytes<32> {
  return persistentHash<Vector<4, Bytes<32>>>(
    [
      pad(32, "didmn:did:v1"),
      registry_salt,
      controller.bytes,
      subject_nonce
    ]
  );
}

circuit roleKey(controller: ZswapCoinPublicKey, role: Bytes<32>): Bytes<32> {
  return persistentHash<Vector<3, Bytes<32>>>(
    [
      pad(32, "didmn:role:v1"),
      controller.bytes,
      role
    ]
  );
}

pure circuit adminRole(): Bytes<32> {
  return pad(32, "ADMIN");
}

pure circuit issuerRole(): Bytes<32> {
  return pad(32, "ISSUER");
}

pure circuit userRole(): Bytes<32> {
  return pad(32, "USER");
}

pure circuit agentRole(): Bytes<32> {
  return pad(32, "AGENT");
}

circuit assertRole(role: Bytes<32>): [] {
  const caller = ownPublicKey();
  const key = roleKey(caller, role);
  assert(role_by_key.member(key), "Missing role");
  assert(role_by_key.lookup(key), "Missing role");
}
```

### Bootstrap Initial Admin

```compact
export circuit register_initial_admin(): [] {
  assert(!admin_registered, "Admin already registered");
  const caller = ownPublicKey();
  initial_admin = caller;
  role_by_key.insert(roleKey(caller, adminRole()), true);
  admin_registered = true;
}
```

Platform validation:

1. Platform deploys registry.
2. Platform immediately calls `register_initial_admin()` from the expected admin wallet.
3. Platform reads `initial_admin`.
4. Platform marks registry canonical only if `initial_admin` equals the expected admin wallet public key.
5. If another party races the bootstrap, the platform ignores that registry and deploys a new one.

No user registration is allowed by the platform before canonical registry validation.

### Self-Register DID

```compact
export circuit self_register_did(subject_nonce: Bytes<32>): Bytes<32> {
  const controller = ownPublicKey();
  const public_subject_nonce = disclose(subject_nonce);
  const did_key = disclose(deriveDidKey(controller, public_subject_nonce));

  assert(!did_controller.member(did_key), "DID already registered");

  did_controller.insert(did_key, controller);
  did_status.insert(did_key, 1 as Uint<8>);
  role_by_key.insert(roleKey(controller, userRole()), true);
  registry_nonce.increment(1);

  return did_key;
}
```

Security effect:

- attacker using the same nonce derives a different `did_key` because their `ownPublicKey()` is different
- attacker cannot register the victim wallet's DID key
- attacker cannot later modify the victim DID because mutation checks compare against `ownPublicKey()`

### Request Self-Service Update

```compact
export circuit request_update_did(
  subject_nonce: Bytes<32>,
  update_commitment: Bytes<32>,
  capability_commitment: Bytes<32>
): [] {
  const controller = ownPublicKey();
  const public_subject_nonce = disclose(subject_nonce);
  const did_key = disclose(deriveDidKey(controller, public_subject_nonce));

  assert(did_controller.member(did_key), "DID not registered");
  assert(did_controller.lookup(did_key) == controller, "Caller is not DID controller");
  assert(did_status.lookup(did_key) == (2 as Uint<8>), "DID is not active");

  document_commitments.insert(did_key, disclose(update_commitment));
  capability_commitments.insert(did_key, disclose(capability_commitment));
  did_status.insert(did_key, 4 as Uint<8>);
  registry_nonce.increment(1);
}
```

### Admin Issue DID

```compact
export circuit issue_did(
  did_key: Bytes<32>,
  did_commitment: Bytes<32>,
  document_commitment: Bytes<32>,
  proof_commitment: Bytes<32>
): [] {
  assertRole(adminRole());
  const public_did_key = disclose(did_key);

  assert(did_controller.member(public_did_key), "DID not registered");
  assert(did_status.lookup(public_did_key) == (1 as Uint<8>), "DID is not pending issuance");

  did_commitments.insert(public_did_key, disclose(did_commitment));
  document_commitments.insert(public_did_key, disclose(document_commitment));
  proof_commitments.insert(public_did_key, disclose(proof_commitment));
  did_status.insert(public_did_key, 2 as Uint<8>);
  total_active_dids = (total_active_dids + 1) as Uint<64>;
  registry_nonce.increment(1);
}
```

`ISSUER` can be accepted here too if the product wants to split issuer and admin authority.

### Role Management

Admin can grant or revoke roles for registered DID controllers.

```compact
export circuit grant_role(did_key: Bytes<32>, role: Bytes<32>): [] {
  assertRole(adminRole());
  const public_did_key = disclose(did_key);
  assert(did_controller.member(public_did_key), "DID not registered");

  const target = did_controller.lookup(public_did_key);
  role_by_key.insert(roleKey(target, disclose(role)), true);
  registry_nonce.increment(1);
}

export circuit revoke_role(did_key: Bytes<32>, role: Bytes<32>): [] {
  assertRole(adminRole());
  const public_did_key = disclose(did_key);
  assert(did_controller.member(public_did_key), "DID not registered");

  const target = did_controller.lookup(public_did_key);
  role_by_key.insert(roleKey(target, disclose(role)), false);
  registry_nonce.increment(1);
}
```

Recommended guardrail:

- track `active_admin_count`
- do not allow revoking the last active `ADMIN`

## Public DID Format

Target DID format:

```text
did:midnight:<network-id>:<contract-address>:<did-key>
```

The DID document may include linked wallet metadata or unshielded wallet address commitments, but Compact authorization is based on `ZswapCoinPublicKey`, not on the displayed unshielded address.

## Dust Sponsorship

Dust sponsorship is acceptable if the sponsored transaction keeps the user's wallet public key as the Compact caller:

```text
ownPublicKey() must be the registering user's ZswapCoinPublicKey
```

If a sponsor flow causes `ownPublicKey()` to resolve to the sponsor instead of the user, it must not be used for self-registration or self-service DID updates.

This must be tested end to end with the selected sponsorship flow before enabling it in production.

## Security Analysis

### Squatting Resistance

Open public self-registration is safe only because the DID key is controller-derived:

```text
hash(registry_salt, victim_public_key, nonce) != hash(registry_salt, attacker_public_key, nonce)
```

An attacker can register their own DID slots, but cannot pre-register the victim's derived DID key.

### Identity Theft Resistance

Knowing a victim's public key is not enough to act as the victim. The contract does not accept a user-supplied controller for self-registration. It stores `ownPublicKey()` directly.

Unsafe pattern to avoid:

```compact
self_register_did(did_key, controller_key)
```

Safe pattern:

```compact
const controller = ownPublicKey();
const did_key = deriveDidKey(controller, nonce);
did_controller.insert(did_key, controller);
```

### Role Abuse

Admins can grant additional admins and revoke admin roles. To avoid accidental registry lockout, the implementation should prevent revoking the last active admin or require an explicit off-chain registry abandonment process.

### Privacy

On-chain state should store controller public keys, status, and commitments. Plain names, personal identifiers, mandates, limits, and capability details remain off-chain in credentials and proof material.

## Backend Changes

The platform must store:

- account ID
- wallet address for UX/account linking
- wallet `ZswapCoinPublicKey` when available
- subject nonce per DID or agent slot
- derived DID key
- registry address
- request workflow state
- role grant/revoke tx references

API changes:

- add endpoint or UI flow to create a subject nonce for self-registration
- record self-registration tx hash and DID key
- map MCP/API agent requests to a registered controller DID
- expose role state and DID controller state in admin UI

## Frontend Changes

The DApp must:

- show connected wallet controller status
- let users self-register a DID slot
- display the derived DID after registration
- prevent self-service update attempts before registration
- show role state for the connected controller
- show clear errors for "DID not registered", "Caller is not DID controller", and "Missing role"

## Migration Plan

1. Keep the current `issuerSecret()` registry as legacy/dev.
2. Add the new controller-binding registry contract version.
3. Add tests for derived DID key registration and controller-only update.
4. Add admin bootstrap and role grant/revoke tests.
5. Update TypeScript SDK integration to use `self_register_did(subject_nonce)`.
6. Update DID construction from `agent-key` to `did-key`.
7. Add resolver support for the new registry state.
8. Add UI flows for self-registration and controller status.
9. Test Dust sponsorship and confirm `ownPublicKey()` remains the user key.
10. Mark the old local owner vault flow as deprecated for production.

## Verification Checklist

- `compact compile` succeeds for the new registry contract.
- Generated TypeScript types expose no required witnesses for self-registration.
- Self-registration stores `did_controller[did_key] = ownPublicKey()`.
- Same nonce from a different wallet yields a different DID key.
- Registered controller can request update.
- Different wallet cannot request update for that DID.
- Admin can issue registered DID.
- Non-admin cannot issue DID.
- Admin can grant another registered DID controller the `ADMIN` role.
- Admin can revoke roles without revoking the final active admin.
- Dust-sponsored registration preserves the user's `ownPublicKey()`.

## Open Decisions

- Whether the target registry allows one DID per wallet or multiple subject nonces per wallet by default.
- Whether `ISSUER` can issue/revoke directly or only certify capability commitments.
- Whether self-attested updates become active immediately or enter `pending_update`.
- Whether user-controlled revocation is immediate or requires admin/issuer confirmation.
