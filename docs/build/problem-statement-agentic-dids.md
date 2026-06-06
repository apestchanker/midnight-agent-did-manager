# Problem Statement: Agentic-DIDs

This is a Week 2 problem-and-solution-identification draft for Agentic-DIDs, written with the frameworks in `problem_solution_resource_pack.pdf`. It builds directly on the Week 1 work in `customer-profile-agentic-dids.md` and `customer-interview-guide-agentic-dids.md`.

Status: evidenced hypothesis. The statement is grounded in 4 builder survey responses plus desk research on the current implementation. It is sharp enough to test, not yet proven. Treat severity/frequency numbers as directional until the 5–10 interviews land.

Companion artifacts:

- `problem-statement-worksheets-agentic-dids.md` — the reusable tools (problem-statement skeleton, 5 Whys, worth-solving quick test, privacy-framing check) used to produce this draft.
- Still to come this week (Week 2 Definition of Done): a solution overview and a completed Problem–Solution Canvas.

---

## One-Page Problem Statement

> Technical founders and platform engineers shipping AI agents that call external tools, partner APIs, wallets, or shared infrastructure cannot prove, to a third party, which agent is acting, who controls it, what it has been authorized to do right now, and whether that authority is still active — without either over-disclosing internal policy, credentials, and operator data, or asking the verifier to simply trust private logs. Today they patch this with API keys, OAuth scopes, wallet addresses, internal IDs, and screenshots of logs, which prove possession of a secret but not current, revocable, verifiable mandate. The gap turns into delayed integrations, support and security back-and-forth, and stale-permission risk the moment an agent leaves a prototype and touches something it does not own.

This statement follows the section-01 structure from the resource pack. Each component is broken out below with its evidence.

| Component | Content |
| --- | --- |
| **Who** | Technical founders, platform/infra engineers, and security reviewers building or operating MCP-enabled or API-driven AI agents — not "people," and not end users. Sharpest where the agent interacts with external systems, partners, wallets, or production-adjacent workflows. (Segment A in the customer profile; secondarily Midnight ecosystem builders, Segment B.) |
| **Situation** | The pain surfaces at an integration or trust boundary: when an agent moves from a demo into a workflow where a customer, partner, maintainer, or external system has to decide whether to trust it. Trigger moments include onboarding an agent to a partner API, a security/code review, a key rotation, an agent retirement or client offboarding, or a verifier asking "which agent is this and is it allowed to do that?" |
| **Pain** | They try to *prove* — to someone outside their own system — agent identity, who controls it, its current mandate, limits, capabilities, authorization level, and active/revoked status. They fail, because the things they can show (an API key, a log line, a wallet address) demonstrate possession of a secret, not a current, verifiable, revocable grant of authority. The verb is **prove**, not "store" or "configure." |
| **Evidence** | From the first 4 builder survey responses (`customer-profile-agentic-dids.md`, "First Survey Findings"): respondents repeatedly named current purpose/mandate, allowed tools/actions, limits, authorization level, status, and audit history as things that *should be easy to verify*. Current workarounds were fragmented across "API keys, OAuth/service accounts, wallet addresses, internal IDs, logs, config files, policy files, documentation, tickets, prompts, hard-coded rules, and manual review." Verbatim: *"Identity declares clientName on the MCP handshake; permissions are env-var presence."* *"Maintainers wanted to verify what actions the agent could perform and whether it had authority to approve or merge changes."* *"A simple way to prove what a system is allowed to do without exposing private inputs, plus clear auditability and revocation."* Quantitatively: average severity 3.0/5, average frequency 2.25/5, average trust 6.5/10 — moderate today, rising sharply for the one respondent integrating external APIs and shared infrastructure and the fintech code-review agent with production/security risk. |
| **Gap** | Existing alternatives prove the wrong thing or leak too much. API keys/OAuth prove *possession*, not *current mandate*, and revoke silently with no third-party-checkable status. Logs and docs are internal, unverifiable, and trust-me. DIDs alone answer "who" but not "authorized to do what, right now." Full disclosure (sharing policy files, scopes, deployment records) closes the trust gap but over-discloses business and operator data — respondents described withholding "prompts, credentials, infrastructure details, wallet/security data, private inputs, and proprietary workflow logic." There is no portable artifact that proves *current authority* and *nothing more*. |
| **Privacy framing** | At the center is a verification-vs-disclosure trade-off: a verifier needs enough proof to trust the agent's identity and current authority, while the operator needs to keep internal policy, credentials, full DID documents, and workflow data private. The data at stake is the mandate/capability/authorization graph and operator/organization metadata; the trust at stake is whether an external party can rely on the agent without being given privileged internal access. |

