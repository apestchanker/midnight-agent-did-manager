# Customer Profile: Agentic-DIDs

This is a Week 1 customer-analysis draft for Agentic-DIDs using the Customer Analysis Matrix method from `customer_analysis_matrix_resource_pack.pdf`.

Status: desk-research hypothesis with first survey signals from 4 builder responses. Findings are directional only and should be validated with follow-up interviews.

## Product Frame

Agentic-DIDs gives AI agents a verifiable, privacy-preserving identity and mandate layer for proving control, authorization status, valid permissions, limits, capabilities, and limited profile claims. It uses Midnight privacy-first blockchain as the privacy-preserving trust substrate for DID lifecycle state, commitments, and proof-oriented workflows. The current product flow lets a human in-the-loop customer link a wallet, create MCP/API keys, approve agent DID requests, issue or revoke DIDs, and expose selective disclosure credentials for ownership, name, and organization (as an MVP, more selective disclosure info to be added).

Core promise:

> Give every agent a verifiable pass: a secure identity plus proof of the mandates who controls it, what it is allowed to do, what limits apply, and whether that authority is still active, putting only selective necessary profile data on-chain.

Strategic focus:

- Primary customer segments for the first discovery cycle: agent platform builders and Midnight ecosystem builders.
- Product category: agent identity, privacy, and security infrastructure powered by a privacy-preserving trust substrate.
- Packaging direction: open-source-first, with a potential hosted platform to become the trusted certification entity or a managed service for organizations that do not want to operate the full stack themselves.
- Product concept to evaluate: an Agent Multipass, that combines immutable agent identity with user-granted mandates, capabilities, limits, authorization levels, and revocation/status proofs.

## Agent Multipass Concept

The Agent MultiPass is a privacy-preserving credential set that lets an agent prove not only "this is who I am" but also "this is what my human or organization has authorized me to do right now."

Possible product name: Agent Multipass.

What the pass can contain or prove:

| Layer               | Meaning                                                                                          | Example proof                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Identity            | The agent has a stable, verifiable identifier.                                                   | This agent is `did:...` and the DID is active.                           |
| Control             | A human, organization, wallet, or issuer controls or approved the agent dids and credentials.    | This agent is controlled by the disclosed or undisclosed holder.         |
| Mandate             | The agent has been delegated a specific job or purpose.                                          | This agent may negotiate support tickets for customer X.                 |
| Limits              | The mandate has boundaries.                                                                      | This agent cannot spend funds, export data, or act after a given expiry. |
| Capabilities        | The agent can prove which actions or tools are in scope.                                         | This agent may call a billing API but only in read-only mode.            |
| Authorization level | The agent can prove its permission tier without exposing every internal policy.                  | This agent has approval level 2 for workflow Y.                          |
| Status              | Verifiers can check whether the pass, DID, or mandate is active, expired, suspended, or revoked. | This mandate was revoked on a specific date or no longer validates.      |

Customer need:

> Agent owners do not only need identity for their agents; they need portable, verifiable, privacy-preserving proof of current authority. The MultiPass is the product metaphor that makes identity, mandates, limits, capabilities, authorization levels, and revocation understandable to customers and verifiers.

Open questions:

- "Multipass" may be memorable, but interviews should test whether potential users understand the concept of an "Agent Pass" first.
- The mandate/capability model may be more valuable than the immutable identity itself.
- Customers may expect policy enforcement, not only proof. Discovery should test whether managed issuance, validation, expiry, revocation, and policy templates are part of the service value.
- Position the platform as the trusted certificate authority could take long and may not be aligned with the needs of the market, but it is a required piece of the puzzle.

## First Survey Findings

Source: first 4 responses from the neutral "Agent and Automation Trust Workflows" survey.

Sample caveat:

- This is a very small sample and should not be treated as market proof.
- Three of four respondents have built, reviewed, or operated agent/automation prototypes in the last six months.
- Two of four had agents interacting with external systems, customers, vendors, partner APIs, wallets, or shared infrastructure.
- Three of four have already allocated engineering or security time to identity, authorization, compliance, audit, or trust problems.
- All four are open or maybe open to follow-up.

