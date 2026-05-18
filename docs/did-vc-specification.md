# DID and VC Specification

## Scope

This document defines the practical DID and Verifiable Credential behavior implemented by this repository.

It is an implementation specification for this codebase, not a formal standards-track specification.

## System Roles

- `Holder`: the wallet controller that owns or controls the DID subject context
- `Issuer`: the registry issuer authority that issues, updates, and revokes DIDs and signs JWT VCs
- `Admin`: the operational registry authority that processes approved DID requests on-chain
- `Verifier`: any third party that resolves a DID, validates its status, verifies JWT VCs, or validates a proof package
- `Agent`: software acting on behalf of the holder through MCP or API flows

## DID Model

### DID Syntax

The repository emits DIDs in this form:

```text
did:midnight:<network-id>:<contract-address>:<agent-key>
```

Where:

- `network-id` is the Midnight network segment used by the app
- `contract-address` is the deployed DID registry Compact contract address
- `agent-key` is the subject identifier bound to the DID within that registry

### DID Field Table

| Field | Location | Type | Description |
| --- | --- | --- | --- |
| `method` | DID string | string | Always `midnight` in this implementation. |
| `network-id` | DID string | string | Midnight network identifier such as `preprod`. |
| `contract-address` | DID string | string | Registry Compact contract address anchoring the DID. |
| `agent-key` | DID string | hex string | Subject key segment used to identify the DID within the registry. |
| `agent_id` | Off-chain request / DB | string | Internal unique subject identifier used by the application schema. |
| `subject_wallet_address` | Off-chain request / DB / VC claim | string | Holder-controlled wallet associated with the DID subject. |

### DID State

A DID record is modeled with these operational states:

- `requested`
- `pending_human_approval`
- `pending_admin_review`
- `active`
- `revoked`

The canonical public status of an issued DID is anchored by the Midnight registry contract and reflected through the resolver and service API.

### DID State Table

| State | Meaning | Typical Origin |
| --- | --- | --- |
| `requested` | A request object exists but has not entered the full review flow yet. | Direct user flow / internal workflow state |
| `pending_human_approval` | The request exists but the holder has not approved it yet. | MCP / API / proof workflow |
| `pending_admin_review` | The holder-approved request is ready for issuer/admin processing. | DID request workflow |
| `active` | The DID is issued and resolves as active. | On-chain registry state |
| `revoked` | The DID was deactivated / revoked and should not validate as active. | On-chain registry state |

### DID Resolution

A resolver for this implementation must:

1. Parse the DID into method, network, contract address, and agent key.
2. Resolve the DID record associated with that identifier.
3. Return a DID Resolution result containing:
   - DID document metadata
   - DID document, when active
   - DID resolution metadata

### DID Document Shape

The DID document produced by this implementation contains:

- `id`
- `controller`
- verification material derived from the registry issuer / holder context
- service endpoints, including:
  - DID resolution endpoint
  - VC repository or retrieval endpoint

The implementation may also include registry-specific metadata useful for testing and integration.

### DID Document Field Table

| Field | Type | Description |
| --- | --- | --- |
| `@context` | array or string | DID Core context and any implementation-required context entries. |
| `id` | string | The resolved `did:midnight:...` identifier. |
| `controller` | string or array | Controller reference associated with the DID subject model. |
| `service` | array | Service endpoints exposed for resolver and credential access. |
| `service[].id` | string | Service identifier inside the DID document. |
| `service[].type` | string | Service type such as resolution or credential repository. |
| `service[].serviceEndpoint` | string or object | Endpoint URL or object describing the integration endpoint. |
| `organization` | string or `undisclosed` | Optional implementation metadata when organization disclosure is enabled. |

## DID Request Model

### Human Flow

In the direct user flow:

1. The holder selects or creates an agent in the UI.
2. The holder submits a DID request.
3. The request is registered on-chain.
4. Admin issues the DID.
5. The resulting DID becomes resolvable and active.

### Agent Flow

In the MCP or API flow:

1. An agent calls the service using an MCP key.
2. The request is stored as `pending_human_approval`.
3. The holder approves the request.
4. The holder-side approval registers the request on-chain.
5. Admin issues the DID.
6. The DID becomes active and available for resolution and VC issuance.

### DID Request Field Table

