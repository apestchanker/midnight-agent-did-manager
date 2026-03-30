# did:midnight Method Specification

## Status

Local implementation specification for this repository.

This document defines how `did:midnight` identifiers are constructed, resolved, and validated in the current system. It is intended to be the method specification artifact for the implementation in this repo.

## Method Name

`midnight`

## Method Syntax

The method-specific identifier is:

```text
did:midnight:<network-id>:<contract-address>:<agent-key>
```

Example:

```text
did:midnight:preprod:8cbdec01cb6605a76d1588e13be40e57ff2eb4d77286751766772639babf8ed3:530e7c6b7387780a7d52d8c8c4d6fda1eaa4f7cc441a71d970ba62f76a989781
```

Components:

- `network-id`: Midnight network identifier such as `preprod`
- `contract-address`: deployed Midnight DID registry contract address
- `agent-key`: 32-byte hex identifier derived from the wallet address bound to the DID subject

## Method Operations

### Create

Creation is a two-step registry lifecycle:

1. The subject wallet requests a DID on the registry contract.
2. The issuer service approves and issues the DID on-chain.

The DID exists for resolution once the registry record reaches `active`.

### Update

Updates are also two-step:

1. The subject wallet requests an update on-chain.
2. The issuer approves and applies the update on-chain.

### Deactivate / Revoke

Revocation is two-step:

1. The subject wallet requests revocation on-chain.
2. The issuer approves revocation on-chain.

When revoked, the DID resolves with `didDocument: null` semantics for strict resolvers, or with registry metadata indicating deactivation for this implementation.

## Method-Specific State

Canonical state is stored on the Midnight registry contract:

- subject binding via `agent_key`
- issuance / update / revocation status
- DID commitment
- DID document commitment
- proof commitment
- optional organization disclosure state

No personal name is stored on-chain.

Organization may be stored on-chain only if the subject explicitly chooses disclosure. Otherwise it is represented as undisclosed.

## Resolution

Resolution is performed by:

1. Parsing the DID into `network-id`, `contract-address`, and `agent-key`
2. Looking up the DID record associated with the DID in the registry index
3. Returning a DID Resolution result with:
   - `didDocument`
   - `didDocumentMetadata`
   - `didResolutionMetadata`

The resolver endpoint in this implementation is:

```text
GET /api/dids/resolve?did=<did>
```

## DID Document Representation

The DID Document produced by this implementation contains:

- `@context`
- `id`
- `controller`
- `service`

The service section includes:

- a DID resolution endpoint
- a verifiable credential repository endpoint

If organization disclosure is enabled, the resolved document may also expose the organization value. Otherwise the resolver returns `undisclosed`.

## Control and Authorization

Control is modeled through the wallet bound to the DID subject and the issuer authority:

- the subject wallet can request issuance, updates, and revocation
- the issuer authority performs final issuance, update approval, and revocation approval

This implementation treats registry issuance authority as part of the method rules.

## Verification Semantics

A verifier validates a DID by:

1. Resolving the DID
2. Confirming the registry status is `active`
3. Checking issuer provenance if required by policy
4. Verifying any associated verifiable credentials independently

## Privacy Requirements

- Names remain off-chain
- Organization is disclosed on-chain only by subject choice
- Detailed profile claims are carried in verifiable credentials, not the registry
- Partial disclosure is achieved by presenting only selected credentials

## Verifiable Credentials

This method integrates with W3C Verifiable Credentials by issuing atomic credentials bound to the DID:

- ownership credential
- name credential
- organization credential

Selective disclosure is achieved by presenting only the credentials needed for a given interaction.

## Implementation Notes

- The Midnight contract is the source of truth for registry state
- The API/database layer indexes requests, issued records, and credentials
- The resolver and VC endpoints are implementation surfaces, not alternative sources of truth