### What the responses validate

| Finding | Evidence from responses | Implication |
| --- | --- | --- |
| Agent identity alone is not enough. | Respondents repeatedly selected or described current purpose/mandate, allowed tools/actions, limits, authorization level, status, and audit history as information that should be easy to verify. | Keep Agent MultiPass positioned as identity plus current authority, not just agent DID identity. |
| Current workarounds are fragmented. | Builders use API keys, OAuth/service accounts, wallet addresses, internal IDs, logs, config files, policy files, documentation, tickets, prompts, hard-coded rules, and manual review. | The product opportunity is to replace scattered operational evidence with a portable verification artifact. |
| Pain sharpens when agents touch external systems or production-like workflows. | The strongest response came from an AI automation builder integrating external APIs and shared infrastructure; another respondent described a fintech code-review agent with production/security risk. | Recruit more builders with external, partner-facing, security-sensitive, or production-adjacent agents. |
| Over-disclosure is a real concern. | Respondents described sharing logs, deployment records, permission details, purpose, scope, and audit info while withholding prompts, credentials, infrastructure details, wallet/security data, private inputs, and proprietary workflow logic. | Selective proof of authority and capability is central to the value proposition. |
| Revocation/status is more than theoretical. | One respondent reported a production/security issue; one reported internal friction; two described it as a concern or future need. | Status, expiry, revocation, and stale permission handling should be treated as core MultiPass functionality. |
| There is early willingness to invest time, but not yet direct budget proof. | Three of four respondents have allocated engineering/security time; none directly indicated paid budget for a hosted service. | Validate hosted platform/certification willingness-to-pay in follow-up calls. |

### Early scoring update

Average scores across the four responses:

| Metric | Result | Interpretation |
| --- | ---: | --- |
| Average severity | 3.0 / 5 | Moderate; strongest acute case is the automation builder with external API integrations and delayed integration cost. |
| Average frequency | 2.25 / 5 | Not daily yet in this sample; most workflows are prototype/pilot stage. |
| Average trust score | 6.5 / 10 | Trust is uneven: high where workflows are simple/internal, low where there is no clear method. |

Interpretation:

> The first signal supports the Agent MultiPass thesis qualitatively, especially around mandate, capability, limit, status, auditability, and selective verification. The current sample does not yet prove a high-frequency pain across the market. Urgency appears to rise when agents move from prototypes to external integrations, sensitive systems, enterprise/partner contexts, or production workflows.

### Quotes to reuse in synthesis

- "A simple way to prove what a system is allowed to do without exposing private inputs, plus clear auditability and revocation."
- "Identity declares clientName on the MCP handshake; permissions are env-var presence."
- "Collaborators wanted to verify which services and APIs the automation system could access and who was responsible for managing it."
- "Maintainers wanted to verify what actions the agent could perform and whether it had authority to approve or merge changes."
- "Standardized attestations, permission proofs, audit records, and revocation mechanisms would improve trust."

### Profile updates from first responses

- Priority segment remains agent platform / automation builders, especially those with external API, partner system, wallet, shared infrastructure, fintech/security, or production-adjacent workflows.
- Midnight/privacy ecosystem builders remain valid, but the sharper interview filter is not "ecosystem builder" alone. It is whether they have agent authority, capability, verification, or selective disclosure problems.
- The strongest near-term wedge is "portable proof of current authority" rather than "identity for agents" alone.
- The hosted platform hypothesis should be tested as operational outsourcing: issuance, status validation, revocation, monitoring, policy templates, and certification, not only API hosting.
- Follow-up interviews should focus on R3 and R4 first because they described concrete external/security workflows and real friction.

## Evidence Anchors