| Field | Type | Description |
| --- | --- | --- |
| `id` | UUID | Internal request identifier. |
| `customer_id` | UUID | Customer account that owns the request context. |
| `agent_id` | string | Internal unique identifier of the requested agent subject. |
| `subject_wallet_address` | string | Wallet bound to the DID subject. |
| `requester_wallet_address` | string | Wallet that initiated the request. |
| `contract_address` | string | Registry contract address the request targets. |
| `request_status` | enum | Workflow status such as `pending_human_approval` or `pending_admin_review`. |
| `did` / `requested_did` | string | DID identifier associated with the request. |
| `did_document` | JSON/string | Off-chain DID document payload submitted for issuance or update. |
| `request_commitment` | hex string | Commitment representing the request boundary. |
| `proof_commitment` | hex string | Commitment associated with proof-related request content. |
| `human_approved_at` | timestamp | When the holder approved the request. |
| `human_approved_by_wallet` | string | Wallet used to approve the request. |
| `onchain_request_tx_hash` | hex string | On-chain transaction reference for request registration. |
| `onchain_issue_tx_hash` | hex string | On-chain transaction reference for final issuance. |

## Identifier Binding

### Subject Binding

This repository treats the agent subject as a distinct identity within the holder context.

- `agent_id` is the internal unique subject identifier used by the new schema
- wallet address is a linked control / ownership attribute, not the sole identity key

This separation is required so multiple agents may exist under the same holder wallet without collapsing into the same off-chain subject record.

### Holder Wallet

The holder wallet remains important because it is used for:

- DID request authorization
- wallet-bound proof approval
- ownership credential content
- linked account and customer workflows

### Identity Binding Table

| Field | Role | Why It Exists |
| --- | --- | --- |
| `agent_id` | Internal subject identity | Distinguishes multiple agents under the same holder wallet. |
| `agent-key` | DID segment / registry identity | Identifies the DID inside a specific contract registry. |
| `subject_wallet_address` | Control / ownership link | Connects the DID subject to the controlling wallet. |
| `customer_wallet` | Account ownership link | Connects the application account to the human holder. |

## Verifiable Credential Model

### Why credentials are issued as separate atomic units

This implementation issues one credential per disclosure scope (`ownership`, `name`, `organization`) rather than a single combined credential. The reason is selective disclosure.

If all claims were bundled into one credential, a holder would have to reveal all of them or none of them every time they present proof. Atomic credentials let the holder choose exactly which facts to disclose for each interaction: an agent can prove it owns a DID without revealing its name, and can reveal its name without exposing its organisation affiliation. The verifier receives only what is necessary; everything else stays private.

This is why the presentation layer assembles a subset of the available credentials rather than forwarding the full credential set.

### Current VC Format

The repository currently issues JWT-based Verifiable Credentials signed by the issuer service.

These are W3C-shaped JWT VCs, intended for practical interoperability and testing.

### Current Credential Types

The implementation currently issues atomic credentials such as:

- ownership credential
- name disclosure credential
- organization disclosure credential, when enabled

The exact active set depends on DID issuance state and disclosure options.

### Credential Binding

Each VC is bound to:

- the DID subject
- the registry contract context
- issuer signing authority

The VC subject must resolve to the same DID that the credential claims to describe.

### VC Field Table

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Credential identifier, typically service-generated. |
| `format` | string | Current implementation uses JWT VC packaging. |
| `issuer` / `iss` | string | Issuer DID or issuer identifier used to sign the VC. |
| `sub` | string | DID subject of the credential. |
| `vc.@context` | array | W3C VC context entries. |
| `vc.type` | array | VC type set including atomic credential type. |
| `vc.credentialSubject.id` | string | DID subject identifier. |
| `vc.credentialSubject` | object | Atomic subject claims carried by that VC. |
| `scope` | string | Application disclosure scope such as `ownership`, `name`, or `organization`. |
| `status` | enum | Off-chain lifecycle status such as active or revoked. |
| `jwt` | string | Signed JWT VC string delivered to clients and verifiers. |

### Current Atomic Credential Types

| Credential Type | Scope | Main Claims |
| --- | --- | --- |
| `AgentDidOwnershipCredential` | `ownership` | `agentKey`, `contractAddress`, `networkId`, `registryStatus`, `walletAddress` |
| `AgentProfileNameCredential` | `name` | agent profile name disclosure claims |
| `AgentOrganizationCredential` | `organization` | organization disclosure claims, when enabled |

## VC Verification

### Why verifiers can validate without contacting the issuer

In traditional credential systems the verifier must call the issuer at verification time to confirm that a credential is still valid. The issuer becomes a runtime bottleneck and a single point of failure.

JWT-based Verifiable Credentials break this dependency. The issuer signs the credential with a private key. The verifier obtains the issuer's public key once (from the issuer descriptor endpoint) and can then validate any credential signed by that key independently, at any time, without the issuer being available. DID status is the one live check — the verifier resolves the DID against the Midnight registry to confirm it has not been revoked. That check goes to the on-chain registry, not to the issuing service. The issuing service is therefore not in the critical path for verification.

