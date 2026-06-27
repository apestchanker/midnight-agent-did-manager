# Midnight Agent DID Manager

Midnight Agent DID Manager is a React + Vite application plus a local Node/Postgres service for managing a Compact DID registry on Midnight Network (Preprod or Preview), with shielded ZK token gating for privileged registry operations.

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
    HU(["👤 Human User / Agent Operator\n─────────────────────────────\nhuman-managed account\nor AI agent with wallet-controlled key"])

    FE["🖥️ React Frontend — DApp\n─────────────────────────────\n• connect Midnight wallet\n• self-register · issue · update · revoke DID\n• user · admin · registry views\n• private state in browser localStorage"]

    WL["🔐 Midnight Wallet\n─────────────────────────────\n• 1AM · Lace (via window.midnight API)\n• ownPublicKey() controller binding\n• transaction signing and submission\n• built-in wallet prover or local proof server"]

    DS["🗄️ DID REST API — :8787\n─────────────────────────────\n• customer accounts and MCP keys\n• DID request persistence and approvals\n• VC issuance · resolution · verification\n• registry deployment records\n• Midnight proof material\n• backed by PostgreSQL"]

    MCP["🤖 MCP Server — :8788\n─────────────────────────────\n• AI agent interface (stdio · HTTP)\n• DID requests and proof flows\n• agent authentication via MCP keys"]

    CC["⛓️ Midnight Compact Contract\n─────────────────────────────\n• DID registry of record\n• party_status · role_by_key · did_controller\n• ADMIN · ISSUER · USER · AGENT roles\n• controller binding via ownPublicKey()"]

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

    DApp->>Wallet: Spend action credit, then register controller-bound DID
    Wallet->>TokenContract: consume_token_for_action(color, nullifier, commitment)
    Wallet->>Contract: self_register_did(subject_nonce, color, nullifier, commitment)
    Contract->>Contract: did_controller[did_key] = ownPublicKey()
    Contract-->>Wallet: DID slot registered

    Human->>DApp: Admin or issuer issues DID
    DApp->>Wallet: Sign issue transaction
    Wallet->>Contract: issue_did(did_key, commitments)
    Contract->>Contract: Set DID active
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

Two Compact contracts form the on-chain layer (v0.8+):

**`token_gating.compact`** — manages shielded token allocation and spend:

- admin mints tokens per user from the Action Credits panel through `mint_capability_tokens`
- users spend tokens via `consume_token_for_action`, producing a ZK proof
- tokens are shielded: balances and spend history are private
- `did_token_color` map binds a DID key to its token contract color
- anchor token (value=1) cannot be spent; it is the permanent ownership anchor
- anti-replay: commitment includes `nullifier_proxy = persistentHash(coin.nonce)`

**`did_registry.compact`** (v2, `ownPublicKey()` controller model) — the DID registry of record. Constructor takes `token_contract: ZswapCoinPublicKey`. It stores:

- controller binding through `ZswapCoinPublicKey` — the connected wallet's public key is the sole authority, no local secret
- DID key derived on-chain from `hash(domain, registry_salt, controller_public_key, subject_nonce)`
- DID lifecycle state via `party_status` map
- DID, document, proof, capability, and revocation commitments
- role-based access control (`role_by_key` map) with on-chain roles: ADMIN, ISSUER, USER, AGENT
- initial admin bootstrap as the first registered role in the contract

The registry is intentionally not the full Agent MultiPass payload. Mandates, limits, capabilities, authorization levels, detailed profile claims, and credential JWTs are represented off-chain and selectively disclosed through credentials, presentations, and proof material.

Authorization model (v2, v0.8+):

- `self_register_did(subject_nonce, token_color, nullifier, commitment)` — any wallet with a valid token can register a DID slot; the wallet's `ownPublicKey()` is the controller; requires TX1 token spend
- `register_initial_admin()` — first caller claims the ADMIN role; only callable once; no token required
- `grant_role`, `revoke_role`, `revoke_did` — ADMIN or ISSUER authorized via `ownPublicKey()` check; require TX1 token spend
- `issue_did` — ADMIN or ISSUER authorized via `ownPublicKey()`; no token required
- no `issuerSecret` witness; no local private state needed for authorization

Privileged operations follow a two-TX sequence: TX1 calls `consume_token_for_action` on the token gating contract; TX2 calls the registry operation.

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
- both Compact contracts compiled (`npm run compile-all`) before deploying — this produces the ZK proving/verifier keys required by the admin deploy panel

## Official Resources

- 1AM Wallet beta installer: https://1am.xyz/install-beta
- Midnight developer documentation: https://docs.midnight.network/
- Midnight getting started / toolchain install: https://docs.midnight.network/getting-started
- Midnight JS SDK repository: https://github.com/midnightntwrk/midnight-js

## Release Notes

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

- Application version: `0.8.2`
- Compact compiler: `v0.31.0` (`pragma language_version >= 0.23 && <= 0.23`)
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
- `self_register_did(subject_nonce, token_color, nullifier, commitment)` derives the DID key on-chain from `hash("didmn:did:v1", registry_salt, ownPublicKey(), subject_nonce)` after the token-gating contract records the matching TX1 spend
- the same wallet can call `register_initial_admin()` once to claim the ADMIN role
- `issue_did`, `grant_role`, `revoke_role`, `revoke_did` check `ownPublicKey()` against the stored role map at circuit execution time
- no local secret is generated, stored, or needed for recovery