---

## Symptom vs Root Cause (5 Whys)

The first-draft complaint is a symptom. The 5 Whys (resource pack §02) pushes it down to a root cause that, if addressed, makes the surface pain go away. Worked below; the blank worksheet lives in `problem-statement-worksheets-agentic-dids.md`.

| Level | Statement |
| --- | --- |
| **Surface pain** | "When a partner or reviewer asks which agent this is and whether it's allowed to act, I can't give them a clean answer." |
| **Why 1** | Because the only things I can hand over are an API key, a log line, or a wallet address. |
| **Why 2** | Because those artifacts prove *possession of a secret*, not *a current, scoped grant of authority*. |
| **Why 3** | Because authorization lives implicitly across env vars, OAuth scopes, prompts, policy files, and internal docs — there is no single thing that *represents* the mandate. |
| **Why 4** | Because there is no portable, verifiable representation of "this agent, controlled by this holder, may do exactly this, until this expiry, unless revoked." |
| **Why 5 (root)** | Because proving current authority externally would require either exposing the internal policy/credentials (over-disclosure) or asking the verifier to trust private state (no proof) — there is no primitive that lets you prove current, revocable authority while keeping the underlying policy and operator data private. |

**Root-cause test (resource pack §02 diagnostic rule):** the surface pain is a *missing feature* framing ("I can't show a clean answer"). Why 5 reaches a *missing belief/behaviour* framing — operators assume that proving authority means leaking policy, so they fall back to trust-me logs or over-broad scopes. If the root is addressed (a primitive that proves current, revocable authority without exposing policy), the surface complaint disappears. That is the signal we are at root, not symptom.

---

## Is This Worth Solving?

Worth-solving quick test from resource pack §03, scored against Week 1 evidence.

| Test | Answer | Basis |
| --- | --- | --- |
| **1. Three real people who felt this in the last 30 days?** | Partial — yes in-sample, needs more. | 3 of 4 survey respondents had built/operated agent prototypes in the last six months; 2 of 4 had agents touching external systems; the automation builder and the fintech code-review agent described concrete, recent friction. Not yet three named people inside a 30-day window — this is the first thing interviews must close. |
| **2. Do they spend time or money on a workaround today?** | Yes (time). | 3 of 4 have already allocated engineering or security time to identity, authorization, compliance, audit, or trust problems. No direct paid-budget signal yet — willingness-to-pay is unproven. |
| **3. Is the underlying behaviour growing?** | Yes. | Agents are moving from demos into external, partner-facing, and production-adjacent workflows; the pain sharpens exactly at that transition. The whole segment is on that curve. |
| **4. Does a 10% better solution change their day noticeably?** | Conditional. | Strong yes for external/security-sensitive agents (replaces back-and-forth, unblocks integrations). Weaker for internal-only prototypes, where trust is currently 6.5/10 and "good enough." |

**Verdict:** 3 of 4 tests are strong or trending strong; test 1 (frequency of acute, named pain) and willingness-to-pay are the weak points. The problem is worth solving *for the external/production-adjacent slice* of agent builders. Do **not** position around internal-prototype convenience. Next interviews exist to convert test 1 from "partial" to "yes" with named, dated incidents — per the customer profile, recruit builders with external, partner-facing, fintech/security, or production-adjacent agents.

Sizing note (bottom-up, defensible at pre-seed): size from the slice, not the category — number of teams shipping externally-facing agents × frequency of integration/verification events × cost of a blocked or delayed integration. Avoid top-down "agent identity TAM" claims; they are not load-bearing yet.

---

## Privacy-Framing Check

Resource pack §04 requires restating the problem so every bracket is filled. If it can't be filled, the privacy angle isn't load-bearing.