| ID  | Evidence source                        | What it supports                                                                                                                           |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| E1  | `README.md`                            | Current implementation: Midnight DID registry, DID lifecycle, MCP keys, human approval, VC issuance, selective disclosure, proof material. |
| E2  | `docs/identity-architecture.md`        | Roles: human customer, agent, issuer admin, registry verifier; account, quota, MCP, and approval workflow.                                 |
| E3  | `docs/did-vc-specification.md`         | DID/VC model, credential types, verifier behavior, proof request workflow, agent identity binding.                                         |
| E4  | `docs/midnight-proof-roadmap.md`       | Direction from JWT VC bundles toward holder-generated Midnight proofs.                                                                     |
| E5  | `docs/eudi-best-practices.md`          | Privacy-by-design posture: purpose binding, verifier details, explicit disclosure review, status and audit behavior.                       |
| R1  | Customer Analysis Matrix Resource Pack | Method: demographics, psychographics, behavior, geo/regulation, problem intensity, opportunity fit, interviews.                            |

## Candidate Segments

| Segment                        | Customer profile                                                                                                                                                                                 | Buyer / user                                                                                                                           | Why this segment now                                                                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Agent platform builders     | Teams building agent frameworks, hosted agents, or MCP-enabled products need a trust layer for agent identity, mandate proof, delegation, revocation, and verifier-facing authorization signals. | Buyer: founder/CTO/platform lead. User: developer integrating MCP/API, security reviewer, agent operator.                              | Agents are moving from demos into workflows where third parties need to know which agent is acting, who controls it, what it is authorized to do, and whether authority is current. |
| B. Midnight ecosystem builders | Builders in the Midnight and privacy-preserving Web3 ecosystem need an agent pass primitive for identity, credentials, mandates, limits, capabilities, and proof workflows.                      | Buyer: protocol founder, dApp developer, ecosystem grant reviewer. User: smart contract engineer, wallet integrator, verifier service. | The product can become a reference app, integration example, or identity component for agent identity, privacy, and security workflows.                                             |

--- FUTURE Candidates to evaluate ---
| C. Regulated enterprises deploying internal agents | Enterprises using agents in finance, health, legal, insurance, public sector, or critical operations need auditable human approval and minimal disclosure for agent actions. | Buyer: CISO, privacy lead, AI governance lead, compliance/product owner. User: platform engineer, governance analyst, workflow owner. | Agent adoption creates identity and governance gaps that existing IAM does not cleanly solve for external verification or selective proof. This is a secondary validation path after the developer and ecosystem segments. |
| D. Privacy-forward AI consultants and agencies | Teams shipping bespoke AI automation for clients need a lightweight way to prove agent ownership and reduce client trust friction. | Buyer/user: technical consultant, automation agency founder, solutions architect. | They feel customer trust objections directly but may lack the budget and patience for heavy enterprise identity infrastructure. |

## Customer Analysis Matrix

