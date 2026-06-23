# Agent Platform Interface Sequence

This diagram shows the agent-facing platform flow as a sequence architecture.
The vertical lifelines separate the external actor surfaces, platform interfaces,
platform core, Midnight registry boundary, and external verification boundary.

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

    DApp->>Wallet: Register or reference controller-bound DID
    Wallet->>Contract: self_register_did(subject_nonce)
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
