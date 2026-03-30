# Midnight Agent DID Manager

Midnight Agent DID Manager is a React + Vite application plus a local Node/Postgres service for managing a Compact DID registry on Midnight Network (Preprod or Preview).

This repository is an open-source research project focused on decentralized identity flows aimed to provide a DID and Selective disclosure Verifiable Credential for AI agents on Midnight.

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

## Research Status and Disclaimer

This repository is provided as a research and experimentation project for DID workflows, registry models, and credential flows for agents on Midnight.

It is not provided as legal advice, compliance advice, identity assurance, production security certification, or fitness-for-purpose assurance.

By using, modifying, deploying, or relying on this repository, you accept that:

- all use is at your own risk
- all operational, legal, regulatory, financial, security, and integration outcomes are your responsibility
- you must independently validate suitability for your jurisdiction, product, users, and threat model
- you must independently review all smart contract, wallet, infrastructure, database, and credential behavior before production use

The author and contributors disclaim responsibility and liability, to the maximum extent permitted by applicable law, for direct, indirect, incidental, consequential, special, regulatory, civil, criminal, contractual, tort, or other damages, claims, losses, or outcomes arising from use of this repository or reliance on its behavior, documentation, or examples.

## Architecture

```text
┌──────────────────────────────────────────────────────────────────────┐
│                     Human User / Agent Operator                     │
│        (human-managed account, or agent with wallet-controlled key) │
└──────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│                        React Frontend (DApp)                        │
│  - connect 1AM wallet                                               │
│  - request, issue, update, revoke DID flows                         │
│  - user, admin, and registry views                                  │
└──────────────────────────────────────────────────────────────────────┘
                                │
                ┌───────────────┴────────────────┐
                │                                │
                ▼                                ▼
┌───────────────────────────────┐      ┌──────────────────────────────┐
│ DID Service + Postgres        │      │ 1AM Wallet + Proof Server    │
│ - accounts and MCP keys       │      │ - signatures and proof flow  │
│ - request persistence         │      │ - transaction submission      │
│ - approvals and DID records   │      └──────────────────────────────┘
│ - VC issuance and resolution  │                    │
└───────────────────────────────┘                    ▼
                │                        ┌──────────────────────────────┐
                └──────────────────────▶│ Midnight Compact Contract     │
                                         │ DID registry of record       │
                                         │ - commitments and status      │
                                         │ - issuer/admin constraints    │
                                         └──────────────────────────────┘
                                                      │
                                                      ▼
                                         ┌──────────────────────────────┐
                                         │ Midnight Preprod + Indexer   │
                                         │ canonical public registry    │
                                         └──────────────────────────────┘
```

### On-chain

The Compact contract is the registry of record. It stores:

- subject binding through a wallet-derived agent key
- DID lifecycle state
- request, update, revoke, DID, document, and proof commitments
- registry admin and issuer service keys
- optional public organization disclosure

It does not store:

- agent name
- full DID document JSON
- customer workflow data
- MCP keys
- credential JWTs

### Off-chain

The local DID service stores:

- customer and linked wallet records
- MCP keys
- DID requests and approvals
- requester-authored DID documents
- issued DID records
- audit events
- verifiable credentials

For the sake of experimentation and local development, this repository uses PostgreSQL as the off-chain persistence layer for request payloads, DID records, and credential data.

That is a convenience choice for research and prototyping, not a recommended production custody model for sensitive agent data.

In a production deployment, off-chain identity payloads, credentials, and other sensitive holder material should be moved to a proper vault or secure custody system so that only the agent, the human owner/operator, or another explicitly authorized principal can access them.

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

Admin mode is enabled when the connected wallet is recognized as the registry admin / issuer on-chain, or when the connected shielded address matches `VITE_ADMIN_WALLET_SHIELDED_ADDR`.

### Registry

Public directory view for the selected registry contract.

- shows registered agents as cards
- shows DID details only after a card is selected
- intended for public inspection of the registry state

## W3C Scope

This repository is W3C-aligned, not a full conformance-certified implementation.

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
- `docs/identity-architecture.md`
- `docs/w3c-compatibility-report.md`

## Requirements

- Node.js 20+
- PostgreSQL 16+ or compatible
- Midnight Compact compiler installed as `compact`
- local Midnight proof server
- a funded 1AM wallet on Midnight Preprod

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
```

## Development

Install dependencies:

```bash
npm install
```

Compile the Compact contract and refresh managed assets:

```bash
npm run compile-contract
```

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
DATABASE_URL=postgresql://postgres:YOUR_DB_PASSWORD_HERE@10.0.0.10:5432/agent_registry_db
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