| Segment                        | Demographics                                                                                                                                                                                                                    | Psychographics                                                                                                                                                                                                                   | Behavior                                                                                                                                                                                                                                                             | Geo and regulation                                                                                                                                                         | Pain score hypotheses                                                                                                                                                                                                                                | Opportunity fit                                                                                                                                                                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Agent platform builders     | Technical founders, platform engineers, infra teams, AI product leads. Digital literacy 5/5. Likely early in US/EU/LatAm developer ecosystems. Needs validation with LinkedIn/Apollo sizing and developer community interviews. | Values developer speed, API simplicity, interoperability, and credible technical primitives. Skeptical of compliance theater. Will care if identity and mandate proof unlock integrations or reduce support/security objections. | Uses API keys, OAuth/service accounts, MCP servers, wallets, logs, and internal approval flows. Likely has ad hoc agent naming, environment-specific keys, hard-coded scopes, and weak public verification of mandates or authorization levels.                      | Mostly global SaaS. Must support GDPR/CCPA-style data minimization narratives when customers are in EU/US; crypto-specific rules depend on deployment and custody choices. | P1 unverifiable external agent identity and mandate: F4 x S5 = 20. P2 revocation/status uncertainty after key leakage, expired mandates, or agent retirement: F3 x S5 = 15. P3 selective disclosure of capabilities/limits is complex: F3 x S4 = 12. | Strong fit if Agentic-DIDs becomes the developer-friendly Agent Pass layer: simple MCP/API onboarding, public DID validation, mandate and capability credentials, authorization-level proofs, revocation, and selective disclosure without exposing full policy data. |
| B. Midnight ecosystem builders | Protocol teams, dApp builders, wallet/proof-server integrators, privacy engineers. Digital literacy 5/5. Likely global, concentrated in Midnight and privacy-preserving Web3 developer networks.                                | Values sovereignty, privacy, composability, open specs, and credible ZK/proof architecture. More tolerant of early-stage tooling if it advances a missing primitive.                                                             | Builds with wallets, contracts, credential systems, DIDs, ZK/proof tooling, and developer docs. Will fork examples, inspect contracts, and expect strong technical caveats. May need reusable patterns for agent mandates, scoped capabilities, and verifier policy. | Global. Regulatory lens varies by product; identity and mandate credentials may trigger privacy, KYC, consumer, or financial rules depending on claims and use cases.      | P1 lack of a reusable privacy-preserving Agent Pass primitive: F3 x S5 = 15. P2 no reusable reference for mandate/capability disclosure credentials: F3 x S4 = 12. P3 unclear verifier trust model for authorization levels: F3 x S4 = 12.           | Strong ecosystem fit as an open-source reference implementation for agent ownership, mandate credentials, capability proofs, and proof-bound selective disclosure, using Midnight as the privacy-preserving trust substrate.                                          |

## Ranked Pain Inventory

| Rank | Pain                                                                                                              | Primary segment | Frequency | Severity | Score | Current workaround hypothesis                                                                   | Validation target                                                                                                                   |
| ---- | ----------------------------------------------------------------------------------------------------------------- | --------------- | --------: | -------: | ----: | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1    | "I cannot prove which agent is acting, who controls it, what mandate it has, and whether it is still authorized." | A               |         4 |        5 |    20 | API keys, service accounts, logs, contractual trust, manual screenshots, static scopes.         | Find 5 agent platform teams with external or cross-system agent interactions and ask about last authorization or delegation review. |
| 2    | "There is no reusable privacy-preserving Agent Pass primitive I can build on."                                    | B               |         3 |        5 |    15 | Custom identifiers, generic DIDs, wallet addresses, app-specific registries, hard-coded scopes. | Interview Midnight ecosystem builders about whether identity plus mandates/capabilities is a missing primitive or a nice-to-have.   |
| 3    | "Clients or verifiers want trust, but full disclosure leaks too much business or operator data."                  | A, B, D         |         3 |        5 |    15 | Redacted docs, NDAs, hidden service accounts, broad OAuth scopes, no proof.                     | Ask for last time they shared less than requested or avoided a disclosure.                                                          |
| 4    | "Autonomous agent actions create an audit and accountability gap."                                                | C               |         4 |        5 |    20 | IAM logs, SIEM events, manual approval tickets, AI governance spreadsheets.                     | Interview enterprise governance and security leads after the first developer and ecosystem interviews.                              |
| 5    | "Revocation and status checks are inconsistent after key rotation, agent retirement, or client offboarding."      | A, D            |         3 |        5 |    15 | Delete API keys, update docs, trust internal state, notify partners manually.                   | Ask about the last key rotation/offboarding incident and what failed.                                                               |

First-survey note:

- The first four responses show lower average frequency than the initial hypotheses because most respondents are in prototype/pilot stage.
- The qualitative signal for P1, P3, and P5 is still strong, especially among respondents with external integrations or security-sensitive workflows.
- Keep the original scores as target-segment hypotheses, but validate them specifically with builders operating production, partner-facing, or sensitive agents.

## Top Opportunity Fit Statements

### 1. Verifiable Agent Control