> **[Agent operators]** want to **[prove an agent's current identity, control, mandate, capabilities, limits, authorization level, and active status]** without **[disclosing internal policy, credentials, full DID documents, workflow data, and operator/organization metadata to a verifier or partner]**, because the current trade-off **[forces over-disclosure when they want proof, or forces "trust my private logs" when they want privacy — and creates integration, security, and stale-permission risk either way]**.

Every bracket is fillable, so the privacy angle is load-bearing rather than bolted on. Mapped to primitives:

| User pain | Privacy primitive it invokes |
| --- | --- |
| Prove control/mandate without revealing the policy that grants it | Selective disclosure / zero-knowledge proof of a credential claim |
| Prove "still active / not revoked" without exposing the full status system | Status/revocation proof against on-chain commitment state |
| Keep names, DID documents, MCP keys, and policy off-chain while still being verifiable | Data minimisation — anchor commitments/proof material, not payloads |

This aligns with the Week 1 "Selective Disclosure for Agent Profiles" opportunity-fit statement and with Midnight as the privacy-preserving trust substrate. (Privacy primitives are referenced at the product-framing level here; any concrete Compact/Midnight implementation claim must be verified separately before it appears in technical specs.)

---

## SCQA Framing (for later investor/partner pitch)

Resource pack §01 (McKinsey SCQA), kept short for when the problem is pitched upward:

- **Situation:** AI agents are moving from internal demos into workflows where external parties — partners, customers, maintainers, other systems — have to decide whether to trust them.
- **Complication:** The trust artifacts we have (API keys, OAuth, wallet addresses, logs) prove possession of a secret, not current revocable authority, and proving authority properly today means leaking internal policy and operator data.
- **Question:** How can an agent prove its current, scoped, revocable authority to a third party while keeping the underlying policy and operator data private?
- **Answer (hypothesis, developed in the solution overview):** a portable, human-approved, revocable Agent Pass whose claims are selectively disclosable and whose status is externally verifiable, anchored on a privacy-preserving substrate.

---

## Evidence Anchors

| ID | Source | What it supports |
| --- | --- | --- |
| W1 | `customer-profile-agentic-dids.md` — First Survey Findings | The 4-response signal: fragmented workarounds, over-disclosure concern, mandate>identity, revocation as real not theoretical, time-not-yet-budget. |
| W2 | `customer-profile-agentic-dids.md` — Ranked Pain Inventory | Pain #1 ("can't prove which agent / who controls / what mandate / still authorized", F4×S5=20) is the spine of this statement. |
| W3 | `customer-interview-guide-agentic-dids.md` | Screener + past-behaviour questions that will convert worth-solving test #1 from partial to yes. |
| W4 | Survey quotes (W1) | Customer-language bank seeded below for reuse in copy, deck, and the canvas. |
| R2 | `problem_solution_resource_pack.pdf` | Method: section-01 structure, 5 Whys, worth-solving rubric, privacy-framing check, SCQA. |

### Customer language bank (verbatim, reuse downstream)

- "A simple way to prove what a system is allowed to do without exposing private inputs, plus clear auditability and revocation."
- "Identity declares clientName on the MCP handshake; permissions are env-var presence."
- "Collaborators wanted to verify which services and APIs the automation system could access and who was responsible for managing it."
- "Maintainers wanted to verify what actions the agent could perform and whether it had authority to approve or merge changes."
- "Standardized attestations, permission proofs, audit records, and revocation mechanisms would improve trust."

---

## Week 2 Definition of Done (progress)

- [x] **One-page problem statement** following the section-01 structure, with interview-tagged / cited evidence — *this document.*
- [x] **Accompanying root-cause, worth-solving, and privacy-framing tools** — worked here, reusable blanks in `problem-statement-worksheets-agentic-dids.md`.
- [ ] **Solution overview** — core concept, privacy-preserving mechanism (selective disclosure / proof of current authority), and high-level user journey. *Next.*
- [ ] **Completed Problem–Solution Canvas** — problem side (pain, frequency, users affected, privacy risk) and solution side (concept, value, differentiator, measurable outcome). *Next.*

### Open items to close with interviews

1. Convert worth-solving test #1 to "yes" with three named, dated incidents from external/production-adjacent agent builders.
2. Find one willingness-to-pay signal: who has paid (or has budget) for identity/compliance/audit/credentialing tooling adjacent to this.
3. Confirm the root-cause framing survives a sceptical builder who has not been in this conversation — if they reframe the pain as "a config problem," the privacy angle is not yet load-bearing for them.
