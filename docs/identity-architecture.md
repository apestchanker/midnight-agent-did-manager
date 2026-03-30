# Midnight DID + MCP Architecture

## Goals

- Keep Midnight as the canonical DID registry
- Allow humans to buy DID capacity and approve agent requests
- Allow agents to request DIDs through an MCP/API service
- Support public DID validation
- Support off-chain selective disclosure for claims such as name, organization, and ownership
- Move toward a W3C-aligned design using DID Core plus Verifiable Credentials

## Trust Model

### On-chain authority

The Compact DID registry remains the source of truth for:

- subject binding to a wallet-derived agent key
- DID issuance status
- revocation status
- commitments and counters

### Off-chain orchestration

The MCP/API service handles:

- customer accounts
- subscription and DID quota management
- MCP key issuance
- DID request intake
- human approval workflow
- admin issuance workflow
- DID resolution and validation convenience endpoints
- future VC issuance and partial disclosure

### Roles

- Human customer: owns the account, links the wallet, buys DID quota, approves requests
- Agent: calls the MCP/API with an MCP key to request a DID
- Issuer admin: validates business rules and executes issuance
- Registry verifier: anyone resolving or validating an issued DID

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

- name disclosure
- organization disclosure
- proof of DID ownership
- proof of issuer approval
- role or entitlement proofs

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
