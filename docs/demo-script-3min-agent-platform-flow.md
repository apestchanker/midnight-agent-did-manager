# 3-Minute Demo Script: Agent Platform Flow (English)

This script is for a narrated screen recording of the app. It assumes the local
API, MCP server, frontend, wallet, database, and a registry contract are already
available before recording.

For large on-screen text while recording, open the standalone teleprompter:
[demo-teleprompter-3min-agent-platform-flow.html](./demo-teleprompter-3min-agent-platform-flow.html).

## Demo Goal

Show the complete agent identity flow from the app:

1. A human operator controls the platform through a wallet.
2. The human creates an MCP key for an agent.
3. The agent uses that key to request a DID.
4. The human approves the request.
5. The admin or issuer issues the DID on-chain.
6. The agent can present a DID, credentials, and proof material to a verifier.

## Pre-Recording Setup

Prepare this before pressing record:

- Frontend open on the app.
- DID REST API running on `:8787`.
- MCP HTTP server running on `:8788`.
- Postgres running with a clean or known demo dataset.
- Wallet connected or ready to connect.
- Registry contract already deployed, or deployment data already available.
- At least one demo agent name ready, for example `Agent Smith`.
- If live on-chain issuance may be slow, pre-create a pending request and an already-issued DID so the video can show both states without waiting.

## 3-Minute Timeline

| Time      | Screen Action                                                                                                                                                   | Voiceover                                                                                                                                                                                                                                                                   |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00-0:15 | Open the app on the main dashboard. Show the left navigation: `User`, `Registry`, `Admin`, and `Deploy DID Registry` if visible.                                | "This is the Agentic Multipass Demo. The idea is simple: before an AI agent acts for a human or organization, it should be able to operate safely, proving who it is, who controls it, what has been approved for it to do, and whether that authority is still active."    |
| 0:15-0:35 | Go to `User`. Show wallet/customer area and selected agent. If needed, select or create the demo agent.                                                         | "The flow starts with the human operator. The operator connects a Midnight wallet and manages one or more agents from the user view. The wallet is important because the DID controller is not just an app account; it is bound to the wallet public key used by Midnight." |
| 0:35-0:55 | Open `Human + MCP`, then show customer summary and MCP key area. Click or point to `Create MCP Key`. If creating live, avoid showing the full key for too long. | "For agent-driven workflows, the human creates an MCP key. This key is an off-chain credential for the agent to call the local DID service. The plaintext is shown only at creation time, while the service stores only the hashed key."                                    |
| 0:55-1:15 | Show the MCP key result, scopes, or assigned key list. Optionally switch to logs showing MCP/API activity.                                                      | "The key does not go on-chain. It is a controlled interface into the platform. The agent can use it through the MCP server or through the REST API, and the scopes determine which tools the agent is allowed to see and call."                                             |
| 1:15-1:35 | Show the pending request state in `Human + MCP` or the human approval queue. If the request is already prepared, select it.                                     | "Now the agent submits a DID request. In the platform this lands as a pending human approval, not as an automatic issuance. That is the human-in-the-loop control point: an agent can ask, but the holder must approve."                                                    |
| 1:35-1:55 | Click or point to the human approval action. If doing it live, approve the request with the connected wallet.                                                   | "When the human approves, the app registers or references a DID controlled by the connected wallet. On Midnight, the registry stores the controller binding as the wallet public key returned by `ownPublicKey()`. That makes the wallet the authority for this DID slot."  |
| 1:55-2:15 | Switch to `Admin`. Show the admin review queue with the approved request. Click or point to `Issue On-Chain as Admin`.                                          | "After human approval, the request moves to the admin or issuer side. The admin reviews the approved request and issues the DID on-chain. The Compact registry is the source of truth for lifecycle state: active, revoked, roles, and controller binding."                 |
| 2:15-2:35 | Show the issued DID in `Registry` or the selected agent DID details. Highlight active status, DID identifier, and credentials panel if visible.                 | "Once issued, the DID becomes resolvable. The off-chain service exposes the DID document, JWT verifiable credentials, and proof material, while the registry remains the public anchor for status and revocation."                                                          |
| 2:35-2:50 | Open `Credentials` or proof-related panel. Show ownership/name/organization credentials or proof package fields.                                                | "The Agent MultiPass layer sits on top of that DID. Instead of putting the full agent profile or policy on-chain, the platform uses credentials and selective disclosure. A verifier can receive only the claims needed for a specific interaction."                        |
| 2:50-3:00 | End on `Registry` proof verification or the sequence diagram if you want a clean closing visual.                                                                | "So the complete flow is: human creates the agent interface, agent requests identity, human approves, admin issues on Midnight, and external systems can verify the agent's status and credentials without trusting private platform logs."                                 |

