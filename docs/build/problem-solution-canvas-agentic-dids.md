# Problem–Solution Canvas: Agentic-DIDs

Week 2 deliverable #3, the one-page both-sides summary, using the Problem–Solution Canvas skeleton from `problem_solution_resource_pack.pdf` §06/§09. It compresses `problem-statement-agentic-dids.md` (problem side) and `solution-overview-agentic-dids.md` (solution side) onto a single sheet.

Status: evidenced hypothesis. Problem side is grounded in 4 survey responses; solution side is a hypothesis with target thresholds, not results.

---

## The Canvas

| PROBLEM SIDE | SOLUTION SIDE |
| --- | --- |
| **Pain** — Agent builders can't *prove*, to a third party, which agent is acting, who controls it, what it's authorized to do right now, its limits/capabilities/authorization level, and whether that authority is still active — without either over-disclosing internal policy and operator data, or asking the verifier to trust private logs. | **Product concept** — The Agent Pass: a portable, human-approved, revocable credential that proves an agent's identity, control, mandate, capabilities, limits, authorization level, and active status to any verifier, while keeping the underlying policy and operator data private. |
| **Frequency** — Today: moderate (avg frequency 2.25/5 across 4 prototype-stage builders). Rising to weekly/per-workflow at the integration boundary — when agents touch external systems, partner APIs, wallets, or production. Event-driven: integration, security review, key rotation, retirement, offboarding. | **Value delivered** — A verifier can answer "which agent, who controls it, what's it allowed to do, is it active?" in seconds, self-service, without privileged access to the operator's internal systems — replacing trust-me logs and support threads, and unblocking external integrations. |
| **Users affected** — Primary: technical founders / platform engineers / security reviewers shipping MCP-enabled or API-driven agents with external, partner-facing, or production-adjacent workflows (Segment A). Secondary: Midnight ecosystem builders needing a reusable Agent Pass primitive (Segment B). Current alternatives: API keys, OAuth/service accounts, wallet addresses, internal IDs, logs, docs, hard-coded scopes, manual review. | **Differentiator** — Proof of *current, revocable authority* with selective disclosure, not just possession of a secret (API key) or a "who" (bare DID). The privacy primitive — selectively disclosable credentials + status/revocation proof anchored on Midnight, payloads off-chain — is the hard-to-copy core, plus a human-approval control point external parties can verify. |
| **Privacy risk** — A verification-vs-disclosure trade-off: proving authority today forces leaking internal policy, credentials, full DID documents, and operator/organization metadata; protecting that data forces "trust my private logs." Either path creates integration friction, security exposure, and stale-permission risk after rotation/retirement/offboarding. | **Measurable outcome** — Of the next 8 builders shown the Pass, ≥4 say it would replace a specific current workaround for a specific verifier interaction, and ≥2 attempt or commit to integrating the open-source reference. Per-interaction target: agent identity + current authority answerable in <1 min, self-service, zero policy disclosure. |

---

## Fit Check Before Submission (resource pack §06)

Read each side in isolation:

1. **Does the problem side stand alone as real, evidenced user pain?** Yes — grounded in 4 builder responses, ranked Pain #1 (F4×S5=20 for the target slice), with verbatim quotes and named fragmented workarounds. *Caveat:* frequency is prototype-stage today; the acute, named-incident case still needs interview confirmation (open item in the problem statement).
2. **Does the solution side stand alone as a coherent concept with a measurable outcome?** Yes — the Agent Pass is one concept, one mechanism (selective disclosure + status proof, data-minimised), with an observable threshold. *Caveat:* feasibility of "proof" vs "bundle" is mid-transition on the proof roadmap; don't over-claim before verification.
3. **Does the line between them survive a sceptical reader who wasn't in the conversation?** Mostly — the root-cause chain (5 Whys) connects "can't prove authority" to "no primitive proves current authority without exposing policy," which the solution directly answers. *Risk to watch:* a sceptic who reframes the pain as "just a config/scopes problem" would weaken the privacy claim; closing that is the third open interview item.

---

## Traceability

| Canvas cell | Source |
| --- | --- |
| Problem side (all cells) | `problem-statement-agentic-dids.md` (Who/Situation/Pain/Evidence/Gap/Privacy framing; 5 Whys; worth-solving test) |
| Solution side (all cells) | `solution-overview-agentic-dids.md` (concept, mechanism, journey, hypothesis) |
| Frequency / severity numbers | `customer-profile-agentic-dids.md` — First Survey Findings & Ranked Pain Inventory |
| Privacy mechanism | `solution-overview-agentic-dids.md` §3; proof roadmap (evidence anchor E4) — *implementation claims pending verification* |

---

## Week 2 Definition of Done — Complete

- [x] **One-page problem statement** — `problem-statement-agentic-dids.md`
- [x] **Accompanying tools & artifacts** — `problem-statement-worksheets-agentic-dids.md`
- [x] **Solution overview** (concept · privacy mechanism · user journey · hypothesis) — `solution-overview-agentic-dids.md`
- [x] **Completed Problem–Solution Canvas** — *this document*

### Carry into Week 3

1. Run the 5–10 interviews from `customer-interview-guide-agentic-dids.md` to convert the worth-solving test's named-incident gap from partial to yes.
2. Test the measurable-outcome thresholds above (≥4 of 8 replace a workaround; ≥2 integrate).
3. Verify every "proof" claim in the solution mechanism with `/verify` before it enters a technical spec or external deck.
4. Get one willingness-to-pay signal for the hosted layer.