Agentic-DIDs restores the belief that an agent can prove who controls it, what mandate it has, what limits apply, and whether that authority is current. It reduces the risk of impersonation, stale keys, expired mandates, and unauditable delegation by anchoring DID lifecycle state on Midnight and exposing resolver/validation endpoints. New value: agent platforms can make external agent interactions verifiable instead of asking customers and partners to trust internal logs or static scopes.

### 2. Human-Approved Agent Governance

Agentic-DIDs restores the belief that autonomous agents still operate under explicit human or organizational control. It reduces regulatory, reputational, and operational loss by requiring human approval for agent DID requests and supporting active/revoked status checks for agent passes, mandates, limits, and authorization levels. New value: regulated teams can map agent identity and delegation workflows into governance and audit processes without making every verifier a privileged internal system.

### 3. Selective Disclosure for Agent Profiles

Agentic-DIDs restores the belief that verification does not require over-sharing. It reduces privacy and competitive leakage by keeping names, full DID documents, MCP keys, workflow data, detailed policy data, and credential payloads off-chain while enabling atomic credentials and proof material for selected identity, mandate, capability, and limit claims. New value: verifiers can get the minimum proof they need, while operators retain control over what agent/profile and authority attributes are disclosed.

### 4. Open Agent Identity Primitive

Agentic-DIDs restores the belief that builders can add a verifiable agent pass without inventing a one-off trust model. It reduces integration risk for ecosystem builders by providing a concrete open-source reference for agent DIDs, mandate and capability credentials, MCP/API flows, and proof-roadmap artifacts. Midnight provides the privacy-preserving anchor and proof direction for this reference pattern. New value: builders get a reference pattern they can fork, test, extend, or cite in ecosystem proposals.

## Initial ICP Recommendation

Primary ICPs for the next validation cycle:

> Technical founders and platform leads building MCP-enabled or API-driven agent products that need external parties to verify agent ownership, mandate, limits, capabilities, authorization level, active status, and limited profile claims.

> Midnight ecosystem builders who need an open, privacy-preserving Agent Pass primitive they can fork, integrate, or use as a reference for DID/credential/proof flows.

Why this first:

- The buyer and user are close together in both segments, which shortens interviews and iteration.
- The current repo already exposes developer-facing MCP/API, DID request, resolution, credential, and proof surfaces.
- Both segments have high digital literacy and can evaluate an early technical artifact.
- It avoids enterprise procurement drag while still testing the strongest trust and verification pains.

Secondary ICP:

> AI governance, privacy, and security leads in regulated organizations piloting internal or partner-facing agents.

Why second:

- Higher willingness to pay may exist, but proof requires stronger compliance positioning, legal review, deployment hardening, and credible audit integrations.

## Packaging and Business Model Hypothesis

Current packaging direction:

> Open-source-first reference implementation, with a potential hosted platform or managed service for teams that want Agent Pass issuance, mandate templates, status validation, credential APIs, monitoring, revocation, and proof workflow infrastructure without operating the stack themselves.

Business model hypotheses to validate:

| Model                       | Buyer                   | Why it might work                                                                                                                  | Main risk                                                                      |
| --------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Hosted developer platform   | Agent platform builders | Removes operational friction and gives teams a ready validation/credential API for agent passes, mandates, limits, and revocation. | Builders may self-host until production trust or scale forces a hosted option. |
| Managed ecosystem service   | Midnight/Web3 builders  | Helps ecosystem teams ship faster while keeping the protocol/reference open.                                                       | Demand may depend on ecosystem funding and adoption timing.                    |
| Enterprise deployment later | Regulated organizations | Higher willingness to pay for auditability, support, and private deployment.                                                       | Requires hardening, compliance support, and longer sales cycles.               |

## Positioning Hypotheses