## Expanded Voiceover Read

Use this as a recording helper or teleprompter. The bracketed lines are screen
cues; do not read them out loud.

### 0:00-0:20 — Opening

[Screen: Start on the main app dashboard with the sidebar visible.]

"This is the Midnight Agent DID Manager. What I want to show in this short demo
is the full control flow for giving an AI agent a verifiable identity. The core
problem is that agents are starting to act across APIs, tools, and external
systems, but most integrations still rely on private logs, plain API keys, or
internal accounts to explain who the agent is and who approved it.

This project takes a different approach. It gives the agent a DID-based identity
anchored on Midnight, and then layers credentials and proof material on top of
that identity. The result is an Agent MultiPass-style flow: a human can approve
an agent, the registry can track whether that DID is active or revoked, and an
external verifier can check the status and selected claims without needing to
trust the platform's private database."

### 0:20-0:45 — Human Operator And Wallet Control

[Screen: Go to `User`. Show the connected wallet and the agent area.]

"The flow starts with the human operator. In this view, the human connects a
Midnight wallet and manages one or more agents. This distinction matters because
the wallet is not just a login convenience. In the current registry model, the
wallet public key is the controller that Midnight sees on-chain.

So when this app registers or updates DID state, the authority is not coming
from a browser-local secret or from a backend admin flag. It is bound to the
wallet identity that signs the transaction. That gives us a cleaner separation:
the app coordinates the workflow, but the registry authorization is enforced by
the Midnight contract."

### 0:45-1:10 — MCP Key Creation

[Screen: Open `Human + MCP`. Show customer summary and the MCP key section.]

"For an agent-driven workflow, the human creates an MCP key. This key is the
agent's off-chain credential for calling the local DID service. It is generated
by the human account, it is shown in plaintext only once, and the service stores
only a hashed version in Postgres.

The important point is that this key is not the agent's on-chain identity. It is
an interface credential. It lets the agent talk to the platform through MCP or
through the REST API, and the key scopes determine which tools the agent is
allowed to discover and call."

### 1:10-1:35 — Agent Request

[Screen: Show MCP/API activity, the request form, or the pending request queue.]

"Now the agent can use that MCP key to submit a DID request. In a real
integration, this could come from an MCP client, an agent runtime, or an API
caller. The agent is effectively saying: I need a verifiable identity for this
registry, with this DID document, this wallet context, and these disclosed
claims.

But the request does not automatically become an issued DID. It lands in the
platform as pending human approval. That is the human-in-the-loop control point:
the agent can request identity, but the human holder has to review and approve
before anything moves toward issuance."

### 1:35-2:00 — Human Approval And Controller Binding

[Screen: Show the human approval queue. Approve the request or point to an
already-approved request.]

"When the human approves the request, the app registers or references a
controller-bound DID slot. On Midnight, the Compact contract derives the DID key
from the registry salt, the connected wallet's public key, and a subject nonce.
Then it stores the controller binding in the registry.

That means the DID is not just a random identifier in a database. It is tied to
the wallet that controls it. Future controller actions have to come from the
same wallet identity, because the contract checks the caller through
`ownPublicKey()`."

### 2:00-2:25 — Admin Issuance

[Screen: Switch to `Admin`. Show the admin review queue and the issue action.]

"After human approval, the request moves to the admin or issuer side. This is
where the registry authority reviews the approved request and issues the DID
on-chain. In this demo setup, the same wallet may be acting as the initial admin,
but the model still separates the holder approval step from the issuer/admin
issuance step.

