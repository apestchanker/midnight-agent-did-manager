# EUDI-Inspired Best Practices

## Purpose

This document captures technical and security practices inspired by the
European Digital Identity Wallet (EUDI Wallet) model that can improve this
project without claiming eIDAS or EUDI compliance.

The goal is pragmatic: use the EUDI architecture as a source of product,
privacy, and security ideas for the current Agentic-DIDs / Midnight Agent DID
Manager.

The current product definition is Agent MultiPass: a privacy-preserving pass
for AI agents that can prove identity, holder control, current mandates,
limits, capabilities, authorization levels, status, and selected profile
claims. The EUDI-inspired guidance in this document should apply to those
authority claims as well as to basic identity and profile credentials.

This is not a compliance checklist. Legal registration, certification,
qualified trust-service status, EU trusted-list participation, and formal
wallet certification are out of scope for this document.

## Design Principle

A credential should not be presented as an isolated token. It should be
presented as part of a transaction that includes:

- the verifier identity
- the declared purpose
- the requested attributes
- explicit holder approval
- a challenge and expiry
- proof of holder control
- credential and DID status checks
- an auditable verification result

For Agent MultiPass flows, the transaction context should also make clear which
mandate, limit, capability, or authorization-level claim is being requested and
why.

These ideas can improve the system even before any EUDI-specific protocol is
implemented.

## Best Practices Backlog

### 1. Make Holder Approval More Explicit

Current direction:

- The system already has human approval for DID requests and proof workflows.

Improvement:

- Show a clear approval summary before DID creation, VC disclosure, proof
  generation, and presentation.
- Include who is requesting the action, what will happen, what data will be
  disclosed, and whether the result is public, private, persistent, or
  revocable.

Implementation notes:

- Add a reusable approval-summary component.
- Include request type, verifier, purpose, disclosed attributes, expiry, and
  risk level.
- Store the approved summary hash with the approval event.

Expected benefit:

- Better UX, fewer accidental disclosures, clearer holder control.

### 2. Move From Scope-Level To Attribute-Level Disclosure

Current direction:

- The system uses disclosure scopes such as `ownership`, `name`, and
  `organization`.
- The Agent MultiPass direction extends those scopes to include `mandate`,
  `limit`, `capability`, and `authorization_level`.

Improvement:

- Allow the holder to approve individual attributes within a credential.

Implementation notes:

- Introduce a `requestedAttributes` model.
- Keep scope-level disclosure as a compatibility layer.
- Map attributes to credential rows and proof commitments.
- Prepare the model for future SD-JWT VC selective disclosure.

Expected benefit:

- Stronger privacy, better data minimization, and a cleaner path toward
  standards-based disclosure.

### 3. Add Verifier Identity

Current direction:

- Proof requests can include a verifier string, but verifier identity is not a
  first-class trusted entity.

Improvement:

- Model verifiers/relying parties as registered entities.

Implementation notes:

- Add a `verifiers` table or config registry with:
  - verifier id
  - display name
  - domain
  - public key
  - allowed scopes or attributes
  - allowed purposes
  - status
- Include verifier details in proof requests and holder approval screens.

Expected benefit:

- Holders can understand who is asking for data, and the system can block or
  warn on unknown or suspended verifiers.

### 4. Require Purpose Binding

Current direction:

- Proof material already includes a `purpose` field in some flows.

Improvement:

- Make purpose mandatory and structured across DID approval, VC disclosure,
  proof generation, and verification.

Implementation notes:

- Define an enum such as:
  - `did-authentication`
  - `agent-ownership-verification`
  - `organization-verification`
  - `admin-review`
  - `service-access`
- Include purpose in holder signatures, proof commitments, audit logs, and
  verification receipts.

Expected benefit:

- Better anti-replay semantics, clearer UX, and stronger auditability.

### 5. Enforce Expiring, Single-Use Proof Requests

Current direction:

- Proof requests already include creation and expiry timestamps.

Improvement:

- Enforce expiry and single use at verification time.

Implementation notes:

- Persist proof request sessions.
- Store challenge, verifier id, purpose, expiry, status, and `used_at`.
- Reject expired, reused, or mismatched requests.
- Show proof-request expiry in the UI.

Expected benefit:

- Reduced replay risk and more predictable verifier behavior.

### 6. Add Append-Only Audit Events

Current direction:

- State exists in request, DID, credential, and proof tables, but there is no
  unified audit stream.

Improvement:

- Record key identity lifecycle events in an append-only audit log.

Implementation notes:

- Add events such as:
  - `did.request.created`
  - `did.request.human_approved`
  - `did.issued`
  - `did.revoked`
  - `credential.issued`
  - `credential.revoked`
  - `presentation.requested`
  - `presentation.approved`
  - `presentation.verified`
  - `proof.failed`
  - `issuer.key.rotated`
- Store actor, subject DID, verifier, purpose, credential ids, event hash, and
  timestamp.
- Avoid storing unnecessary personal data in the audit event.

Expected benefit:

- Easier debugging, better operational accountability, and a stronger future
  evidence trail.

### 7. Expose Credential Status More Clearly

Current direction:

- Credential status is stored in the database and DID status is anchored through
  the registry.

Improvement:

- Add a verifier-facing credential status endpoint and embed status references
  in issued credentials.

Implementation notes:

- Add an endpoint such as `GET /api/vcs/status/:credentialId`.
- Return active, revoked, suspended, issued-at, revoked-at, issuer, and subject
  DID metadata.
- Add a status reference to newly issued VCs.
- Later, evolve this into a standard status list profile.

Expected benefit:

- Verifiers can check revocation without relying on internal database access or
  application-specific assumptions.

