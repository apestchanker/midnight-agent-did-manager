# Functional Spec: Clarify DID `controller` as Informative Metadata, Separate from `subjectWalletAddress`

**Feature**: 006-clarify-did-controller-metadata
**Version**: 1.0
**Status**: Draft
**Date**: 2026-07-10

## Overview

Today, a single input in the DID request/issuance experience feeds two conceptually different values at once: the wallet address of the agent the DID is being issued for (its subject binding), and the `controller` field of the resulting DID Document — a declarative W3C DID metadata attribute. Because both values come from the same input, a Human Operator has no way to state that a DID is issued for one agent while being administratively described as controlled by a different party (typically the human operator's own wallet), and anyone reading the resulting DID Document may reasonably — but incorrectly — assume `controller` determines who is authorized to manage the DID.

This feature gives `controller` its own identity throughout the DID lifecycle: it is populated by default from the Human Operator's connected wallet, remains editable before submission, and is persisted and returned independently of the subject wallet address at every stage — request, issuance, and update. It also closes the documentation gap that allows `controller` to be misread as an authorization mechanism: the real authorization model is (and remains) governed entirely on-chain by capability-token possession, and this feature makes that explicit wherever `controller` is described.

No change is made to how or who is actually authorized to update or revoke a DID. This feature only changes what `controller` means as metadata, how it is populated and stored, and how it is documented.

## Actors

| Actor | Description |
|-------|-------------|
| Human Operator | The person who connects a wallet, and creates and administers agents and DIDs. Submits DID requests, issuances, and updates, and provides or edits the `controller` value. |
| Relying Party | Any consumer of a resolved DID Document, whether the platform's own resolution endpoint or an external verifier, who reads the `controller` field to understand the document's declared metadata. |

## Requirements

### REQ-01: Controller Independent from Subject Wallet Address

The DID Document's `controller` field MUST be represented and stored as its own value, independent of the subject wallet address bound to the DID. The two values MAY be identical or MAY differ, and providing or changing one MUST NOT implicitly set or overwrite the other.

#### Scenarios

**Scenario 01: Controller differs from subject wallet address**
```
Given a Human Operator is preparing a DID request for an agent with a known subject wallet address
When  the Human Operator submits the request with a controller value that differs from the agent's subject wallet address
Then  the system stores both values independently
      AND the resulting DID Document's controller field reflects the submitted controller value, not the subject wallet address
```

**Scenario 02: Omitted controller does not corrupt subject wallet address**
```
Given a Human Operator is preparing a DID request
When  the Human Operator submits the request without providing an explicit controller value
Then  the system MUST NOT derive or overwrite the subject wallet address from any controller-related logic
      AND the subject wallet address field remains exactly as submitted
```

### REQ-02: Controller Default Population and Manual Edit

When a Human Operator with a connected wallet begins preparing a DID request, issuance, or update, the system MUST default-populate the `controller` field with the operator's connected wallet address, and MUST allow the operator to edit this value manually before submission.

#### Scenarios

**Scenario 01: Default population from connected wallet**
```
Given a Human Operator has connected a wallet with address W
When  the Human Operator opens the DID request or issuance form
Then  the controller field is pre-filled with W by default
```

**Scenario 02: Manual override before submission**
```
Given the controller field has been default-populated with the operator's connected wallet address
When  the Human Operator edits the controller field to a different value before submitting
Then  the system uses the manually edited value as the controller, not the default
      AND the submitted value, not W, is what gets persisted
```

### REQ-03: Controller Persistence Across the DID Lifecycle

The `controller` value MUST persist consistently through the full DID lifecycle — from initial request, through issuance, through any subsequent update — such that the most recently confirmed value is what gets stored and later returned.

#### Scenarios

**Scenario 01: Controller persists from request to issuance**
```
Given a DID request was submitted with an explicit controller value C1
When  the DID is issued from that request without the controller being changed during issuance
Then  the issued DID record retains C1 as its controller value
```

**Scenario 02: Controller persists through update**
```
Given an active DID currently has controller value C1
When  the Human Operator updates the DID and changes the controller field to C2
Then  the DID record's controller value becomes C2
      AND any subsequent read of that DID reflects C2, not C1
```

### REQ-04: Resolution Returns Explicit Controller with Documented Legacy Fallback

When a Relying Party resolves a DID, the system MUST return the explicit `controller` value persisted for that DID. For DID records that predate this feature and therefore have no persisted `controller` value, the system MUST fall back to using the DID's own identifier as the controller value, and this fallback behavior MUST be documented.

#### Scenarios

**Scenario 01: Resolution returns the explicit controller for records created under this feature**
```
Given a DID was issued after this feature with an explicit controller value C
When  a Relying Party resolves that DID
Then  the resolved DID Document's controller field equals C
```

**Scenario 02: Resolution falls back for legacy records without a persisted controller**
```
Given a DID record that predates this feature has no persisted controller value
When  a Relying Party resolves that DID
Then  the resolved DID Document's controller field equals the DID's own identifier
      AND this fallback behavior is documented as the expected outcome for legacy records
```

### REQ-05: Controller Documented as Non-Authoritative Metadata

Project documentation MUST explicitly state that the `controller` field is informative DID Document metadata and has no bearing on who is authorized to update or revoke the DID. Documentation MUST attribute actual authorization exclusively to the existing on-chain capability-token mechanism.

#### Scenarios

**Scenario 01: Documentation states controller is non-authoritative and points to the real authorization model**
```
Given the project's documentation
When  a reader looks up the description of the controller field
Then  the documentation explicitly states that controller is informative metadata with no authorization effect
      AND the documentation refers the reader to the existing on-chain capability-token authorization model as the actual authorization mechanism
```

**Scenario 02: Documentation text does not imply controller governs update or revoke authority**
```
Given the project's documentation describing the controller field
When  the surrounding text is reviewed for any claim about who can update or revoke a DID
Then  the text MUST NOT state or imply that possessing, matching, or controlling the controller value grants or is required for update or revoke permission
      AND every statement about update/revoke permission in that documentation attributes it exclusively to the capability-token mechanism
```

### REQ-06: Subject Wallet Address Behavior Unchanged (Non-Regression)

Existing behavior, naming, and flows involving the subject wallet address MUST remain unchanged by this feature. The subject wallet address MUST continue to identify the agent bound to the DID exactly as it did before this feature, unaffected by any controller-related change.

#### Scenarios

**Scenario 01: Subject wallet address flow is unaffected by this feature**
```
Given the existing request/issue/update flows that populate and use the subject wallet address
When  this feature is deployed
Then  the subject wallet address field's name, its semantics as the agent bound to the DID, and its existing population/edit behavior remain exactly as before
```

**Scenario 02: Editing the controller field does not affect the subject wallet address**
```
Given a DID with a subject wallet address already set
When  the controller field is default-populated or manually edited (per REQ-02)
Then  the subject wallet address value does not change as a side effect
```

## Out of Scope

- Any change to the on-chain Compact contract's controller model (`did_controller` map keyed by wallet public key). That model governs actual authorization, is already correct, and is not touched by this feature.
- Any future use of the subject wallet address as the agent's own wallet for payment or receipt of funds — noted by the user as a possible future direction, explicitly deferred.
- Retroactive data migration that reconstructs a `controller` value for DID records issued before this feature. Legacy records continue to resolve `controller` via the documented fallback (REQ-04, Scenario 02) and are not backfilled.
- Any change to how the MCP/API flow decides that `controller` is a platform-generated field the caller must not send — that existing design is preserved; only the server-side source of the derived value changes.