The Compact registry is the source of truth for lifecycle state. It records
whether the DID is pending, active, revoked, or pending update. It also stores
the role bindings that allow admin and issuer operations. The backend persists
workflow data and credentials, but the authoritative lifecycle anchor is the
Midnight registry."

### 2:25-2:45 — Resolvable DID And Credentials

[Screen: Show `Registry`, the issued DID details, and credentials/proof material.]

"Once the admin issuance transaction is confirmed, the DID becomes active and
resolvable. The app can now expose a DID document, issuer-signed JWT verifiable
credentials, and Midnight-oriented proof material for selected disclosure
scopes.

The current MVP focuses on the identity and proof foundation: ownership, profile
name, organization, active status, and proof material. The broader Agent
MultiPass direction extends the same pattern to mandates, limits, capabilities,
and authorization levels."

### 2:45-3:10 — Verification And Closing

[Screen: End on proof verification, registry DID details, or the sequence
architecture diagram.]

"The final step is what makes the flow useful outside this app. An agent can
present its DID and selected credentials to an external verifier. The verifier
does not need to trust a screenshot or a private platform log. It can check the
DID status against Midnight, verify the issuer signature on the credentials, and
inspect only the disclosed claims needed for that interaction.

So the complete platform flow is: the human creates the agent interface, the
agent requests identity through MCP or API, the human approves, the admin issues
on Midnight, and external systems can verify the agent's identity, status, and
selected credentials with a privacy-preserving trust anchor."

## Compact Voiceover Read

Use this shorter version if the expanded read runs too long:

"This is the Midnight Agent DID Manager. The idea is simple: before an AI agent
acts for a human or organization, it should be able to prove who it is, who
controls it, what has been approved, and whether that authority is still active.

The flow starts with the human operator. The operator connects a Midnight wallet
and manages one or more agents from the user view. The wallet matters because
the DID controller is not just an app account. It is bound to the wallet public
key used by Midnight.

For agent-driven workflows, the human creates an MCP key. This key is an
off-chain credential for the agent to call the local DID service. The plaintext
key is shown only at creation time, while the service stores only the hashed
key. The key does not go on-chain. It is a controlled interface into the
platform. The agent can use it through the MCP server or through the REST API,
and the scopes determine which tools the agent is allowed to see and call.

Now the agent submits a DID request. In the platform this lands as a pending
human approval, not as an automatic issuance. That is the human-in-the-loop
control point: an agent can ask, but the holder must approve.

When the human approves, the app registers or references a DID controlled by the
connected wallet. On Midnight, the registry stores the controller binding as the
wallet public key returned by `ownPublicKey()`. That makes the wallet the
authority for this DID slot.

After human approval, the request moves to the admin or issuer side. The admin
reviews the approved request and issues the DID on-chain. The Compact registry
is the source of truth for lifecycle state: active, revoked, roles, and
controller binding.

Once issued, the DID becomes resolvable. The off-chain service exposes the DID
document, JWT verifiable credentials, and proof material, while the registry
remains the public anchor for status and revocation.

The Agent MultiPass layer sits on top of that DID. Instead of putting the full
agent profile or policy on-chain, the platform uses credentials and selective
disclosure. A verifier can receive only the claims needed for a specific
interaction.

So the complete flow is: human creates the agent interface, agent requests
identity, human approves, admin issues on Midnight, and external systems can
verify the agent's status and credentials without trusting private platform
logs."

## What To Avoid Saying

- Do not say the MCP key is on-chain. It is stored hashed in Postgres.
- Do not say every Agent MultiPass scope is fully implemented. The current MVP
  implements identity, ownership, profile/name, organization, status, and proof
  foundations; mandate, limits, capabilities, and authorization level are the
  extension path.
- Do not imply the full agent policy is public on-chain. Detailed claims live
  off-chain and are selectively disclosed.
- Do not describe the local Postgres custody model as production-ready secret
  custody. It is a research/prototyping persistence layer.

## Backup Ending If A Live Transaction Is Slow

"For the recording, I am switching to an already-issued demo DID so we can show
the final state without waiting on network timing. The important part is that
the issued state is anchored by the Midnight registry, while the credentials and
proof material are exposed through the platform resolver."
