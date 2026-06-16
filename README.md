# Midnight Agent DID Manager

Midnight Agent DID Manager is a React + Vite application plus a local Node/Postgres service for managing a Compact DID registry on Midnight Network (Preprod or Preview).

This repository is an open-source research project focused on Agentic-DIDs: privacy-preserving identity and mandate flows for AI agents. The product direction is an Agent MultiPass: a verifiable agent pass that combines stable agent identity, human or organizational control, valid mandates, limits, capabilities, authorization levels, status, and selective disclosure credentials. Midnight is used as the privacy-first blockchain substrate for DID lifecycle state, commitments, and proof-oriented workflows.

## Non-Production Warning

This version is still NOT HARDENED to facilitate testing and debugging.

IT SHALL NOT USE NOR IT IS INTENDED FOR PRODUCTION USAGE.

If you want to read more about what inspired me to build this repo, - Article: [Selective Disclosure & Self-Managing DIDs for AI Agents](https://dev.to/midnight-aliit/selective-disclosure-self-managing-dids-for-ai-agents-3kcl)

## Project Metadata

- Contribution guidelines: [CONTRIBUTING.md](./CONTRIBUTING.md)
- Repository licensing: [LICENSING.md](./LICENSING.md)
- Intended open-source license model: Apache-2.0 with preservation of attribution, license text, and notices

The project supports:

- real 1AM wallet connection on Midnight Preprod
- real Compact contract deployment and interaction through the Midnight SDK
- DID request, issue, update, and revoke flows
- a Postgres-backed service for customer accounts, MCP keys, request persistence, DID records, and credentials
- user, admin, and public registry views in the UI
- W3C-aligned DID resolution and JWT Verifiable Credentials
- commitment-based Midnight proof material for holder-side selective disclosure
- native Midnight ownership proof generation through the wallet or configured proof server

The current MVP implements the identity, ownership, status, resolver, credential, and proof foundations. The Agent MultiPass direction extends these foundations with first-class mandate, limit, capability, and authorization-level credentials and proofs.

The open-source implementation can be self-hosted. A possible hosted-platform direction is to operate issuance, validation, revocation, monitoring, and policy templates as a managed service or trusted certification layer for teams that do not want to run the full stack themselves.

## Research Status and Disclaimer

This repository is provided as a research and experimentation project for Agent MultiPass, DID workflows, registry models, and credential flows for agents on Midnight.

It is not provided as legal advice, compliance advice, identity assurance, production security certification, or fitness-for-purpose assurance.

By using, modifying, deploying, or relying on this repository, you accept that:

- all use is at your own risk
- all operational, legal, regulatory, financial, security, and integration outcomes are your responsibility
- you must independently validate suitability for your jurisdiction, product, users, and threat model
- you must independently review all smart contract, wallet, infrastructure, database, and credential behavior before production use

The author and contributors disclaim responsibility and liability, to the maximum extent permitted by applicable law, for direct, indirect, incidental, consequential, special, regulatory, civil, criminal, contractual, tort, or other damages, claims, losses, or outcomes arising from use of this repository or reliance on its behavior, documentation, or examples.

## Agent Identity Flow

```mermaid
flowchart TD
    HU(["👤 Human User / Agent Operator\n─────────────────────────────\nhuman-managed account\nor agent with wallet-controlled key"])

    FE["🖥️ React Frontend — DApp\n─────────────────────────────\n• connect 1AM wallet\n• self-register DID · issue · update · revoke\n• user · admin · registry views"]

    DS["🗄️ DID Service + Postgres\n─────────────────────────────\n• accounts and MCP keys\n• request persistence\n• approvals and DID records\n• VC issuance and resolution"]

    WP["🔐 1AM Wallet + Proof Server\n─────────────────────────────\n• ownPublicKey() controller binding\n• signatures and proof flow\n• transaction submission"]

    CC["⛓️ Midnight Compact Contract\n─────────────────────────────\n• DID registry of record\n• commitments and party_status\n• role_by_key · ADMIN · ISSUER\n• controller binding via ownPublicKey()"]

    MN["🌐 Midnight Preprod + Indexer\n─────────────────────────────\n• canonical public registry\n• ledger state and event stream"]

    HU --> FE
    FE --> DS
    FE --> WP
    DS --> CC
    WP --> CC
    CC --> MN

    style HU fill:#4B5563,stroke:#9CA3AF,color:#F9FAFB
    style FE fill:#1D4ED8,stroke:#93C5FD,color:#F9FAFB
    style DS fill:#065F46,stroke:#6EE7B7,color:#F9FAFB
    style WP fill:#6B21A8,stroke:#C4B5FD,color:#F9FAFB
    style CC fill:#92400E,stroke:#FCD34D,color:#F9FAFB
    style MN fill:#1E3A5F,stroke:#7DD3FC,color:#F9FAFB
```

## Reference Architecture

The following reference diagram summarizes the intended relationship between external systems, the AI agent, its DID/credential or Agent MultiPass layer, secure secret custody, and Midnight as the privacy-preserving execution layer.

![Agents DID reference architecture](./docs/images/agents-did-architecture.png)

## Application Screenshots

Agent DID request and issued DID view:

![Agent DID screen](./docs/images/agent-did-screen.png)

Registry proof verification view:

![Registry proof screen](./docs/images/registry-proof-screen.png)

Human approvals and proof history view:

![Approvals screen](./docs/images/approvals-screen.png)

Admin live backend and MCP logs view:

![Admin logs screen](./docs/images/admin-logs-screen.png)

Admin proof review and verification package management view:

![Admin review screen](./docs/images/admin-review-screen.png)

## Further Reading

- Article: [Selective Disclosure & Self-Managing DIDs for AI Agents](https://dev.to/midnight-aliit/selective-disclosure-self-managing-dids-for-ai-agents-3kcl)
- DID / VC implementation specification: [docs/did-vc-specification.md](./docs/did-vc-specification.md)

### On-chain

The Compact contract (v2, `ownPublicKey()` controller model) is the registry of record. It stores:

- controller binding through `ZswapCoinPublicKey` — the connected wallet's public key is the sole authority, no local secret
- DID key derived on-chain from `hash(domain, registry_salt, controller_public_key, subject_nonce)`
- DID lifecycle state via `party_status` map
- DID, document, proof, capability, and revocation commitments
- role-based access control (`role_by_key` map) with on-chain roles: ADMIN, ISSUER, USER, AGENT
- initial admin bootstrap as the first registered role in the contract

The registry is intentionally not the full Agent MultiPass payload. Mandates, limits, capabilities, authorization levels, detailed profile claims, and credential JWTs are represented off-chain and selectively disclosed through credentials, presentations, and proof material.

Authorization model (v2):

- `self_register_did(subject_nonce)` — any wallet can register a DID slot; the wallet's `ownPublicKey()` is the controller; no local secret required
- `register_initial_admin()` — first caller claims the ADMIN role; only callable once
- `issue_did`, `grant_role`, `revoke_role`, `revoke_did` — ADMIN or ISSUER authorized via `ownPublicKey()` check in Compact
- no `issuerSecret` witness; no local private state needed for authorization

It does not store:

- agent name
- full DID document JSON
- customer workflow data
- MCP keys
- credential JWTs
- detailed mandate, limit, capability, or authorization-level policy data

### Off-chain

The local DID service stores:

- customer and linked wallet records
- MCP keys
- DID requests and approvals
- requester-authored DID documents
- issued DID records
- audit events
- verifiable credentials
- Agent MultiPass-oriented claim manifests, including current and future mandate, limit, capability, and authorization-level scopes
- Midnight proof material derived from disclosed credential commitments

For the sake of experimentation and local development, this repository uses PostgreSQL as the off-chain persistence layer for request payloads, DID records, and credential data.

That is a convenience choice for research and prototyping, not a recommended production custody model for sensitive agent data.

In a production deployment, off-chain identity payloads, credentials, and other sensitive holder material should be moved to a proper vault or secure custody system so that only the agent, the human owner/operator, or another explicitly authorized principal can access them.

## Midnight-Centered Credential Direction

The current implementation still issues issuer-signed JWT Verifiable Credentials and can assemble W3C-shaped presentation bundles.

Current implemented credential scopes include ownership, profile name, and organization. The product direction is to extend the same atomic-credential and selective-disclosure model to Agent MultiPass scopes such as mandate, limit, capability, and authorization level.

The repo now also exposes commitment-based Midnight proof material for issued credentials:

- per-credential commitments for the selected disclosure scopes
- a bundle commitment across those credentials
- a holder-binding commitment tied to the DID and challenge

That material is the intended proving boundary for a production Midnight holder-proof flow. The long-term target is:

- holder generates the selective-disclosure proof locally in the wallet or local proof server
- verifier checks DID status on Midnight plus issuer signatures and the holder proof
- the registry service orchestrates the flow but is not the final proving authority

Current native-proof note:

- the app can now generate a native Midnight ownership proof package
- the registry verifier currently validates the native statement boundary, reconstructed public inputs, issuer credentials, DID status, and circuit check path
- it does not yet claim canonical verifier-side validation of an arbitrary external `proofValue` blob as a standalone parsed artifact

## Product Views

### User

For a human customer who manages one or more agent wallets.

- select or create agents from `My Agents`
- request a DID for an agent
- inspect the agent DID state
- inspect credentials and disclosure bundles

### Admin

For the issuer/admin wallet.

- select the active registry
- review pending DID requests
- issue, update, or revoke DIDs on-chain
- persist deployment and issuance state in Postgres

In this repository, Admin mode should be enabled through `VITE_ADMIN_WALLET_SHIELDED_ADDR`.

Important distinction:

- UI admin access is gated by the configured admin wallet/shielded address
- contract owner authorization for `issue/update/revoke` is gated by the owner witness secret described below

### Registry

Public directory view for the selected registry contract.

- shows registered agents as cards
- shows DID details only after a card is selected
- intended for public inspection of the registry state

## W3C Scope

This repository is W3C-aligned, not a full conformance-certified implementation.

### Why W3C standards and not a custom scheme

Traditional identity systems are silos. Google knows who you are inside Google; a bank knows who you are inside its perimeter. Every time you need to prove something to a third party, you must go back through the original issuer. That creates a hard dependency: the issuer must be available, must cooperate, and must be trusted by the verifier.

W3C DID Core and the Verifiable Credentials Data Model were designed to break that dependency. A DID is an identifier controlled by its subject, not by any issuing organisation. A Verifiable Credential is a signed claim that any verifier can validate independently, without contacting the issuer at runtime. Using these standards means any external system that understands W3C DIDs can resolve a `did:midnight:...` identifier and consume credentials from this implementation without building bespoke integrations. Without them, this identity layer would be a Midnight-only silo, useful only within this ecosystem.

Implemented:

- `did:midnight:<network>:<contract>:<agentKey>` identifiers
- DID resolution objects
- DID documents derived from stored records
- JWT-based Verifiable Credentials
- W3C-shaped Verifiable Presentations assembled from selected credentials

Current limitation:

- presentations are not yet holder-signed
- VC delivery is not yet a holder-encrypted private vault flow

See:

- `docs/did-midnight-method.md`
- `docs/did-vc-specification.md`
- `docs/identity-architecture.md`
- `docs/w3c-compatibility-report.md`

## Requirements

- Node.js 20+
- PostgreSQL 16+ or compatible
- Midnight Compact compiler installed as `compact`
- a funded 1AM wallet on Midnight Preprod
- wallet prover access through 1AM, or a local Midnight proof server if you explicitly choose that setup

## Official Resources

- 1AM Wallet beta installer: https://1am.xyz/install-beta
- Midnight developer documentation: https://docs.midnight.network/
- Midnight getting started / toolchain install: https://docs.midnight.network/getting-started
- Midnight JS SDK repository: https://github.com/midnightntwrk/midnight-js

## Release Notes

### v0.7.0

- **DID Registry v2 contract** — complete rewrite from `issuerSecret()` witness model to `ownPublicKey()` / `ZswapCoinPublicKey` controller model
- **Self-registration** — any wallet can register a DID slot via `self_register_did(subject_nonce)` without a local secret
- **On-chain role system** — ADMIN, ISSUER, USER, AGENT roles stored in `role_by_key` map; admin bootstrap via `register_initial_admin()`
- **DID key derivation** — `hash("didmn:did:v1", registry_salt, ownPublicKey(), subject_nonce)` replaces agent-key-based derivation
- **Removed** — `issuerSecret()` witness, owner vault backup, `OwnerVaultBackupPayload`, `ensureOwnerPrivateState`, `status_by_agent`, `organization_labels`, `organization_disclosures`, `request_commitments` ledger fields
- **vitest config** — added `vitest.config.ts` with `setupFiles` window shim and proper test exclusions; 162 tests pass

### v0.6.5 and earlier

See git log for prior release notes.

## Tested Versions

- Application version: `0.7.0`
- Compact compiler: `v0.31.0` (`pragma language_version >= 0.23`)
- Midnight JS SDK family: `4.0.2`
- Midnight DApp connector API: `4.0.1`
- Midnight ledger / proof stack: `8.0.3`
- 1AM Wallet: Beta channel from the official installer at `https://1am.xyz/install-beta`

For the Midnight SDK, the main package set currently pinned in this repository is:

- `@midnight-ntwrk/midnight-js-contracts@^4.0.2`
- `@midnight-ntwrk/midnight-js-fetch-zk-config-provider@^4.0.2`
- `@midnight-ntwrk/midnight-js-http-client-proof-provider@^4.0.2`
- `@midnight-ntwrk/midnight-js-indexer-public-data-provider@^4.0.2`
- `@midnight-ntwrk/midnight-js-level-private-state-provider@^4.0.2`
- `@midnight-ntwrk/midnight-js-network-id@^4.0.2`
- `@midnight-ntwrk/midnight-js-node-zk-config-provider@^4.0.2`
- `@midnight-ntwrk/midnight-js-utils@^4.0.2`
- `@midnight-ntwrk/ledger-v8@^8.0.3`

Note:

- this repository references the official 1AM Beta installer, but does not pin a wallet version number in code
- if 1AM publishes a specific public Beta version identifier, update this section accordingly

## Environment

Copy `env.example` to `.env` and adjust values as needed.

Key variables:

```bash
VITE_NETWORK_ID=preprod
VITE_INDEXER_URI=https://indexer.preprod.midnight.network/api/v3/graphql
VITE_INDEXER_WS_URI=wss://indexer.preprod.midnight.network/api/v3/graphql/ws
VITE_NODE_URI=https://rpc.preprod.midnight.network
VITE_PROVER_SERVER_URI=http://127.0.0.1:6300
VITE_MANAGED_CONTRACT_PATH=/contracts/managed/did-registry
VITE_DID_API_BASE_URL=http://localhost:8787
DID_API_PORT=8787
DATABASE_URL=postgresql://postgres:YOUR_DB_PASSWORD_HERE@127.0.0.1:5432/agent_registry_db
VITE_ADMIN_WALLET_SHIELDED_ADDR=mn_shield-addr_XXXXXXXX

# API auth hardening (local DID + MCP HTTP servers)
# Private REST routes and the MCP /logs endpoint require this shared token.
# DID_API_AUTH_TOKEN is read by the servers; VITE_DID_API_AUTH_TOKEN must match
# so the frontend (admin Logs view included) can authenticate.
DID_API_AUTH_TOKEN=replace-with-a-long-random-token
VITE_DID_API_AUTH_TOKEN=replace-with-a-long-random-token

# Loopback binding and CORS allowlist (defaults shown)
DID_API_HOST=127.0.0.1
DID_MCP_HOST=127.0.0.1
DID_MCP_PORT=8788
DID_CORS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

The local DID REST service and the MCP HTTP server gate their private routes
behind a shared token. Set `DID_API_AUTH_TOKEN` (server) and a matching
`VITE_DID_API_AUTH_TOKEN` (frontend); requests may carry the token as
`X-DID-API-Key: <token>` or `Authorization: Bearer <token>`. The admin Logs view
needs the matching frontend token to load both the backend and MCP log streams.
This token is a coarse local-development gate, not production access control.

## Controller Model (v2)

As of v0.7, the registry contract uses Midnight's `ownPublicKey()` built-in for authorization. There is no owner secret, no witness, and no local vault backup required.

How it works:

- the connected wallet's `ZswapCoinPublicKey` is the controller for any DID it registers
- `self_register_did(subject_nonce)` derives the DID key on-chain from `hash("didmn:did:v1", registry_salt, ownPublicKey(), subject_nonce)`
- the same wallet can call `register_initial_admin()` once to claim the ADMIN role
- `issue_did`, `grant_role`, `revoke_role`, `revoke_did` check `ownPublicKey()` against the stored role map at circuit execution time
- no local secret is generated, stored, or needed for recovery

Deploying a registry with the v2 contract:

1. Connect the admin wallet.
2. Start the frontend and API.
3. Open the app as Admin.
4. Go to `Deploy DID Registry`.
5. Deploy the contract (no owner secret generated — wallet key is the authority).
6. Call `Register as Initial Admin` from the same wallet to claim the ADMIN role.

Subject nonce:

- the default subject nonce is `SHA-256("didmn:default-slot:v1")` = `ba3649522b461286f41043ca6548f1d5dcd2c3e74e1d59fa74102fc1eb1ce531`
- custom nonces can be supplied to create multiple DID slots per wallet

## Development

Install dependencies:

```bash
npm install
```

Recommended startup order for a fresh local setup:

1. Install and connect the 1AM wallet.
2. Install the Midnight toolchain following the official Midnight docs.
3. Start PostgreSQL, either locally with Docker or through an external host.
4. Set your `.env`.
5. Compile the Compact contract artifacts.
6. Start the local DID API.
7. Start the frontend.
8. Start a local proof server only if you are not using the wallet prover.

Compile the Compact contract and refresh managed assets:

```bash
npm run compile-contract
```

This command:

- compiles [contracts/did_registry.compact](/Users/alex/Documents/Developer/didMN/contracts/did_registry.compact)
- regenerates [contracts/managed/did-registry](/Users/alex/Documents/Developer/didMN/contracts/managed/did-registry)
- refreshes the browser-served assets under `public/contracts/managed/did-registry`
- refreshes generated runtime bindings under `src/generated`
- updates [contracts/compiled/did_registry.compiled.json](/Users/alex/Documents/Developer/didMN/contracts/compiled/did_registry.compiled.json)

You need the official Midnight Compact compiler installed as `compact` or `compactc`.

Deploying a registry with the v2 contract model:

1. Connect the admin wallet.
2. Start the frontend and API.
3. Open the app as Admin.
4. Go to `Deploy DID Registry`.
5. Deploy the contract.
6. Call `Register as Initial Admin` from the same wallet to claim the ADMIN role.

Important:

- the contract is initialized in its constructor; there is no separate `initialize` step
- authorization for `issue/update/revoke` is resolved on-chain from `ownPublicKey()` — no local secret or vault backup required
- if you need a second admin, use `grant_role` while connected as the current admin

Validate local Preprod prerequisites:

```bash
npm run doctor:preprod
```

Start the DID service:

```bash
npm run dev:api
```

The local API starts on `http://localhost:8787` by default.
On startup it:

- connects to Postgres using `DATABASE_URL`
- applies `server/schema.sql`
- exposes the local DID service and MCP-oriented endpoints

Start the frontend:

```bash
npm run dev
```

Build the app:

```bash
npm run build
```

Start the proof server:

```bash
npm run start-proof-server
```

This is optional when the connected wallet already provides prover access.

## Database

The backend schema is defined in `server/schema.sql`.

You do not need to run a separate migration command for the normal local setup.
The API server calls `initializeDatabase()` on startup and applies `server/schema.sql`
automatically before it starts serving requests.

For a local Docker database:

```bash
docker compose up -d postgres
```

Default local Docker credentials from `docker-compose.yml`:

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/agent_registry_db
```

Then start the API:

```bash
npm run dev:api
```

Adjust `DATABASE_URL` if you use an external Postgres host.

### External Postgres

If you already have a running Postgres server, skip Docker and point the API to it:

```bash
DATABASE_URL=postgresql://postgres:YOUR_DB_PASSWORD_HERE@YOUR_DB_HOST:5432/agent_registry_db
npm run dev:api
```

The API will still initialize the schema automatically on startup.

## Local DID Service and MCP

The local API is the workflow and persistence layer around the on-chain Midnight registry.

It is responsible for:

- customer account lookup by wallet
- MCP key generation and storage
- DID request persistence
- human approval workflow
- admin issuance persistence
- DID resolution and validation
- credential issuance and retrieval

### What the MCP key is

An MCP key is a customer-issued agent credential for calling the local DID service.

It is:

- generated by the human customer
- stored hashed in Postgres
- shown in plaintext only at creation time
- then intended to be handed to the agent securely

It is not stored on-chain.

### MCP server modes

The repository now exposes a full MCP server on top of the existing DID workflow layer:

- `npm run dev:mcp:stdio`
  Runs an MCP stdio server for agent hosts that launch local MCP processes.
- `npm run dev:mcp:http`
  Runs an MCP HTTP server on `http://localhost:8788/mcp`.

The MCP server is authenticated by the same human-issued MCP key used by the REST workflow.
Agents can provide that key through:

- `initialize.mcpKey`
- `initialize.authToken`
- `MCP_KEY` for stdio mode
- `X-MCP-Key` or `Authorization: Bearer ...` for HTTP mode

The HTTP mode also exposes discovery metadata:

- `GET /.well-known/mcp`
- `GET /mcp/discovery`

Inside MCP itself, discovery is available through:

- `resources/list`
- `resources/read`
- `resources/templates/list`
- `prompts/list`
- `prompts/get`
- `tools/list`

### How to create and use an MCP key

From the UI:

1. Connect the human wallet.
2. Go to `User`.
3. Select an agent or click `+` to create one.
4. Open `Human + MCP`.
5. Bootstrap the customer account if needed.
6. Create an MCP key.
7. Copy the plaintext key at creation time and hand it to the agent.

From the API:

1. Bootstrap or create the customer account.
2. Create an MCP key for that customer.
3. Use the key in `X-MCP-Key` when the agent calls `POST /api/agent/did-requests`.

### MCP request flow

The agent flow is:

1. Human creates or bootstraps a customer account.
2. Human creates an MCP key.
3. Agent calls the local DID service with that key.
4. Human approves the request.
5. Admin issues the DID on-chain.
6. The DID and credentials become available through the resolver and credential endpoints.

### MCP discovery flow

An agent can discover how to use the server without out-of-band documentation:

1. Call `initialize` and provide the MCP key.
2. Call `resources/list` and read:
   - `didmn://guide/overview`
   - `didmn://guide/auth`
   - `didmn://guide/tools`
   - `didmn://guide/workflows`
3. Call `prompts/list` and optionally `prompts/get` for:
   - `agent_onboarding`
   - `request_did_workflow`
4. Call `tools/list` to see only the tools allowed by the scopes on the current MCP key.

Current MCP tools include:

- `did_request_create`
- `did_request_list`
- `did_request_get`
- `did_resolve`
- `did_validate`
- `issuer_descriptor_get`
- `credential_bundle_get`
- `credential_list`
- `credential_rotate`

Example request:

```bash
curl -X POST http://localhost:8787/api/agent/did-requests \
  -H "Content-Type: application/json" \
  -H "X-MCP-Key: mcp_your_plaintext_key" \
  -d '{
    "contractAddress": "YOUR_CONTRACT_ADDRESS",
    "networkId": "preprod",
    "requesterWalletAddress": "mn_addr_preprod1...",
    "subjectWalletAddress": "mn_addr_preprod1...",
    "organizationName": "Matrix Labs",
    "organizationDisclosure": "disclosed",
    "requestPayload": {
      "agentName": "Agent Smith",
      "didDocument": {
        "id": "",
        "controller": "mn_addr_preprod1...",
        "service": [
          {
            "id": "#agent-endpoint",
            "type": "AgentEndpoint",
            "serviceEndpoint": "https://agent.example.com"
          }
        ]
      }
    }
  }'
```

### End-to-end local usage

Minimal local sequence:

1. Start Postgres
2. Start the local API
3. Start the frontend
4. Connect wallet
5. Deploy or select a registry contract
6. In `User`, create/select an agent and request a DID
7. In `Human + MCP`, bootstrap customer / create MCP key if you want agent-driven requests
8. In `Admin`, review and issue the DID on-chain

## Offline JWT VC Verification

Third parties can verify the JWT credentials issued by this registry without calling the UI.

The basic process is:

1. Obtain the VC JWT.
2. Obtain the issuer descriptor and public JWK:
   - REST: `GET /api/issuer`
   - MCP: `issuer_descriptor_get`
3. Verify the JWT signature offline with the issuer public JWK.
4. Check:
   - `iss` matches the issuer descriptor `id`
   - `sub` matches the DID holder
   - the `vc.credentialSubject.id` matches the same DID
   - the DID itself is still active through `did_resolve` or `did_validate`

Minimal example with `jose`:

```ts
import { importJWK, jwtVerify } from "jose";

const issuerDescriptor = await fetch("http://localhost:8787/api/issuer").then((r) => r.json());
const publicKey = await importJWK(issuerDescriptor.publicJwk, "EdDSA");

const verified = await jwtVerify(vcJwt, publicKey, {
  issuer: issuerDescriptor.id,
});

console.log(verified.payload);
```

Important:

- This verifies the JWT VC signature offline.
- It does not by itself prove the DID is still active; the verifier should also resolve or validate the DID against the registry.
- `credential_rotate` can be used to revoke currently active JWT VCs for a DID and issue fresh ones while keeping the DID itself unchanged.
9. In `Registry`, inspect the public directory

## Main API Endpoints

Customer and workflow:

- `GET /health`
- `GET /api/customers/by-wallet?walletAddress=...`
- `POST /api/demo/bootstrap`
- `POST /api/customers/:id/mcp-keys`
- `POST /api/agent/did-requests`
- `POST /api/wallet/did-requests`
- `GET /api/did-requests`
- `GET /api/did-requests/:id`
- `POST /api/human/did-requests/:id/approve`
- `POST /api/human/did-requests/:id/reject`
- `POST /api/admin/did-requests/:id/issue`
- `POST /api/admin/did-requests/:id/reject`

Registry and DID data:

- `GET /api/admin/registry-deployments`
- `GET /api/admin/registry-deployments/latest`
- `POST /api/admin/registry-deployments`
- `GET /api/registry/dids?contractAddress=...`
- `GET /api/dids/resolve?did=...`
- `GET /api/dids/validate?did=...`

Credentials:

- `GET /api/issuer`
- `GET /api/vcs/by-did?did=...`
- `POST /api/vcs/bundle`
- `POST /api/vcs/verify`
- `POST /api/vps/verify`

## Repository Notes

This repository intentionally excludes local-only working notes, generated local data, and development logs from version control via `.gitignore`.

## Contract Directory Notes

The `contracts/` tree intentionally contains both source and generated artifacts used by the DApp:

- [contracts/did_registry.compact](/Users/alex/Documents/Developer/didMN/contracts/did_registry.compact)
  the Compact source of truth
- [contracts/managed/did-registry](/Users/alex/Documents/Developer/didMN/contracts/managed/did-registry)
  generated managed runtime, proving/verifier keys, and ZKIR assets required by the app
- [contracts/compiled/did_registry.compiled.json](/Users/alex/Documents/Developer/didMN/contracts/compiled/did_registry.compiled.json)
  generated metadata snapshot of the current contract

Inside `contracts/managed/did-registry`, both plain circuit filenames and `did-registry#...` aliases are kept intentionally. The aliased files are needed for the current Vite/browser asset lookup flow.

There should be no personal environment data, wallet secrets, or machine-specific local notes under `contracts/`. The files present there are generated build artifacts required by this repository, not temporary user-only state.
