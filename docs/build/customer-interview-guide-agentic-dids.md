# Interview Guide: Agentic-DIDs Customer Discovery

This guide supports the customer profile in `docs/customer-profile-agentic-dids.md`. Use it for five to ten interviews before locking the initial ICP.

## Recruiting Targets

Interview mix for the first cycle:

| Segment | Count | Screen for |
| --- | ---: | --- |
| Agent platform builders | 3-4 | Building or operating agents that call tools/APIs, use MCP, or interact with customers/partners, especially where agents need scoped mandates, capabilities, limits, or authorization levels. |
| Midnight ecosystem builders | 3-4 | Building privacy-preserving dApps, wallet flows, DIDs, credentials, proof workflows, mandate proofs, or Midnight integrations. |
| Regulated enterprise AI/governance | 1-2 optional | Responsible for AI pilots, privacy reviews, security reviews, audit, IAM, or agent governance. Use as a secondary contrast segment. |
| AI consultants/agencies | 0-1 optional | Shipping client-facing automations or agents where trust/accountability has come up. Use only if they can describe repeated client trust friction. |

## Screener

Use these before scheduling:

1. Have you built, deployed, governed, or bought an AI agent or automation in the last six months?
2. Does that agent interact with external systems, customers, vendors, or partner APIs?
3. Have you had to prove who owns, controls, approved, or revoked that agent?
4. Have you dealt with privacy, security, compliance, or client trust concerns around what the agent can access or disclose?
5. Have you needed to prove an agent's current mandate, limits, capabilities, or authorization level to another system or person?
6. For ecosystem builders: have you needed a reusable identity, credential, proof, mandate, or verifier pattern for agents, wallets, or services?
7. Are you willing to discuss one specific recent incident or workflow, not just general opinions?

Prioritize people who answer yes to at least three questions, especially the final question.

## Interview Rules

- Talk about their past workflow, not the product idea.
- Ask for the last specific instance.
- Avoid words like DID, Midnight, ZK, or selective disclosure until after the discovery section.
- Log exact quotes when pain language is strong.
- Score frequency and severity only after the interview.

## Question Bank

### Context

1. Walk me through the last agent or automation workflow you shipped, bought, reviewed, or operated.
2. Where does identity, mandate, authorization, or approval show up in that workflow?
3. Who needs to trust that the agent is legitimate?
4. Who needs to trust what the agent is allowed to do?

### Past Behavior

1. Tell me about the last time someone asked, "Which agent is this?", "Who controls this?", or "Is this agent allowed to do that?"
2. What did you actually show them?
3. How long did it take to answer?
4. What system of record did you rely on?

### Workarounds

1. How do you identify agents today: API keys, service accounts, wallet addresses, OAuth apps, internal IDs, logs, docs, or something else?
2. How do you represent what an agent is allowed to do: scopes, roles, policy files, prompts, contracts, tickets, docs, or something else?
3. What happens when an agent's mandate expires, changes, is exceeded, or is revoked?
4. What happens when an agent is retired, compromised, or offboarded from a client?
5. Have you ever had stale credentials, unclear ownership, expired mandates, or manual revocation cause a problem?
6. What do you currently spend time or money on to reduce this risk?

### Privacy and Disclosure

1. Tell me about the last time a customer, partner, or verifier asked for more information than you wanted to disclose.
2. What did you share, redact, or refuse?
3. Which attributes should be public, which should be private, and which should be selectively provable?
4. What would make disclosure feel safer?

### Governance and Compliance

1. Who approves an agent before it acts in production?
2. Is that approval logged anywhere useful?
3. Who defines its mandate, limits, capabilities, and authorization level?
4. What audit question about agents would be hard for you to answer today?
5. What would happen if an external party relied on a retired, expired, over-scoped, or unauthorized agent?

### Trust Ladder

1. On a scale of 1-10, how much do you trust your current agent identity/mandate/authorization setup?
2. What would move that up by one point?
3. What would make it fall by one point?

### Spend and Urgency

1. Have you paid for identity, compliance, privacy, audit, or credentialing tools related to this problem?
2. What budget did that come from?
3. What would need to happen for this to become urgent this quarter?
4. Who would block a purchase?

### Concept Test

Only after discovery, give a short neutral description:

> Suppose an agent could have a human-approved, revocable pass that third parties can validate. The pass would prove the agent's identity, who controls it, its current mandate, limits, capabilities, authorization level, and selected claims like ownership or organization, without putting the full profile or internal policy on-chain.

Then ask:

1. Where would this fit, if anywhere, in the workflow you described?
2. What would still be missing before you could use it?
3. What part sounds valuable, confusing, or unnecessary?
4. Would you rather consume this as an API, MCP server, hosted product, open-source component, or managed service?
5. If the core is open source, what would you pay someone else to host, operate, monitor, or support?
6. Does the name "Agent Pass" or "Multipass" make this clearer, or does another term fit better?

## Scoring Template

Use one row per pain per interview.

| Interview ID | Segment | Pain in customer's words | Frequency 1-5 | Severity 1-5 | Score | Current workaround | Time/money cost | Quote/evidence | Follow-up |
| --- | --- | --- | ---: | ---: | ---: | --- | --- | --- | --- |
| I-001 |  |  |  |  |  |  |  |  |  |

Frequency scale:

| Score | Meaning |
| ---: | --- |
| 1 | Yearly or rarer |
| 2 | Quarterly |
| 3 | Monthly |
| 4 | Weekly |
| 5 | Daily or every workflow |

Severity scale:

| Score | Meaning |
| ---: | --- |
| 1 | Mild annoyance |
| 2 | Noticeable friction |
| 3 | Delays work or requires manual workaround |
| 4 | Blocks deployment, deal, review, or integration |
| 5 | Creates churn, security incident, regulatory exposure, or serious reputational risk |

Priority interpretation:

| Score | Meaning |
| ---: | --- |
| 16-25 | Top priority; potential ICP-defining pain |
| 9-15 | Secondary; validate after top pain |
| 1-8 | Feature-level pain; do not position around it |

## Evidence Log Template

| Evidence ID | Interview ID / source | Segment | Matrix cell | Raw evidence | Confidence | Implication |
| --- | --- | --- | --- | --- | --- | --- |
| Q-001 | I-001 |  | Pain |  | Low/Med/High |  |

## Post-Interview Synthesis

After each interview:

1. Add at least one quote to the evidence log.
2. Update one matrix cell in `docs/customer-profile-agentic-dids.md`.
3. Add or revise one pain score.
4. Mark whether the customer has paid, spent time, blocked a launch, or changed behavior because of the pain.

After five interviews:

1. Pick the highest-scoring pain by segment.
2. Drop any segment where no past behavior supports the pain.
3. Rewrite the ICP in one paragraph.
4. Rewrite the product positioning in the customer's own words.
