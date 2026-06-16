# did:midnight Method Specification

## Status

Local implementation specification for this repository.

This document defines how `did:midnight` identifiers are constructed, resolved, and validated in the current system. It is intended to be the method specification artifact for the implementation in this repo.

## Method Name

`midnight`

## Method Syntax

The method-specific identifier is:

```text
did:midnight:<network-id>:<contract-address>:<did-key>
```

Example:

```text
did:midnight:preprod:8cbdec01cb6605a76d1588e13be40e57ff2eb4d77286751766772639babf8ed3:530e7c6b7387780a7d52d8c8c4d6fda1eaa4f7cc441a71d970ba62f76a989781
```

Components:

- `network-id`: Midnight network identifier such as `preprod`
- `contract-address`: deployed Midnight DID registry contract address
- `did-key`: 32-byte hex identifier derived by the registry from the registry salt, the registering caller's `ZswapCoinPublicKey`, and a subject nonce

## Method Operations

### Create

Creation is a self-registration plus issuance lifecycle:

1. The subject wallet calls the registry from the wallet that will control the DID.
2. The registry derives the DID key from `ownPublicKey()` and stores `did_controller[did_key] = ownPublicKey()`.
3. The issuer or admin approves and issues the DID on-chain when certification is required.

The DID exists for resolution once the registry record reaches `active`.

### Update

Updates are also two-step:

1. The DID controller wallet requests an update on-chain.
2. The registry recomputes the DID key from `ownPublicKey()` and checks that the stored controller matches the caller.
3. Self-attested updates can be recorded directly as commitments; issuer-certified updates require issuer or admin approval.

### Deactivate / Revoke

Revocation is two-step:

1. The DID controller wallet requests revocation on-chain, or an admin or issuer performs a role-authorized revocation.
2. The registry records the revocation status and revocation commitment.

When revoked, the DID resolves with `didDocument: null` semantics for strict resolvers, or with registry metadata indicating deactivation for this implementation.

## Method-Specific State

Canonical state is stored on the Midnight registry contract:

- subject binding via `did_key`
- controller binding via `did_controller[did_key] = ZswapCoinPublicKey`
- role membership for admin, issuer, user, and agent authorities
- issuance / update / revocation status
- DID commitment
- DID document commitment
- proof commitment
- optional organization disclosure state

No personal name is stored on-chain.

Organization may be stored on-chain only if the subject explicitly chooses disclosure. Otherwise it is represented as undisclosed.

Mandates, limits, capabilities, authorization levels, and detailed Agent MultiPass policy data are not stored as plain on-chain state. They are represented as off-chain credentials, manifests, presentations, and proof commitments that can be selectively disclosed.

## Resolution

Resolution is performed by:

1. Parsing the DID into `network-id`, `contract-address`, and `did-key`
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

Control is modeled through the controller public key stored by the registry and role-gated issuer/admin authority:

- the subject controller can request self-service updates and controller-owned revocation flows
- the registry checks subject control by comparing `did_controller[did_key]` with `ownPublicKey()`
- admins can grant and revoke roles, issue DIDs, revoke DIDs, and grant additional admins
- issuers can perform configured issuance and certification actions

This implementation treats registry issuance authority as part of the method rules.

Agent MultiPass authorization is layered above the DID method. The DID proves the agent identity and registry status; associated credentials and presentations prove current mandates, limits, capabilities, authorization levels, and issuer/holder approval context.

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
- Mandates, limits, capabilities, and authorization levels are carried in verifiable credentials or proof material, not as plain registry state
- Partial disclosure is achieved by presenting only selected credentials

## Verifiable Credentials

This method integrates with W3C Verifiable Credentials by issuing atomic credentials bound to the DID.

Current MVP credential scopes include:

- ownership credential
- name credential
- organization credential

The Agent MultiPass extension path adds credentials such as:

- mandate credential
- capability credential
- limit credential
- authorization-level credential

Selective disclosure is achieved by presenting only the credentials needed for a given interaction.

## Implementation Notes

- The Midnight contract is the source of truth for registry state
- The API/database layer indexes requests, issued records, and credentials
- The resolver and VC endpoints are implementation surfaces, not alternative sources of truth
