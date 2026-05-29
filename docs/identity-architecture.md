# Midnight DID + MCP Architecture

## Goals

- Keep Midnight as the canonical DID registry
- Allow humans to buy DID capacity and approve agent requests
- Allow agents to request DIDs through an MCP/API service
- Support public DID validation
- Support Agent MultiPass flows: verifiable agent identity plus human-approved mandates, limits, capabilities, authorization levels, status, and selective disclosure
- Support off-chain selective disclosure for claims such as ownership, name, organization, mandate, limit, capability, and authorization level
- Move toward a W3C-aligned design using DID Core plus Verifiable Credentials

## Trust Model

### The trust triangle: Holder, Issuer, Verifier

All credential-based identity systems involve three roles. Understanding how they relate explains why the system is designed the way it is.

The **Issuer** makes claims about a subject and signs them cryptographically. In this implementation, the issuer service signs JWT Verifiable Credentials after the on-chain issuance is approved.

The **Holder** is the entity the credentials are about. The holder stores credentials, decides which ones to present for a given interaction, and constructs holder-binding proofs that prevent credential theft and replay. In this implementation, the holder is the agent whose DID is registered.

The **Verifier** is any third party that needs to confirm a claim. The verifier resolves the DID against the on-chain registry and checks the issuer signature on any presented credential. Critically, the verifier does this independently — it does not need to ask the issuer for permission or confirmation at runtime.

This separation means the issuer is only in the critical path at issuance time, not at verification time. The on-chain registry is the live authority for DID status. The issuer's public key is the live authority for credential signature validity. Everything else is checkable offline.

### On-chain authority

The Compact DID registry remains the source of truth for:

- subject binding to a wallet-derived agent key
- DID issuance status
- revocation status
- commitments and counters

The registry is the public identity and status anchor. It is not intended to store the full Agent MultiPass payload. Detailed mandates, limits, capabilities, authorization levels, and profile claims remain off-chain and are disclosed through credentials, presentations, and proof material.

### Off-chain orchestration

The MCP/API service handles:

- customer accounts
- subscription and DID quota management
- MCP key issuance
- DID request intake
- human approval workflow
- admin issuance workflow
- DID resolution and validation convenience endpoints
- VC issuance and current partial disclosure bundles
- Agent MultiPass claim manifests for current and future mandate, limit, capability, and authorization-level scopes
- commitment package generation for future holder-side Midnight proofs

### Roles

- Human customer: owns the account, links the wallet, buys DID quota, approves requests
- Agent: calls the MCP/API with an MCP key to request a DID
- Issuer admin: validates business rules and executes issuance
- Registry verifier: anyone resolving or validating an issued DID
- Hosted platform / certification operator: possible future managed role that issues, validates, monitors, and revokes Agent MultiPass credentials for teams that do not operate the stack themselves

## W3C Alignment

### DID Core

The long-term target is a `did:midnight` DID method with:

- method-specific DID syntax
- deterministic DID resolution from registry state
- DID document generation
- update / revoke semantics

### Verifiable Credentials

Selective disclosure should not be implemented by overloading the DID document alone.
Use VCs and Verifiable Presentations for:

- Agent MultiPass proof of current authority
- name disclosure
- organization disclosure
- proof of DID ownership
- proof of issuer approval
- mandate, limit, capability, authorization-level, role, or entitlement proofs

The current repo issues JWT VCs, but the Midnight-centered target is:

- derive commitment packages from disclosed credentials
- bind the proof request to a verifier challenge and the holder DID
- generate the final selective-disclosure proof in the holder wallet or local proof server
- verify DID status on Midnight plus issuer signatures and the holder proof

Current implementation note:

- the repository now supports a live native ownership proof path
- verifier-side validation currently confirms the ownership statement boundary, reconstructed public inputs, and proof-server circuit check
- it does not yet claim canonical standalone verification of an arbitrary external proof blob independent of that boundary path

## Data Handling

### On-chain

Keep only:

- DID binding
- subject wallet-derived key
- DID status
- commitments
- optional organization disclosure flag / commitment

### Off-chain

Store in Postgres:

- human account profile
- MCP keys
- subscription state
- request workflow state
- DID document payload
- claims manifests
- presentation templates
- mandate, limit, capability, and authorization-level templates or manifests

## Workflow

1. Human creates an account and links a wallet.
2. Human buys a DID plan or DID bundle.
3. System issues an MCP key for that customer.
4. Agent calls `POST /api/agent/did-requests` with the MCP key.
5. Request appears in the human dashboard as pending approval.
6. Human approves the request with the linked wallet.
7. Admin validates:
   - customer account active
   - DID quota remaining
   - valid MCP key used
   - subject wallet and request consistency
8. Admin issues the DID on Midnight and records the tx references.
9. Agent polls for request status or DID resolution.
10. Future updates and revocations follow the same human-request + admin-approval pattern.

## Partial Disclosure Model

The API stores:

- `did_document`: canonical off-chain representation associated with the DID
- `claims_manifest`: which claims can be presented
- `selective_disclosure_template`: what kinds of selective proofs the agent can request

Examples:

- ownership-only proof
- name-only proof
- organization-only proof
- mandate-only proof
- capability or limit proof
- authorization-level proof
- Agent MultiPass proof bundle
- full verified profile

## Local Development Stack

- Postgres via Docker Compose
- Node API server in `server/`
- React DApp for on-chain interaction and human approval UX

## Current Backend Surface

- `POST /api/customers`
- `POST /api/customers/:id/wallets`
- `POST /api/customers/:id/subscriptions`
- `POST /api/customers/:id/mcp-keys`
- `POST /api/agent/did-requests`
- `GET /api/did-requests`
- `GET /api/did-requests/:id`
- `POST /api/human/did-requests/:id/approve`
- `POST /api/human/did-requests/:id/reject`
- `POST /api/admin/did-requests/:id/issue`
- `POST /api/admin/did-requests/:id/reject`
- `GET /api/dids/resolve?did=...`
- `GET /api/dids/validate?did=...`

## Important Boundary

This backend now models the workflow and persists state in Postgres, but it does not yet sign Midnight transactions by itself. The current issuer issuance endpoint expects the caller to provide the resulting on-chain tx identifiers after the real issuance transaction is executed.

The next backend milestone is integrating the issuer-side Midnight transaction execution directly into the admin issuance path.