### 8. Separate Issuer Trust From Issuer Keys

Current direction:

- Issuer verification is based on the local issuer JWK.

Improvement:

- Model trust as a separate layer from cryptographic key material.

Implementation notes:

- Add an issuer descriptor with:
  - issuer id
  - public keys
  - trust status
  - supported credential types
  - key validity windows
  - key rotation metadata
- Introduce trust states such as `local-dev`, `trusted`, `suspended`,
  `revoked`, and `unknown`.

Expected benefit:

- Clearer security semantics, better future trust-list integration, and safer
  key rotation.

### 9. Formalize Key Rotation

Current direction:

- Credentials are signed with the current issuer key.

Improvement:

- Support multi-key JWKS-style issuer verification and historical validation.

Implementation notes:

- Add key ids (`kid`) with validity windows.
- Keep retired keys available for verification.
- Mark keys as `active`, `retired`, or `compromised`.
- Add an issuer JWKS endpoint with multiple public keys.
- Record key rotation events in the audit log.

Expected benefit:

- Safer issuer operations and less risk when keys need to be rotated or
  retired.

### 10. Improve Presentation Review UX

Current direction:

- The UI can create and verify proof packages, but the review experience is
  still technical.

Improvement:

- Show a human-readable presentation review before the holder approves a proof
  or disclosure.

Implementation notes:

- Show:
  - verifier name
  - purpose
  - requested attributes
  - attributes that will not be disclosed
  - expiry
  - proof mode
  - expected verification result

Expected benefit:

- Better user confidence and clearer privacy behavior.

### 11. Add Data Minimization Warnings

Current direction:

- The holder can choose disclosure scopes, but the system does not warn if more
  data is selected than requested.

Improvement:

- Warn when a disclosure includes unnecessary attributes.

Implementation notes:

- Compare requested attributes against approved attributes.
- Warn when approved attributes exceed what the verifier requested.
- Offer a recommended minimal disclosure set.

Expected benefit:

- Fewer accidental over-disclosures and a stronger privacy posture.

### 12. Add A Small Disclosure Policy Engine

Current direction:

- Disclosure logic is spread across proof material, UI, and service code.

Improvement:

- Centralize disclosure recommendations and warnings.

Implementation notes:

- Add a function such as `evaluateDisclosurePolicy`.
- Inputs should include verifier, purpose, requested attributes, credential
  rows, and holder choices.
- Return `allowed`, `warnings`, `recommendedAttributes`, and
  `requiresAdditionalApproval`.

Expected benefit:

- More consistent decisions and easier future expansion.

### 13. Make Proof Assurance Levels Explicit

Current direction:

- The project distinguishes preview proof envelopes from native Midnight proof
  paths, but this distinction must remain visible everywhere.

Improvement:

- Add a formal assurance-level field to verification results.

Implementation notes:

- Use values such as:
  - `preview`
  - `native-boundary`
  - `native-verified`
- Show issuer verification, DID status, request integrity, holder binding, and
  cryptographic proof verification as separate booleans.
- Avoid language that implies preview proofs are final cryptographic proofs.

Expected benefit:

- Clearer verifier interpretation and lower risk of overstating security.

### 14. Issue Verification Receipts

Current direction:

- Verification results are shown in the UI and can include receipt-like hashes.

Improvement:

- Produce a structured receipt after every successful or failed verification.

Implementation notes:

- Include:
  - verification id
  - verifier id
  - subject DID
  - purpose
  - disclosed attributes or scopes
  - result
  - verification time
  - proof package hash
  - credential hashes
- Keep receipts free of unnecessary personal data.

Expected benefit:

- Better evidence sharing, easier support, and cleaner audit trails.

### 15. Add Presentation History For Holders

Current direction:

- The system stores proof and credential state, but there is no dedicated
  holder-facing history of presentations.

Improvement:

- Show holders what they shared, with whom, and why.

Implementation notes:

- Add a presentation history view.
- Include verifier, purpose, disclosed attributes, proof mode, verification
  result, and timestamp.
- Allow the holder to inspect receipts and report suspicious requests.

Expected benefit:

- More transparency, better user control, and easier detection of misuse.

## Suggested Implementation Order

### Phase 1: High-Impact Safety Improvements

1. Verifier identity and purpose binding.
2. Expiring, single-use proof requests.
3. Credential status endpoint.
4. Append-only audit events.
5. Proof assurance levels.

### Phase 2: Privacy And UX Improvements

1. Attribute-level disclosure model.
2. Improved presentation review UX.
3. Data minimization warnings.
4. Presentation history.
5. Verification receipts.

### Phase 3: Trust And Operations

1. Issuer trust descriptor.
2. Multi-key issuer JWKS.
3. Formal key rotation lifecycle.
4. Disclosure policy engine.

### Phase 4: Future Standards Track

1. SD-JWT VC support.
2. OpenID4VCI issuer profile.
3. OpenID4VP verifier profile.
4. Standard credential status lists.
5. Optional EUDI wallet integration.

## Non-Goals For Now

The following are intentionally out of scope for the near-term product:

- claiming eIDAS or EUDI compliance
- implementing a certified EUDI Wallet
- implementing WSCD or LoA High certification
- integrating real EU Trusted Lists
- issuing PID, QEAA, or qualified trust-service credentials
- replacing the Midnight DID registry with an EUDI-specific identity system

## Analysis Template

Use this template when evaluating each backlog item:

```md
## Item

### Current Behavior

### Proposed Change

### Security Benefit

### UX Benefit

### Data Model Changes

### API Changes

### UI Changes

### Compatibility Risk

### Implementation Steps

### Tests

### Open Questions
```
