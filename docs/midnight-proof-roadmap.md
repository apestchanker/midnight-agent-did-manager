# Midnight Holder-Proof Roadmap

## Goal

Move credential disclosure from "server-selected JWT VC bundles" to "holder-generated Midnight proofs against committed claims".

## Current State

- DID lifecycle is anchored on Midnight.
- Issued credentials are JWT VCs signed by the issuer.
- The service can assemble a W3C-shaped presentation bundle from selected credentials.
- The service now also emits commitment-based proof material:
  - per-credential commitment
  - bundle commitment
  - holder-binding commitment
  - verifier challenge

## Target State

1. Holder requests proof material for selected scopes.
2. Holder wallet or local proof server generates a Midnight proof over:
   - the disclosed credential commitments
   - the verifier challenge
   - the holder DID binding
3. Verifier checks:
   - DID active status on Midnight
   - issuer signature validity on underlying credentials
   - Midnight proof validity against the returned commitments

## Implementation Phases

### Phase 1

- Commitment-backed proof material API and MCP discovery
- UI support to inspect the proving boundary
- Tests around deterministic commitment generation

### Phase 2

- Dedicated proof request / proof submission objects
- Verifier-side proof verification endpoint
- Wallet-facing integration point for local proof generation

### Phase 3

- Native Midnight holder circuit integration
- Revocation-aware verifier policy
- Production hardening, authz tightening, and custody separation