### Offline JWT Verification

A verifier can validate a JWT VC offline by:

1. Obtaining the VC JWT.
2. Obtaining the issuer public JWK from the issuer descriptor endpoint.
3. Verifying the JWT signature.
4. Checking that:
   - `iss` matches the issuer
   - `sub` matches the DID holder
   - `vc.credentialSubject.id` matches the same DID
5. Resolving or validating the DID to confirm it remains active.

Offline JWT verification proves issuer signature validity.
It does not by itself prove current DID status unless DID status is also checked against the registry.

### Offline Verification Inputs

| Input | Source | Purpose |
| --- | --- | --- |
| VC JWT | VC endpoint / holder export | Signed credential to be checked. |
| Issuer JWK | issuer descriptor endpoint | Public key for JWT verification. |
| DID | VC `sub` / `credentialSubject.id` | DID status and binding check. |
| DID resolver result | resolver / validate endpoint | Confirms DID remains active. |

## Midnight Proof Model

### Why holder binding is needed

An issuer-signed JWT Verifiable Credential proves that the issuer made a claim. It does not prove that the entity presenting it is the legitimate holder. Anyone who obtains a JWT — whether through theft, a man-in-the-middle, or a compromised transport layer — could replay it as if they were the credential subject.

Holder binding closes this gap. The holder constructs a proof that ties three things together: the DID being proven, a fresh challenge issued by the verifier, and the set of credentials being disclosed. Because the challenge is a single-use nonce generated per verification session, a captured proof cannot be replayed in a different session. The `holderBindingCommitment` is the cryptographic link between all three elements. The verifier checks that the commitment matches the challenge it issued, confirming that the proof was constructed for this specific interaction, by the entity that controls the DID private state — not by someone who only holds the JWT.

### Proof Material

For selected disclosure scopes, the service derives proof material containing:

- per-credential commitments
- a bundle commitment
- a holder-binding commitment
- verifier challenge binding

This material defines the disclosure boundary that a holder proof must satisfy.

### Proof Material Field Table

| Field | Type | Description |
| --- | --- | --- |
| `did` | string | DID being proven. |
| `holder` | string | Holder DID reference, usually same DID in current flow. |
| `network` | string | Midnight network context. |
| `purpose` | string | Disclosure purpose such as `selective-disclosure`. |
| `challenge` | UUID/string | Anti-replay verifier challenge. |
| `proofType` | string | Proof material strategy identifier. |
| `credentialCount` | number | Number of credentials used in the proof boundary. |
| `disclosedScopes` | string[] | Scopes intentionally disclosed for this proof. |
| `bundleCommitment` | hex string | Commitment over the disclosure bundle. |
| `holderBindingCommitment` | hex string | Commitment that binds DID, challenge, and bundle. |
| `credentialCommitments` | array | Per-credential commitments used in the proof material. |
| `nativeOwnership` | object | Additional native Midnight ownership proof inputs, when available. |

### Proof Request Field Table

| Field | Type | Description |
| --- | --- | --- |
| `requestId` | UUID | Proof request identifier. |
| `createdAt` | timestamp | Creation time of the proof request. |
| `expiresAt` | timestamp | Expiry time for proof generation / verification policy. |
| `proofRequestType` | string | Proof request type identifier. |
| `material` | object | Structured proof material used for proving and verifying. |
| `instructions` | string[] | Operational instructions for holder-side proof generation. |

### Wallet-Bound Approval

Before proof submission, the holder approves the proof request with the connected wallet.

That approval binds:

- the DID
- the selected scopes
- the verifier challenge
- the holder wallet context

### Holder Approval Field Table

| Field | Type | Description |
| --- | --- | --- |
| `approval_payload` | string / JSON string | Canonical payload the wallet signs to authorize the proof request. |
| `holderSignature.signature` | hex string | Wallet signature over the approval payload. |
| `holderSignature.verifyingKey` | hex string | Wallet-provided verifying key used for signature validation and wallet binding. |
| `holder_wallet` | string | Wallet expected to control and approve the DID proof request. |

### Verification Package

The verification payload used by the registry verifier is a JSON package containing:

- `proofRequest`
- `submission`

That package is what a third party should receive for verification.

Hashes shown in the UI, such as bundle commitments or holder-binding commitments, are public verification components, but they are not the full proof package by themselves.

### Verification Package Field Table