| Segment                     | Short positioning hypothesis                                                                                                                                                  |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent platform builders     | "A verifiable Agent Pass for AI agents: prove identity, user mandate, capabilities, limits, authorization level, active status, and selected claims through MCP/API."         |
| Regulated enterprises       | "Governance-grade agent passes: prove ownership, approval, mandates, limits, and revocation without over-disclosing sensitive agent or operator data."                        |
| Midnight ecosystem builders | "An open-source Agent Pass reference for privacy-preserving DIDs, mandates, credentials, capabilities, and selective disclosure, powered by Midnight as the trust substrate." |
| AI consultants/agencies     | "A lightweight trust layer for client-facing agents: prove who owns the agent, what it is allowed to do, what it can disclose, and when it has been revoked."                 |

## Open Validation Questions

These choices should be resolved through product strategy input and customer interviews before positioning is finalized:

1. Initial geography: US, EU, LatAm, or global developer/Midnight ecosystem regardless of geography.
2. Hosted platform shape: API-first SaaS, managed MCP server, hosted verifier/status page, issuer service, mandate/capability template library, or all of the above.
3. Trust claim boundary: how strongly should we claim "proof" today given the current distinction between JWT VC bundles, commitment material, and native ownership proof validation.
4. Monetization signal: which buyers show willingness to pay for hosting, support, compliance posture, or managed issuance.
5. Naming signal: whether "Agent Pass", "Multipass", or another term best explains identity plus mandates without creating confusion.

## Week 1 Definition of Done

- Complete at least 6 interviews across agent platform builders and Midnight ecosystem builders, with at least 3 from each segment.
- Tag every interview quote against one matrix row and one pain.
- Re-score pains by segment after interviews.
- Kill or promote the primary ICP based on observed past behavior, not stated interest.
- Produce one final one-paragraph ICP statement and one sharper top-pain statement.

## Apendix - Future

-- Future Candidate Customers --

| Segment                                            | Customer profile                                                                                                                                                                                                                             | Buyer / user                                                                                                                                                                                            | Why this segment now                                                                                                                                                            |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C. Regulated enterprises deploying internal agents | Mid-market to enterprise organizations with privacy/security teams. Digital literacy buyer 3-4/5; technical users 5/5. Initial vertical hypotheses: financial services, health-adjacent operations, legal, insurance, public sector vendors. | High risk sensitivity. Trust comes from auditability, explicit approval, vendor accountability, legal defensibility, and control. Likely cautious about public chains unless privacy boundary is clear. | Uses IAM, SIEM, GRC tools, approval workflows, DPIAs, security reviews, procurement questionnaires. Agents are often piloted behind internal controls before external exposure. | US/EU first if selling to privacy-aware orgs. GDPR, CCPA/CPRA, HIPAA-adjacent, sector security requirements, DPA/vendor review. Data residency and cross-border transfer questions need legal review. | P1 audit gap for autonomous agent actions: F4 x S5 = 20. P2 over-disclosure to verifiers/vendors: F3 x S5 = 15. P3 procurement blocker due to unclear agent identity/control: F3 x S4 = 12.   | Fit depends on packaging the product as governance infrastructure: human-approved agent identity, active/revoked status, issuer provenance, purpose-bound disclosure, and logs that map to audit questions.   |
| D. Privacy-forward AI consultants and agencies     | Small technical teams, solo consultants, AI automation agencies. Digital literacy 4-5/5. Likely US/EU/LatAm, remote-first.                                                                                                                   | Wants client trust, differentiation, fast deployment, and a credible story around privacy without building deep infrastructure. Price-sensitive and impatient with complex setup.                       | Builds custom agents, uses API keys, Zapier/n8n/custom MCP, client SaaS systems, password managers, shared docs. Identity and approval are often manual or contractual.         | Depends on client sector. GDPR/CCPA questions appear through client contracts. May need simple compliance language and deployment boundaries more than formal certifications.                         | P1 client does not know what agent is acting or who owns it: F4 x S4 = 16. P2 manual proof/trust work in onboarding: F3 x S4 = 12. P3 fear of exposing client/company metadata: F3 x S4 = 12. | Fit if offered as a lightweight trust badge/API for client-facing agents: prove ownership, show active status, selectively disclose organization/name only when useful, and revoke cleanly after engagements. |
