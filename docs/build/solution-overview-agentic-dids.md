# Solution Overview: Agentic-DIDs

Week 2 deliverable #2, written with resource pack `problem_solution_resource_pack.pdf` §05 (problem → hypothesis). It converts the validated problem in `problem-statement-agentic-dids.md` into a concrete solution concept, names the privacy-preserving mechanism, sketches the user journey, and states a falsifiable hypothesis.

Status: solution hypothesis. The concept is grounded in the current implementation (Week 1 evidence anchors) and the 4-response survey, but the measurable-outcome thresholds are targets to test, not results.

Reads with: `problem-statement-agentic-dids.md` (the problem this answers) and `problem-solution-canvas-agentic-dids.md` (the one-page both-sides summary).

---

## 1. Core Concept (one sentence)

> **The Agent Pass:** a portable, human-approved, revocable credential that lets an AI agent prove — to any third party — its identity, who controls it, its current mandate, capabilities, limits, and authorization level, and that the grant is still active, while keeping the underlying policy, credentials, and operator data private.

The metaphor is a *pass* (think backstage pass / multipass): not just "this is who I am" but "this is what my human or organization has authorized me to do right now, and you can check it yourself."

---

## 2. From "How Might We" to Hypothesis

HMW questions generated from the root cause ("no primitive proves current, revocable authority without exposing policy"), clustered to the right altitude:

| # | How might we… | Cluster |
| --- | --- | --- |
| 1 | …let an agent prove its current mandate to a partner without handing over the policy that grants it? | Selective proof |
| 2 | …let a verifier check "still active / not revoked" without access to our internal status system? | Status proof |
| 3 | …make "who controls this agent" answerable in seconds, not a support thread? | Control proof |
| 4 | …keep names, DID documents, MCP keys, and policy off-chain while the proof stays verifiable? | Data minimisation |
| 5 | …require explicit human approval before an agent can act, and make that approval externally checkable? | Human-in-the-loop governance |

**Falsifiable hypothesis** (resource pack §05 template):

> We believe that **a portable, human-approved, revocable Agent Pass with selectively disclosable claims and externally verifiable status**
> will result in **agent builders being able to answer "which agent, who controls it, what's it authorized to do, is it still active?" without over-disclosing internal policy or asking the verifier to trust private logs**
> for **technical founders and platform engineers shipping externally-facing or production-adjacent AI agents (Segment A; secondarily Midnight ecosystem builders, Segment B)**
> because **the underlying pain is a verification-vs-disclosure trade-off, not a missing config field, and today they have no artifact that proves current authority and nothing more.**
> We'll know we're right when **at least 4 of the next 8 interviewed builders, shown the Pass, say it would replace a specific current workaround for a specific external/verifier interaction — and at least 2 attempt or commit to integrating the open-source reference.**

If the last line can't be observed, the hypothesis isn't testable — these thresholds are the Week 3+ test.

---

## 3. The Privacy-Preserving Mechanism

This is the part that makes the Pass different from "a DID plus an API key." Each user pain maps to a privacy primitive; the substrate is Midnight as the privacy-preserving trust layer for DID lifecycle state, commitments, and proof-oriented workflows.

| Capability the Pass proves | Mechanism | What stays private |
| --- | --- | --- |
| **Identity** — stable, verifiable agent identifier, currently active | Agent DID anchored on Midnight; resolver/validation surface | Full DID document, MCP keys, operator metadata |
| **Control** — a human/org/wallet/issuer approved this agent | Human-approved DID issuance; control bound to holder | Holder identity (disclosed or undisclosed per policy) |
| **Mandate / capabilities / limits** — what it may do, with boundaries | Selectively disclosable credentials; proof of a claim without the claim's full payload | The policy graph, scopes, prompts, proprietary workflow logic |
| **Authorization level** — permission tier | Proof of tier without exposing the internal policy that sets it | Internal policy, every other tier's rules |
| **Status** — active / expired / suspended / revoked | Status/revocation proof against on-chain commitment state | The internal status system and revocation reasons |