| Field | Type | Description |
| --- | --- | --- |
| `proofRequest` | object | The approved proof request object. |
| `submission` | object | The proof submission presented for verification. |
| `submission.did` | string | DID the proof is about. |
| `submission.challenge` | string | Challenge echoed back into the submission. |
| `submission.bundleCommitment` | hex string | Bundle commitment used by the proof. |
| `submission.holderBindingCommitment` | hex string | Holder-binding commitment used by the proof. |
| `submission.proof` | object | Actual proof envelope or native proof payload. |
| `submission.proof.format` | string | Proof format, such as preview envelope or native Midnight proof. |
| `submission.proof.scheme` | string | Scheme identifier for the proof mode. |
| `submission.proof.proofValue` | string | Proof bytes, preview digest, or other scheme-specific proof value. |
| `submission.proof.publicInputsHash` | hex string | Hash of the public verification inputs. |
| `submission.proof.generatedBy` | string | Origin of the generated proof, such as wallet prover or preview local generator. |
| `submission.proof.generatedAt` | timestamp | Proof generation timestamp. |

## Native vs Preview Proofs

### Preview Envelope

The repository can generate a preview verification envelope that proves:

- request integrity
- submission integrity
- holder approval integrity
- issuer JWT VC integrity

This is useful for testing the workflow end to end, but it is not yet equivalent to a final native Midnight zero-knowledge proof.

### Native Ownership Proof

The repository also includes a separate Compact proof artifact for native ownership proof generation:

- `native-ownership-proof`

This artifact is intended to support native Midnight proving over ownership disclosure statements, separate from the DID registry state-transition contract.

In the current repository state, the native ownership path is live for:

- holder-side native ownership proof generation
- persisted proof submission packages
- verifier-side DID status checks
- issuer JWT verification
- statement-boundary reconstruction
- reconstructed public-input matching
- circuit check through the configured proof server

It does not yet claim canonical standalone verification of an externally supplied `proofValue` blob independent of that boundary reconstruction path.

### Proof Mode Comparison

| Mode | Status Example | What It Proves | Limitation |
| --- | --- | --- | --- |
| `preview` | `preview_envelope_verified` | Request integrity, holder approval integrity, issuer JWT integrity, proof package consistency | Not a final native Midnight ZK proof |
| `native` | `native_proof_verified` | Native ownership statement boundary verified, public inputs reconstructed and matched, DID/issuer checks passed, native circuit check path succeeded | Does not yet claim canonical verifier-side validation of an arbitrary external proof blob as a standalone artifact |

### Current Native Verification Semantics

When `native_proof_verified` is returned, the repository has verified that:

1. the DID is active
2. the issuer-signed ownership credential is valid
3. the proof request and submission match the expected native ownership statement
4. the reconstructed native public inputs match the submitted package
5. the configured proof-server check path succeeds for that circuit boundary

This is a real cryptographic and circuit-bound validation of the statement.

It is stronger than preview-envelope validation, but it is still narrower than a future canonical external-proof-blob verifier.

### Intended Native Target

The long-term target is:

1. holder wallet or trusted local proof server generates a real Midnight proof
2. the proof is submitted as part of the verification package
3. the verifier checks that exact external proof artifact cryptographically through a canonical standalone proof verifier

When that path is fully active, native verification will be able to claim both statement/circuit correctness and canonical external proof-blob validation.

## MCP and API Relationship

The MCP server and local API are orchestration and integration layers for:

- DID request submission
- DID status polling
- DID resolution
- credential retrieval
- proof request workflows
- proof verification

They are not the canonical DID registry of record.

The Midnight registry contract remains the authoritative public anchor for DID existence and lifecycle state.

## Production Boundary

This repository currently provides:

- a working DID registry flow
- issuer-signed JWT VCs
- proof-request workflows
- preview verification packages
- a working native ownership proof path with statement-boundary and circuit-check validation

It does not yet represent a hardened production identity system.

Production deployments should additionally define:

- hardened key custody
- holder-side trusted proving strategy
- native proof verification policy
- canonical external proof-artifact verification policy
- secure secret management
- operational audit and retention controls

## JSON Examples

### Example DID Resolution Result

