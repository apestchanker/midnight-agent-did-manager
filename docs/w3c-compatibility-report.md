# W3C Compatibility Report

## Why W3C and not a custom identity scheme

Traditional identity systems are silos. Every time a verifier needs to confirm a claim, it must contact the original issuer — the issuer must be online, cooperative, and trusted. That creates a runtime dependency on a centralised authority.

W3C DID Core and the Verifiable Credentials Data Model break that dependency by design:

- A **DID** is an identifier whose subject controls it. Its validity is anchored in a decentralised registry (in this case, the Midnight Compact contract), not in any organisation's database.
- A **Verifiable Credential** carries a cryptographic signature from the issuer. Any verifier can check that signature offline using the issuer's public key. The issuer does not need to be reachable at verification time.
- **Interoperability** follows from the standard. Any system that understands W3C DIDs can resolve a `did:midnight:...` identifier and parse credentials from this implementation without bespoke integration work.

Without these standards, this implementation would be a Midnight-only silo. With them, agent identities issued here are legible to the broader SSI (Self-Sovereign Identity) ecosystem.

## Implemented

### DID Core aligned pieces

- DID identifiers are emitted in `did:midnight:<network>:<contract>:<agentKey>` form
- DID resolution endpoint returns:
  - `didDocument`
  - `didDocumentMetadata`
  - `didResolutionMetadata`
- DID document contains:
  - `@context`
  - `id`
  - `controller`
  - `service`

### VC Data Model aligned pieces

- Verifiable Credentials are issued as JWT VCs
- VC payload contains:
  - `@context`
  - `type`
  - `issuer`
  - `credentialSubject`
- The implementation issues atomic credentials for:
  - DID ownership
  - profile name
  - organization
- Partial disclosure is achieved by selective presentation of separate credentials

### Registry semantics

- public registry validation
- issuer-controlled issuance
- subject-initiated request / update request / revoke request
- issuer-controlled approval and final on-chain state changes

## Method Specification

This repository now includes a local method specification document:

- [`docs/did-midnight-method.md`](./did-midnight-method.md)

That closes the previous gap inside the repository itself: the method syntax, lifecycle rules, privacy model, and resolution rules are now written down as a method specification artifact.

## Important Clarification

This repo now implements practical W3C-compatible DID/VC behavior for testing and integration, including:

- a DID method specification artifact
- DID Resolution result objects
- JWT Verifiable Credentials
- W3C-shaped Verifiable Presentations built from selected credentials

However, "full W3C compatibility" in the strictest sense would also require:

- resolver conformance validation against DID method expectations
- production governance for issuer identifiers and public verification keys
- holder-bound presentation proofs if you want cryptographically strong presentation signing by the subject instead of server-side VC selection
