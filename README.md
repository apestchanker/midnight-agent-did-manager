# Midnight Agent DID Manager

Midnight Agent DID Manager is a React + Vite application plus a local Node/Postgres service for managing a Compact DID registry on Midnight Network (Preprod or Preview), with shielded ZK token gating for privileged registry operations.

This repository is an open-source research project focused on Agentic-DIDs: privacy-preserving identity and mandate flows for AI agents. The product direction is an Agent MultiPass: a verifiable agent pass that combines stable agent identity, human or organizational control, valid mandates, limits, capabilities, authorization levels, status, and selective disclosure credentials. Midnight is used as the privacy-first blockchain substrate for DID lifecycle state, commitments, and proof-oriented workflows.

## Non-Production Warning

This version is still NOT HARDENED to facilitate testing and debugging.

IT SHALL NOT USE NOR IT IS INTENDED FOR PRODUCTION USAGE.

If you want to read more about what inspired me to build this repo, - Article: [Selective Disclosure & Self-Managing DIDs for AI Agents](https://dev.to/midnight-aliit/selective-disclosure-self-managing-dids-for-ai-agents-3kcl)

## Requirements

- Node.js 20+
- PostgreSQL 16+ or compatible
- Midnight Compact compiler installed as `compact`
- a funded 1AM wallet on Midnight Preprod
- wallet prover access through 1AM, or a local Midnight proof server if you explicitly choose that setup
- both Compact contracts compiled (`npm run compile-all`) before deploying — this produces the ZK proving/verifier keys required by the admin deploy panel

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

Compile all contracts and refresh managed assets:

```bash
npm run compile-all              # recommended — compiles both contracts in order
npm run compile-contract         # only did_registry.compact
npm run compile-ownership-proof  # only native_ownership_proof.compact
```

`npm run compile-all` runs the two scripts in order: did_registry → ownership_proof. As of v3.0.0, `token_gating.compact` is unified into `did_registry.compact` (see [Contract Directory Notes](#contract-directory-notes)) — there is no separate token-gating compile step. You must compile before deploying from the admin panel — the compile step generates the ZK proving/verifier keys (`.prover` and `.verifier` files). Full ZK compilation can take several minutes.

You need the official Midnight Compact compiler installed as `compact` or `compactc`.

Generated outputs are local build products and are intentionally ignored by Git. Each cloned or deployed instance must run the compile step and use its own generated artifacts.

Outputs:

- `contracts/managed/did-registry/` and `public/contracts/managed/did-registry/` — DID registry artifacts (keys, zkir, contract)
- `contracts/managed/native-ownership-proof/` and `public/contracts/managed/native-ownership-proof/` — native ownership proof artifacts
- `src/generated/didRegistryContract.runtime.js` — DID registry runtime JS
- `src/generated/nativeOwnershipProof.runtime.js` — native ownership proof runtime JS
- `contracts/compiled/did_registry.compiled.json` — local metadata snapshot

Deploying from the admin panel (2-step flow):

1. **Step 1: Load Artifacts** — validates the compiled `did_registry` and `native-ownership-proof` artifacts.
2. **Step 2: Deploy Unified Registry** — deploys `did_registry.compact`, then immediately mints the genesis admin token in a **second, separate transaction** (`register_initial_admin()`). This is a deliberate, project-owner-approved design decision (2026-07-21) — see [Constructor](#constructor) below and `sdd/wip/005-coin-gated-admin-access/decision-log-2026-07-21.md` for the full rationale, including the accepted bootstrap race-condition tradeoff. Step 2 is gated — unavailable until step 1 is complete.

Important:

- the contract's constructor only deploys — it fixes `admin_token_color` and does not mint anything. The genesis admin token is minted by a second, explicit `register_initial_admin()` call immediately after deploy (two separate transactions, not one atomic step; see [Constructor](#constructor))
- authorization for admin-tier operations (`mint_capability_tokens`, `issue_did`, `grant_role`, `revoke_role`, `revoke_did`) requires presenting and consuming the on-chain admin token (`consumeAdminToken()`); `update`/`revoke` of a DID by its own controller is resolved from `ownPublicKey()` plus the DID's linked capability-token color — no local secret or vault backup required for either path
- if you need a second admin, use `rotate_admin_tokens` to mint a fresh admin token to the new holder, or `grant_role` for non-admin roles, while connected as the current admin

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
    HU(["👤 Human User / Agent Operator\n─────────────────────────────\nhuman-managed account\nor AI agent with wallet-controlled key"])

    FE["🖥️ React Frontend — DApp\n─────────────────────────────\n• connect Midnight wallet\n• self-register · issue · update · revoke DID\n• user · admin · registry views\n• private state in browser localStorage"]

    WL["🔐 Midnight Wallet\n─────────────────────────────\n• 1AM · Lace (via window.midnight API)\n• ownPublicKey() controller binding\n• transaction signing and submission\n• built-in wallet prover or local proof server"]

    DS["🗄️ DID REST API — :8787\n─────────────────────────────\n• customer accounts and MCP keys\n• DID request persistence and approvals\n• VC issuance · resolution · verification\n• registry deployment records\n• Midnight proof material\n• backed by PostgreSQL"]

    MCP["🤖 MCP Server — :8788\n─────────────────────────────\n• AI agent interface (stdio · HTTP)\n• DID requests and proof flows\n• agent authentication via MCP keys"]

    CC["⛓️ Midnight Compact Contract\n─────────────────────────────\n• unified DID registry + token gating (v3)\n• party_status · role_by_key · did_controller\n• coin-gated admin token + capability tokens\n• controller binding via ownPublicKey()"]

    IDX["🌐 Midnight Network + Indexer\n─────────────────────────────\n• Preprod · Preview · Mainnet\n• contract state via indexer GraphQL/WS\n• transaction submission via node RPC"]

    HU --> FE
    HU --> MCP
    FE --> WL
    FE --> DS
    MCP --> DS
    WL --> CC
    DS --> CC
    CC --> IDX

    style HU fill:#4B5563,stroke:#9CA3AF,color:#F9FAFB
    style FE fill:#1D4ED8,stroke:#93C5FD,color:#F9FAFB
    style WL fill:#6B21A8,stroke:#C4B5FD,color:#F9FAFB
    style DS fill:#065F46,stroke:#6EE7B7,color:#F9FAFB
    style MCP fill:#0F4C5C,stroke:#67E8F9,color:#F9FAFB
    style CC fill:#92400E,stroke:#FCD34D,color:#F9FAFB
    style IDX fill:#1E3A5F,stroke:#7DD3FC,color:#F9FAFB
```

## Reference Architecture

The following reference diagram summarizes the intended relationship between external systems, the AI agent, its DID/credential or Agent MultiPass layer, secure secret custody, and Midnight as the privacy-preserving execution layer.

![Agents DID reference architecture](./docs/images/agents-did-architecture.png)

The following sequence architecture shows the agent-facing platform flow across the main system interfaces. A standalone copy is available at [docs/agent-platform-interface-sequence.md](./docs/agent-platform-interface-sequence.md).

```mermaid
sequenceDiagram
    autonumber

    box Agent Surface
        actor Human as Human / Operator
        participant Agent as AI Agent / MCP Client
        participant DApp as React DApp
    end

    box Platform Interfaces
        participant MCP as MCP Server :8788
        participant API as DID REST API :8787
        participant Resolver as Resolver / VC API
    end

    box Platform Core
        participant DB as Postgres
        participant Wallet as Midnight Wallet
        participant Contract as Compact DID Registry
    end

    box External Trust Boundary
        participant Verifier as External Verifier
    end

    Human->>DApp: Connect wallet
    DApp->>API: Bootstrap customer account
    API->>DB: Store customer and agent profile

    Human->>DApp: Create MCP key
    DApp->>API: Request MCP key
    API->>DB: Store hashed MCP key
    API-->>DApp: Return plaintext key once
    Human-->>Agent: Provide key securely

    Agent->>MCP: initialize(mcpKey)
    MCP->>API: Validate MCP key
    API->>DB: Check key hash and scopes
    API-->>MCP: Authorized scope set
    MCP-->>Agent: Available tools, resources, and prompts

    Agent->>MCP: did_request_create
    MCP->>API: POST agent DID request
    API->>DB: Store pending_human_approval
    API-->>MCP: Request created
    MCP-->>Agent: Await human approval

    Human->>DApp: Review agent DID request
    DApp->>API: Approve request
    API->>DB: Mark holder-approved

    DApp->>Wallet: Spend capability-token coin, then register controller-bound DID
    Wallet->>Contract: gated_self_register_did(coin, subject_nonce)
    Contract->>Contract: consumeToken(coin), then did_controller[did_key] = ownPublicKey()
    Contract-->>Wallet: DID slot registered

    Human->>DApp: Admin issues DID
    DApp->>Wallet: Sign issue transaction
    Wallet->>Contract: issue_did(coin, did_key, commitments)
    Contract->>Contract: consumeAdminToken(coin), then set DID active
    Contract-->>Wallet: DID issued

    API->>DB: Persist issued DID and VC metadata
    API->>Resolver: Expose DID resolution and credentials

    Agent->>MCP: credential_bundle_get / did_resolve
    MCP->>Resolver: Fetch DID, VCs, and proof material
    Resolver-->>MCP: DID document and VC bundle
    MCP-->>Agent: Agent MultiPass material

    Agent-->>Verifier: Present DID and selected credentials/proofs
    Verifier->>Resolver: Resolve DID / validate status
    Resolver->>Contract: Read registry state
    Contract-->>Resolver: Active / revoked status
    Resolver-->>Verifier: DID validation result
    Verifier->>Verifier: Verify issuer signature and disclosed claims
```

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
- 3-minute demo script in English: [docs/demo-script-3min-agent-platform-flow.md](./docs/demo-script-3min-agent-platform-flow.md)

### On-chain

A single unified Compact contract, `did_registry.compact` (v3.0.0, generated from
`contracts/did_registry.compact.template`), forms the on-chain layer. It collapses what
used to be two separate contracts — a standalone `token_gating.compact` and a
`did_registry.compact` — into one: the action-credit token is no longer an off-chain
reconstructible commitment, it is a real `ShieldedCoinInfo` consumed inline by an
internal `consumeToken`/`consumeAdminToken` helper. The pre-unification
`token_gating.compact` source is kept only for historical reference under
`contracts/archived/` and is not part of the active build.

Constructor:

```
constructor(salt: Bytes<32>)
```

> **Owner decision, 2026-07-21 — do not revert without the project owner's
> explicit sign-off.** Deployment and the genesis admin token mint are two
> **separate** transactions, not one atomic step. This is the second time
> this tradeoff has been decided explicitly, in different directions, by the
> project owner — see the extensive inline comments on the constructor and
> on `register_initial_admin` in `contracts/did_registry.compact.template`,
> and `sdd/wip/005-coin-gated-admin-access/decision-log-2026-07-21.md` for
> the full history and rationale. The atomic version (bundling deploy + mint
> in the constructor, as this README described in earlier revisions) was
> found to interfere with wallet-side transaction balancing during live
> preprod testing.

The constructor only deploys. It sets `registry_salt`, `total_active_dids = 0`,
`admin_registered = false`, and fixes `admin_token_color` (deterministic, from
`kernel.self()`) — a single, contract-wide `Bytes<32>` ledger value, set once and
never reassigned. It mints nothing.

```
export circuit register_initial_admin(
  admin_recipient: ZswapCoinPublicKey,
  admin_coin_nonce: Bytes<32>,
  admin_supply: Uint<64>
): []
```

A second, ordinary export circuit — called immediately after deploy by the app's
own deploy flow (`UnifiedRegistryAPI.deploy()` followed by
`registerInitialAdmin()`, see `src/lib/registry/unified-registry-api.ts`). Mints the
genesis admin token — `admin_supply + 1` shielded units (1 permanent anchor +
`admin_supply` spendable credits) — directly to `admin_recipient`, using the color
fixed at deploy. Guarded only by `assert(!admin_registered, ...)`: callable exactly
once. **Still coin-based, not `ownPublicKey()`-based** — this mints a real
`ShieldedCoinInfo`, exactly like the constructor did before this change; only the
atomicity with deploy was removed. The project owner explicitly accepted the
resulting bootstrap race-condition risk (whoever calls this first, after deploy,
becomes admin) — mitigation: discard and redeploy if the race is lost. This
contract has no production value yet (preprod/testnet).

Authorization model — coin-gated, not identity-gated:

Every privileged operation is authorized by presenting and consuming a real shielded
coin of the correct color, not by comparing `ownPublicKey()` against a role recorded
in the ledger. `ownPublicKey()` is not cryptographically bound to a transaction's
actual signer, so a role check built only on it can be forged by any caller; a
coin-gated check instead requires holding a genuinely minted coin with an unused
nullifier, which is a materially stronger, cryptographically-rooted guarantee. No
long-lived secret, witness, or local vault is introduced anywhere in this model.

- `consumeToken(coin)` — internal (non-exported) helper; validates `coin.color`
  against the `valid_colors` set, checks `coin.value >= 2`, enforces single-use via a
  `(color, nonce)`-namespaced nullifier in `used_capability_nullifiers`, takes custody
  of the coin, and returns change to the caller. Gates `gated_self_register_did` and
  `request_update_did`.
- `consumeAdminToken(coin)` — internal (non-exported) helper; a structural near-clone
  of `consumeToken()` that asserts **exact** equality against the single
  `admin_token_color` instead of `valid_colors` set membership, sharing the same
  `used_capability_nullifiers` map (no separate admin nullifier map). It is the sole
  authorization path for every admin-tier circuit: `mint_capability_tokens`,
  `issue_did`, `grant_role`, `revoke_role`, and `revoke_did` each call
  `consumeAdminToken(coin)` as their first instruction, before touching any other
  state.
- `rotate_admin_tokens(coin, new_recipient, new_coin_nonce, new_supply)` — exported,
  self-service circuit a holder calls to replace a lost/compromised admin token,
  hand admin capability to a new recipient, or replenish spendable credits. It burns
  the presented coin (`receiveShielded` + nullifier insert) and mints a fresh
  `new_supply + 1`-unit admin coin to `new_recipient` — both in the same circuit body,
  so the burn and the mint execute as one atomic unit of the transaction. There is no
  intermediate committed state where the old token is spent but no replacement exists,
  which rules out permanent lockout even under a forced-failure retry.

The ISSUER role has been removed entirely. `issue_did` used to check
`is_admin || is_issuer` via `role_by_key` lookups; it is now gated purely by
`consumeAdminToken(coin)`, the same as the other four admin-tier circuits — there is
one admin-tier gate, not two overlapping ones.

`role_by_key` (ADMIN/USER role bookkeeping) is still written by the constructor and
read by `deriveRegistryAccess()` to populate the UI's admin-badge display, but it is
purely a **read-model signal** now — no circuit consults it to authorize an operation.

Beyond authorization, the contract stores:

- DID key derived on-chain from `hash("didmn:did:v1", registry_salt, ownPublicKey(), subject_nonce)`
- DID lifecycle state via `party_status` map
- DID, document, proof, capability, and revocation commitments
- `did_token_color` — binds each DID key to the specific capability-token color it was
  registered with; `request_update_did` asserts the presented coin's color matches
  this DID-linked color exactly, so a caller cannot authorize an update to a DID with
  an unrelated (but otherwise valid) capability token

The registry is intentionally not the full Agent MultiPass payload. Mandates, limits, capabilities, authorization levels, detailed profile claims, and credential JWTs are represented off-chain and selectively disclosed through credentials, presentations, and proof material.

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

### DID Document `controller` Field

The `controller` field inside a DID Document is informative W3C DID metadata. It
records who the document *declares* as its controller and defaults to the human
operator's connected wallet at request/issuance/update time, editable before
submission. It has no bearing on who is actually authorized to update or revoke a
DID on this platform.

Real authorization is governed exclusively on-chain by possession and consumption
of the correct capability-token color — see "Authorization model — coin-gated, not
identity-gated" above and [Coin-Gated Authorization (v0.9)](#coin-gated-authorization-v09).
Possessing, matching, or controlling the `controller` value neither grants nor is
required for update or revoke permission.

DID records created before this field existed have no persisted `controller` value;
resolution falls back to the DID's own identifier for those legacy records.

Note this is a different concept from the on-chain `did_controller` ledger entry
described under [Development](#development) ("update/revoke of a DID by its own
controller is resolved from `ownPublicKey()` plus the DID's linked capability-token
color") — that ledger entry is part of the real, on-chain authorization mechanism;
the `controller` field described in this section is off-chain document metadata and
is not.

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
- contract owner authorization for admin-tier operations (`mint_capability_tokens`, `issue_did`, `grant_role`, `revoke_role`, `revoke_did`) is gated by possession and consumption of the on-chain admin token described in [On-chain](#on-chain) above — there is no witness secret or local vault involved

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

## Official Resources

- 1AM Wallet beta installer: https://1am.xyz/install-beta
- Midnight developer documentation: https://docs.midnight.network/
- Midnight getting started / toolchain install: https://docs.midnight.network/getting-started
- Midnight JS SDK repository: https://github.com/midnightntwrk/midnight-js

## Release Notes

### v0.9.0

- **Fixed existing agents showing no DID** — the DID directory fetch is session-gated but ran at mount, keyed off a contract address restored from `localStorage`, so it fired before `login()` had produced a session, took a 401, and never retried. Only returning users with a saved agent were affected, which is why it looked specific to *existing* agents.
- **Fixed recurring 401s from the customer/request loader** — same premature-fetch race, triggered by wallet connect rather than by an established session. Both loaders now share one `canLoadSessionScopedData()` guard and re-run when the session lands.
- **Fixed the API server dying when the database went away while idle** — the `pg` pool had no `'error'` listener, so a terminated idle connection (`docker stop`, host failover, idle timeout) killed the process via an unhandled `'error'` event. It now logs and stays up, reconnecting on the next query.

### v0.8.8

- **Critical contract fix, breaking** — `admin_token_color` is no longer computed in the constructor. Verified against two distinct real preprod deployments that `tokenType(adminDomainSep(), kernel.self())` evaluated in the constructor produced the *same* color for different contracts — the admin token was not actually bound to a specific deployment. It's now computed inside `register_initial_admin()`, the same circuit that performs the mint. Contracts deployed before this fix cannot be patched — redeploy required. See [Constructor](#constructor).
- **Deploy split into three independent steps** — "Deploy" and "Initialize Admin" are now separate, separately-retryable actions in the UI (previously chained in one call), so a failure in the admin-mint transaction no longer masquerades as a deploy failure and doesn't require redeploying to retry.
- **Fixed the deployed Static Site not serving its own ZK proving keys** — both the app's custom circuit keys and the protocol's builtin keys (`midnight/zswap/*`, `midnight/dust/spend`, needed by any circuit that mints a shielded coin) now serve correctly in production; the previous attempt used percent-encoded flat filenames that Render's CDN doesn't resolve (it decodes `%2F` back to `/` first).
- **Fixed wallet-connect and wallet-selection UI bugs**: connecting no longer times out after 15s if a wallet's approval prompt opens in a detached window and a human takes longer than that to click it; the wallet dropdown no longer snaps back to the previously-connected wallet when picking a different one.

### v0.8.7

- **Genesis admin token bootstrap split into two transactions** — owner decision, 2026-07-21, not a regression. The constructor now only deploys the contract; a new, second `register_initial_admin()` call (a separate transaction, run immediately after deploy by the app's own deploy flow) mints the genesis admin token. The atomic version shipped in v0.8.3 (below) was found to interfere with wallet-side transaction balancing during live preprod testing. Still coin-based, not `ownPublicKey()`-based — see [Constructor](#constructor) and `sdd/wip/005-coin-gated-admin-access/decision-log-2026-07-21.md` for the full rationale, including the accepted bootstrap race-condition tradeoff.
- **Midnight SDK aligned to the official support matrix** — `@midnight-ntwrk/ledger-v8` (`^8.0.3` → `^8.1.0`) and the eight `@midnight-ntwrk/midnight-js-*` packages (→ `^4.1.1`), matching Mainnet's alignment with Preprod's infrastructure versions (Node 1.0.0, Ledger 8.1.0, Indexer 4.3.3, Proof Server 8.1.0). `@midnight-ntwrk/midnight-js-types` added as an explicit direct dependency (previously an undeclared transitive dependency).
- **Fixed a stale cross-network deployment display bug** — the "last deployed contract" cache was not scoped by network, so a contract deployed on one network (e.g. preview) could incorrectly appear as already deployed after switching networks (e.g. preprod).

### v0.8.3

- **Security fix: forgeable `ownPublicKey()` admin authorization replaced with coin-gated authorization** — every admin-tier operation on `did_registry.compact` (`mint_capability_tokens`, `issue_did`, `grant_role`, `revoke_role`, `revoke_did`) used to be authorized by comparing `ownPublicKey()` against a role recorded in `role_by_key`. `ownPublicKey()` is not cryptographically bound to a transaction's actual signer, so that check was forgeable — any caller could potentially claim admin authority under the previous model. It is replaced by `consumeAdminToken()`, rooting authorization in possession-and-consumption of a real shielded coin of a single dedicated `admin_token_color`, the same mechanism already used for capability-token gating. No long-lived secret, witness, or local vault is introduced.
- **Genesis admin token minted atomically at deploy** — the constructor now takes `(salt, admin_recipient, admin_coin_nonce, admin_supply)` and mints the genesis admin token directly to `admin_recipient` in the same transaction that deploys the contract. The previous two-step bootstrap — deploy, then a separate `ownPublicKey()`-gated `register_initial_admin()` call — is gone; `register_initial_admin()` no longer exists, so the forgeable bootstrap window it created is structurally impossible to reintroduce.
- **New `rotate_admin_tokens` circuit** — lets a holder atomically burn their admin token and mint a fresh one to a chosen recipient (self or delegate) with a caller-chosen spendable-credit count, without ever passing through a zero-valid-admin-token state. Both the burn and the mint execute in the same circuit body as one atomic unit of the transaction.
- **ISSUER role removed** — `issue_did` used to accept `is_admin || is_issuer`; it is now gated purely by `consumeAdminToken()`, collapsing to a single admin-tier authorization gate. The `issuerRole()` circuit is deleted.
- **`request_update_did` gains a DID-linked token check** — the presented capability-token coin must match the color originally bound to that DID in `did_token_color`; a different, otherwise-valid capability-token color is now rejected, closing a gap where any valid token could authorize an update to any DID.
- **Legacy pre-unification code removed** — `src/lib/did/api.ts` (the orphaned `DidRegistryAPI` class exercising the old two-step, `ownPublicKey()`-gated bootstrap) and `src/lib/didContract.ts` are deleted; the 5 test files exercising that pre-unification architecture are removed rather than ported forward. See [Contract Directory Notes](#contract-directory-notes) for the now-archived `token_gating.compact`.

### v0.8.2

- **Wallet token metadata clarified** — 1AM `Kind: unknown` / `Verified: No` are wallet metadata labels, while didMN validates action-credit colors through the active token-gating contract.
- **Action credit verification UI** — token balances are classified against token-gating `valid_colors`; raw balance includes the permanent anchor unit.
- **Registry access fix** — admin access derives role lookup from the 32-byte shielded coin public key while leaving the SDK wallet provider's ledger coin key untouched.

### v0.8.1

- **Token gating hardened** — anti-replay via `nullifier_proxy = persistentHash(coin.nonce)`; commitment is 5 elements binding each spend to a specific nullifier
- **Anchor token** — the last token (value=1) is the permanent ownership anchor and cannot be spent
- **DID-color binding** — token color stored in `did_token_color` map, linking each DID key to its token contract color
- **Admin deploy panel** — 3-step flow (Load Artifact → Deploy Token Gating → Deploy DID Registry); steps are gated sequentially; re-deploy warning banner if a token gating contract address already exists in localStorage

### v0.8.0

- **Token gating contract** — new `contracts/token_gating.compact`; admin mints shielded action-credit tokens and users prove ownership without revealing balance
- **Two-TX privileged flow** — `self_register_did`, `grant_role`, `revoke_role`, and `revoke_did` now require a prior TX1 (`consume_token_for_action`) before the registry TX2
- **DID registry constructor updated** — `contracts/did_registry.compact` now takes a `token_contract: ZswapCoinPublicKey` constructor argument; deploy order matters (token gating first)
- **`npm run compile-all`** — new unified compile script; runs `compile-token-gating` → `compile-contract` → `compile-ownership-proof` in order; recommended over individual scripts
- **Token gating managed artifacts** — `contracts/managed/token-gating/` and `public/contracts/managed/token-gating/`; `src/generated/tokenGatingContract.runtime.js`

### v0.7.0

- **DID Registry v2 contract** — complete rewrite from `issuerSecret()` witness model to `ownPublicKey()` / `ZswapCoinPublicKey` controller model
- **Self-registration** — any wallet can register a DID slot through the original v2 self-registration circuit without a local secret
- **On-chain role system** — ADMIN, ISSUER, USER, AGENT roles stored in `role_by_key` map; admin bootstrap via `register_initial_admin()`
- **DID key derivation** — `hash("didmn:did:v1", registry_salt, ownPublicKey(), subject_nonce)` replaces agent-key-based derivation
- **Removed** — `issuerSecret()` witness, owner vault backup, `OwnerVaultBackupPayload`, `ensureOwnerPrivateState`, `status_by_agent`, `organization_labels`, `organization_disclosures`, `request_commitments` ledger fields
- **vitest config** — added `vitest.config.ts` with `setupFiles` window shim and proper test exclusions; 162 tests pass

### v0.6.5 and earlier

See git log for prior release notes.

## Tested Versions

- Application version: `0.9.0`
- Compact compiler: `v0.31.0` (`pragma language_version >= 0.23 && <= 0.23`)
- Midnight JS SDK family: `4.1.1`
- Midnight DApp connector API: `4.0.1`
- Midnight ledger / proof stack: `8.1.0`
- 1AM Wallet: Beta channel from the official installer at `https://1am.xyz/install-beta`

For the Midnight SDK, the main package set currently pinned in this repository is:

- `@midnight-ntwrk/midnight-js-contracts@^4.1.1`
- `@midnight-ntwrk/midnight-js-fetch-zk-config-provider@^4.1.1`
- `@midnight-ntwrk/midnight-js-http-client-proof-provider@^4.1.1`
- `@midnight-ntwrk/midnight-js-indexer-public-data-provider@^4.1.1`
- `@midnight-ntwrk/midnight-js-level-private-state-provider@^4.1.1`
- `@midnight-ntwrk/midnight-js-network-id@^4.1.1`
- `@midnight-ntwrk/midnight-js-types@^4.1.1`
- `@midnight-ntwrk/midnight-js-node-zk-config-provider@^4.1.1`
- `@midnight-ntwrk/midnight-js-utils@^4.1.1`
- `@midnight-ntwrk/ledger-v8@^8.1.0`

Note:

- this repository references the official 1AM Beta installer, but does not pin a wallet version number in code
- if 1AM publishes a specific public Beta version identifier, update this section accordingly

## Coin-Gated Authorization (v0.9)

As of v0.9, all access control on `did_registry.compact` — both the capability-token
gating that previously lived in a separate `token_gating.compact` contract and the
registry's own admin authorization — is unified into one coin-gated model on a single
contract. There is no owner secret, no witness, and no local vault backup required
anywhere in this design; see [On-chain](#on-chain) above for the full circuit-level
description of `consumeToken()`, `consumeAdminToken()`, and `rotate_admin_tokens`.

### Why shielded coins, not identity checks

A naive design would authorize privileged calls by comparing `ownPublicKey()` against
a role recorded on-chain. That check is forgeable: `ownPublicKey()` is not
cryptographically bound to a transaction's actual signer, so any caller could
potentially claim a role under that model. This repository instead roots every
privileged operation in possession-and-consumption of a real shielded coin: the caller
must present a `ShieldedCoinInfo` of the expected color with an unused nullifier, which
the circuit burns (or partially spends, returning change) as part of the same
transaction that performs the state change. Forging that requires either holding a
genuinely minted coin or breaking the underlying shielded-coin cryptography — a
materially stronger guarantee than a self-reported public key.

### Two token colors, one contract

- **Capability tokens** — minted per-recipient by `mint_capability_tokens`, colored by
  `persistentHash(subscription_key)`. Gate `gated_self_register_did` and
  `request_update_did` via `consumeToken(coin)`, which checks `coin.color` against the
  `valid_colors` set (many colors, one per subscription).
- **The admin token** — a single dedicated color, `admin_token_color =
  tokenType(pad(32, "didmn:admin-token:v1"), kernel.self())`, fixed for the life of the
  contract and distinct by domain separator from every capability-token color. Gates
  `mint_capability_tokens`, `issue_did`, `grant_role`, `revoke_role`, and `revoke_did`
  via `consumeAdminToken(coin)`, which checks **exact equality** against
  `admin_token_color` (one color, not a set).

Both helpers share the same `used_capability_nullifiers` replay-protection map,
namespaced by `(coin.color, coin.nonce)` so an admin-coin nullifier can never collide
with a capability-coin nullifier that happens to reuse the same nonce.

### Admin: granting capability tokens

The admin grants capability tokens to users via the admin panel:

- the admin Action Credits panel calls `mint_capability_tokens` (itself admin-token
  gated) to mint a new shielded capability allocation for a user
- internal `grantSubscription` / `renewSubscription` helpers remain available for
  service-layer grant and top-up flows

Each capability-gated action on the registry consumes exactly 1 credit.

### Anchor unit

Every mint — capability tokens via `mint_capability_tokens`, and the admin token via
the constructor or `rotate_admin_tokens` — follows the same `amount + 1` shape: 1
permanent anchor unit plus `amount` spendable credits. The anchor cannot be spent
(`consumeToken`/`consumeAdminToken` require `coin.value >= 2` and always return 1 unit
as change), so a holder's wallet always retains a non-zero proof of their token
allocation.

### DID-color binding

When a wallet first self-registers a DID via `gated_self_register_did`, the capability
token's color is stored in the `did_token_color` map, keyed by the DID key. Later
calls to `request_update_did` for that DID must present a coin of that exact color —
any other valid-but-unrelated capability-token color is rejected — binding the
specific token allocation to that DID for its lifetime.

### Wallet token metadata

Wallets may display newly minted didMN action-credit or admin tokens with generic
metadata such as `Kind: unknown` and `Verified: No`. Those are wallet-local token
metadata labels, not DID registry authorization results.

didMN verifies tokens in the app and contract:

- the contract records every minted capability-token color in `valid_colors`, and the
  single admin color in `admin_token_color`
- `consumeToken`/`consumeAdminToken` reject any shielded coin whose color is not
  recognized (set membership for capability tokens, exact match for the admin token)
- the app classifies wallet balances as `Action credit` / `Verified` when the color is
  recognized by the active registry contract
- raw balance includes the permanent anchor unit; spendable credits are
  `rawBalance - 1` when `rawBalance > 1`

For example, a raw balance of `6` means `5` spendable registry actions plus `1` permanent anchor.

### Operations that require a token

Capability-token gated (`consumeToken`):

- `gated_self_register_did`
- `request_update_did` (must be the DID's own linked color)

Admin-token gated (`consumeAdminToken`):

- `mint_capability_tokens`
- `issue_did`
- `grant_role`
- `revoke_role`
- `revoke_did`

There is no operation gated by role identity alone — every privileged circuit consumes
a coin.

Subject nonce:

- the default subject nonce is `SHA-256("didmn:default-slot:v1")` = `ba3649522b461286f41043ca6548f1d5dcd2c3e74e1d59fa74102fc1eb1ce531`
- custom nonces can be supplied to create multiple DID slots per wallet

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
    "organizationName": "Matrix Labs",
    "organizationDisclosure": "disclosed",
    "requestPayload": {
      "agentName": "Agent Smith",
      "description": "Customer support agent",
      "proposedServices": [
        {
          "type": "AgentEndpoint",
          "serviceEndpoint": "https://agent.example.com"
        }
      ]
    }
  }'
```

The MCP key supplies the customer, registry, network, and approved holder-wallet routing. The agent payload is a bounded proposal and cannot set authoritative DID fields. See [MCP DID request format](docs/mcp-did-request-format.md) or read `didmn://guide/request-payload` from the MCP server.

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

The repository tracks Compact source files, not generated Compact build outputs. Generated managed runtimes, proving/verifier keys, ZKIR assets, and metadata snapshots are local products of `npm run compile-all` and are ignored by Git.

- [contracts/did_registry.compact.template](./contracts/did_registry.compact.template)
  Editable Compact source for the unified gated DID registry (v3.0.0). This is the
  file to change — `contracts/did_registry.compact` is generated from it by
  `scripts/compile-contract.js`, which substitutes `__CONTRACT_VERSION__` before
  compiling.
- [contracts/did_registry.compact](./contracts/did_registry.compact)
  Generated Compact source actually compiled and deployed. Regenerated by
  `npm run compile-contract` / `npm run compile-all` — do not hand-edit.
- [contracts/archived/token_gating.compact](./contracts/archived/token_gating.compact)
  **Archived, not active.** Pre-unification token gating contract, kept for
  historical reference only. Its functionality was folded into
  `did_registry.compact.template` as of v3.0.0; there is no standalone compile step
  for it, and `npm run compile-all` does not touch it.

Local compile outputs:

- `contracts/managed/**`
- `public/contracts/managed/**`
- `src/generated/**`
- `contracts/compiled/**`

Those paths should not be committed. If they are missing, run `npm run compile-all`.