```json
{
  "didDocument": {
    "@context": ["https://www.w3.org/ns/did/v1"],
    "id": "did:midnight:preprod:e1ac700bb7bd7b2f865dba391d7a6c57ea52d6d28a4e31a424fa18c48a47b740:a4c4019ae7af5b820ee959d1961f95fd2c78c40e03f0e7a52e05286669183bba",
    "controller": "did:midnight:preprod:e1ac700bb7bd7b2f865dba391d7a6c57ea52d6d28a4e31a424fa18c48a47b740:a4c4019ae7af5b820ee959d1961f95fd2c78c40e03f0e7a52e05286669183bba",
    "service": [
      {
        "id": "#resolver",
        "type": "DIDResolution",
        "serviceEndpoint": "http://localhost:8787/api/dids/resolve?did=did%3Amidnight%3Apreprod%3Ae1ac700bb7bd7b2f865dba391d7a6c57ea52d6d28a4e31a424fa18c48a47b740%3Aa4c4019ae7af5b820ee959d1961f95fd2c78c40e03f0e7a52e05286669183bba"
      },
      {
        "id": "#vc-repository",
        "type": "VerifiableCredentialRepository",
        "serviceEndpoint": "http://localhost:8787/api/vcs?did=did%3Amidnight%3Apreprod%3Ae1ac700bb7bd7b2f865dba391d7a6c57ea52d6d28a4e31a424fa18c48a47b740%3Aa4c4019ae7af5b820ee959d1961f95fd2c78c40e03f0e7a52e05286669183bba"
      }
    ]
  },
  "didDocumentMetadata": {
    "status": "active",
    "network": "preprod",
    "contractAddress": "e1ac700bb7bd7b2f865dba391d7a6c57ea52d6d28a4e31a424fa18c48a47b740",
    "organization": "undisclosed"
  },
  "didResolutionMetadata": {}
}
```

### Example Proof Verification Package

```json
{
  "proofRequest": {
    "requestId": "b9ad344a-ae85-4b7c-8595-3d7c6cd0e3c9",
    "createdAt": "2026-04-07T20:16:07.675Z",
    "expiresAt": "2026-04-07T20:16:11.686Z",
    "proofRequestType": "midnight-holder-proof-request",
    "material": {
      "did": "did:midnight:preprod:e1ac700bb7bd7b2f865dba391d7a6c57ea52d6d28a4e31a424fa18c48a47b740:a4c4019ae7af5b820ee959d1961f95fd2c78c40e03f0e7a52e05286669183bba",
      "holder": "did:midnight:preprod:e1ac700bb7bd7b2f865dba391d7a6c57ea52d6d28a4e31a424fa18c48a47b740:a4c4019ae7af5b820ee959d1961f95fd2c78c40e03f0e7a52e05286669183bba",
      "network": "midnight",
      "purpose": "selective-disclosure",
      "challenge": "4ecaa8db-ed44-42ee-976d-d854707c4f24",
      "proofType": "midnight-credential-commitment",
      "credentialCount": 1,
      "disclosedScopes": ["ownership"],
      "bundleCommitment": "360f959e093f6bb344b8589678c37d310aef791634eeed6ba100aa0a13707e3d",
      "holderBindingCommitment": "5375accc8f5916090aedc9b4855148286c220975f1fd6d78fb5314624f6e8016",
      "credentialCommitments": [
        {
          "scope": "ownership",
          "claimKeys": [
            "agentKey",
            "contractAddress",
            "networkId",
            "registryStatus",
            "walletAddress"
          ],
          "commitment": "f9f9f8e8a469e57d3b451d1e0129b479eb7599fae044585ab106b4f2566f6958",
          "credentialType": "AgentDidOwnershipCredential"
        }
      ]
    },
    "instructions": [
      "Generate the final holder proof locally in the wallet or a trusted local proof server.",
      "Bind the proof to the provided challenge and holder binding commitment.",
      "Submit the resulting proof envelope together with this proof request for verification."
    ]
  },
  "submission": {
    "did": "did:midnight:preprod:e1ac700bb7bd7b2f865dba391d7a6c57ea52d6d28a4e31a424fa18c48a47b740:a4c4019ae7af5b820ee959d1961f95fd2c78c40e03f0e7a52e05286669183bba",
    "challenge": "4ecaa8db-ed44-42ee-976d-d854707c4f24",
    "bundleCommitment": "360f959e093f6bb344b8589678c37d310aef791634eeed6ba100aa0a13707e3d",
    "holderBindingCommitment": "5375accc8f5916090aedc9b4855148286c220975f1fd6d78fb5314624f6e8016",
    "proof": {
      "format": "midnight-proof-envelope-v1",
      "scheme": "preview-local-binding-v1",
      "proofValue": "d0f144a21b2982f73b3c5e2011a36630e948f8fffb3cbb33ccf3d5a718eecc17",
      "publicInputsHash": "08192fe01fe025123d63558609ac4826a2ad49640bc04250b8d066c3dd34cd21",
      "generatedBy": "browser-local-preview-prover",
      "generatedAt": "2026-04-09T13:54:29.859Z"
    }
  }
}
```