As of v0.8, privileged operations (`self_register_did`, `grant_role`, `revoke_role`, `revoke_did`) also require the caller to hold a valid shielded token from the token gating contract. See [Token Gating (v0.8)](#token-gating-v08) below.

## Token Gating (v0.8)

Starting in v0.8, access to privileged DID registry operations is gated by shielded tokens issued through a separate `token_gating.compact` contract. Tokens are private: the user proves possession without revealing their balance on-chain.

### Why shielded tokens

The `ownPublicKey()` check proves which wallet is calling. The token gating adds a credit layer on top: the admin controls who has access (by minting tokens) independently of wallet identity. Users can hold tokens, consume them privately, and the registry verifies a ZK proof of valid spend — without the indexer or any observer learning the token balance or history.

### Two-TX flow

Every privileged registry operation requires two transactions in sequence:

1. **TX1 — `consume_token_for_action`** (token gating contract): spends one token unit, produces a ZK proof of valid spend with anti-replay nullifier. The commitment is a 5-element tuple that includes `nullifier_proxy = persistentHash(coin.nonce)`, binding the commitment to a specific spend.
2. **TX2 — registry operation** (`self_register_did`, `grant_role`, `revoke_role`, or `revoke_did`): the DID registry verifies the proof from TX1 before executing the state change.

### Admin: granting tokens

The admin grants tokens to users via the admin panel:

- the admin Action Credits panel calls `mint_capability_tokens` to mint a new shielded allocation for a user
- internal `grantSubscription` / `renewSubscription` helpers remain available for service-layer grant and top-up flows

Each action on the registry consumes exactly 1 credit.

### Anchor token

The last token (when remaining value = 1) is the permanent ownership anchor. It cannot be spent. This ensures a user's wallet always retains a non-zero proof of their token allocation, which serves as the ownership binding for the DID.

### DID-color binding

When a user first interacts with the token gating contract, the token color (the contract's coin type identifier) is stored in the `did_token_color` map, keyed by the DID key. This binds the specific token contract deployment to that DID for its lifetime.

### Wallet token metadata

Wallets may display newly minted didMN action-credit tokens with generic metadata such as `Kind: unknown` and `Verified: No`. Those labels are wallet-local token metadata labels, not DID registry authorization results.

didMN verifies action-credit tokens in the app and contracts:

- the token-gating contract records every minted token color in `valid_colors`
- `consume_token_for_action` rejects any shielded coin whose color is not in `valid_colors`
- the app classifies wallet balances as `Action credit` / `Verified` when the color is recognized by the active token-gating contract
- raw balance includes the permanent anchor unit; spendable credits are `rawBalance - 1` when `rawBalance > 1`

For example, a raw balance of `6` means `5` spendable registry actions plus `1` permanent anchor.

### Operations that require a token

- `self_register_did`
- `grant_role`
- `revoke_role`
- `revoke_did`

`register_initial_admin` and `issue_did` are not in this list (admin bootstrap and issuance remain role-gated only).

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

Compile all contracts and refresh managed assets:

```bash
npm run compile-all        # recommended — compiles all contracts in order
npm run compile-token-gating   # only token_gating.compact
npm run compile-contract       # only did_registry.compact
npm run compile-ownership-proof  # only native_ownership_proof.compact
```

`npm run compile-all` runs the three scripts in the correct order: token_gating → did_registry → ownership_proof. You must compile before deploying from the admin panel — the compile step generates the ZK proving/verifier keys (`.prover` and `.verifier` files). Full ZK compilation can take several minutes.

You need the official Midnight Compact compiler installed as `compact` or `compactc`.

Outputs:

- `contracts/managed/token-gating/` — token gating managed artifacts (keys, zkir, contract)
- `public/contracts/managed/token-gating/` — browser-served token gating assets
- `src/generated/tokenGatingContract.runtime.js` — token gating runtime JS
- `contracts/managed/did-registry/` and `public/contracts/managed/did-registry/` — DID registry artifacts (unchanged location)

Deploying from the admin panel (3-step flow):

1. **Load Artifact** — validates compiled artifacts for both contracts.
2. **Deploy Token Gating** — deploys `token_gating.compact`; displays and copies the contract address; persists it in localStorage. A warning banner appears if an address already exists (re-deploying invalidates existing DIDs).
3. **Deploy DID Registry** — deploys `did_registry.compact`, passing the token gating address from step 2 as the constructor argument. Step 3 is gated — unavailable until step 2 is complete.

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

The `contracts/` tree intentionally contains both source and generated artifacts used by the DApp:

- [contracts/token_gating.compact](/Users/alex/Documents/Developer/didMN/contracts/token_gating.compact)
  Compact source for the shielded token gating contract (new in v0.8)
- [contracts/did_registry.compact](/Users/alex/Documents/Developer/didMN/contracts/did_registry.compact)
  Compact source for the DID registry
- [contracts/managed/token-gating](/Users/alex/Documents/Developer/didMN/contracts/managed/token-gating)
  generated managed runtime, proving/verifier keys, and ZKIR assets for the token gating contract
- [contracts/managed/did-registry](/Users/alex/Documents/Developer/didMN/contracts/managed/did-registry)
  generated managed runtime, proving/verifier keys, and ZKIR assets for the DID registry
- [contracts/compiled/did_registry.compiled.json](/Users/alex/Documents/Developer/didMN/contracts/compiled/did_registry.compiled.json)
  generated metadata snapshot of the current DID registry contract

Inside `contracts/managed/did-registry`, both plain circuit filenames and `did-registry#...` aliases are kept intentionally. The aliased files are needed for the current Vite/browser asset lookup flow.

There should be no personal environment data, wallet secrets, or machine-specific local notes under `contracts/`. The files present there are generated build artifacts required by this repository, not temporary user-only state.