Data-minimisation posture: anchor **commitments and proof material**, not payloads. Names, DID documents, MCP keys, workflow data, and detailed policy stay off-chain.

> Verification gate: the primitives above are described at product-framing level, consistent with Week 1 docs and the proof roadmap. Before any of these statements becomes an implementation claim in a technical spec (what a Compact circuit proves, what is written on-chain, disclosure rules), it must be verified with `/verify` or the midnight-verify agents. The current repo distinguishes JWT VC bundles, commitment material, and native ownership-proof validation — the proof roadmap (`docs/midnight-proof-roadmap.md`, evidence anchor E4) tracks the path from bundles toward holder-generated Midnight proofs. Do not over-claim "proof" beyond what the current build supports.

---

## 4. High-Level User Journey

The current product flow (Week 1 evidence E1) mapped to the actors in `docs/identity-architecture.md` (E2):

1. **Link & set up (human customer / operator).** Connect a wallet, create MCP/API keys. The operator is the human-in-the-loop control point.
2. **Request (agent).** The agent (or its builder) requests a DID and the credentials that encode its mandate, capabilities, limits, and authorization level.
3. **Approve & issue (operator / issuer admin).** The human explicitly approves the request; the issuer issues the DID and selective-disclosure credentials. Nothing acts without this approval.
4. **Act & present (agent → verifier).** In a workflow, the agent presents only the proof a verifier needs — e.g. "controlled by an approved holder, may call this billing API read-only, authorization level 2, active" — without exposing the rest.
5. **Verify (registry verifier / external party).** The verifier validates identity, the disclosed claims, and current status via the resolver/validation surface, without privileged access to the operator's internal systems.
6. **Revoke / expire (operator).** On key rotation, agent retirement, or client offboarding, the operator revokes or lets the mandate expire; verifiers see status change to revoked/expired — closing the stale-permission gap that Week 1 flagged as real, not theoretical.

Verifier-facing summary of what they get to check: **identity · control · mandate · capabilities · limits · authorization level · status** — and nothing else.

---

## 5. Packaging (carried from Week 1, to validate)

| Layer | What it is | Validate |
| --- | --- | --- |
| **Open-source reference** | The Agent Pass primitive: DIDs, mandate/capability credentials, MCP/API flows, proof-roadmap artifacts. Forkable, inspectable, citable in ecosystem proposals. | Whether builders fork/integrate it (hypothesis signal #2 above). |
| **Hosted platform / managed service (later)** | Issuance, mandate/capability templates, status validation, credential APIs, monitoring, revocation, proof workflow infra for teams that don't want to operate the stack. | Willingness-to-pay — the open worth-solving gap from the problem statement. |

---

## 6. Risks This Solution Must Survive (Cagan's four)

| Risk | Question | Current read |
| --- | --- | --- |
| **Value** | Will builders use it over API keys + logs? | Strong for external/production-adjacent agents; weak for internal prototypes. Test with the slice. |
| **Usability** | Can a builder issue and a verifier check a Pass without deep ZK/DID knowledge? | Unproven. The "Agent Pass" metaphor exists to reduce this; test naming and onboarding. |
| **Feasibility** | Can the current build actually prove these claims (vs. bundle them)? | Partial — proof roadmap is mid-transition. Gate every "proof" claim behind verification. |
| **Viability** | Will anyone pay for the hosted layer? | Unknown. No paid-budget signal yet in the 4-response sample. |

---

## Solution-Overview Definition of Done

- [x] Names the **core concept** in one sentence (Agent Pass).
- [x] Names the **privacy-preserving mechanism** (selective disclosure / proof of current authority + status, anchored on Midnight, data-minimised).
- [x] Gives a **high-level user journey** (link → request → approve/issue → present → verify → revoke).
- [x] States a **falsifiable hypothesis** with an observable signal and threshold.

Next: fold this into the one-page `problem-solution-canvas-agentic-dids.md`.
