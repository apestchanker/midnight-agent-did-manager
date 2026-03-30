# W3C Compatibility Report

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
