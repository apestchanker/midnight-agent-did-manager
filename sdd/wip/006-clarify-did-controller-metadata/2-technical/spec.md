# Technical Spec: Clarify DID `controller` as Informative Metadata, Separate from `subjectWalletAddress`

**Feature**: 006-clarify-did-controller-metadata
**Version**: 1.0
**Status**: Draft
**Date**: 2026-07-10
**Refs**: `1-functional/spec.md`

## Architecture Overview

`controller` becomes a first-class, structured field that rides alongside `subjectWalletAddress` through every layer of the existing pipeline — it is never re-derived by parsing the `didDocument` JSON string at any hop. This mirrors how `organizationName`/`agentName` already flow today: as explicit fields on typed inputs, not extracted from the JSON blob.

```
[RequestForm.tsx]  controller state (default: walletAddress)
        │  onRequest({ ..., controller })
        ▼
[App.tsx handleRequestDid] ──▶ [app-api.ts requestDidWithSync]
        │                              │
        │                     mergeDidMetadata(controller)   (localStorage cache)
        │                              │
        │                     api.requestDid({ ..., controller }) [UnifiedRegistryAPI]
        │                              │  (controller baked into didDocument JSON → on-chain commitment; not a circuit param)
        │                              ▼
        │                     createWalletDidRequest({ ..., controller })
        ▼                              │  POST /api/wallet/did-requests
[serviceApi.ts client] ────────────────┘
                                        ▼
                     [registry-service.js createWalletDidRequest]
                                        │
                     createOrUpdateDidRequestRecord(... controller ...)
                                        ▼
                          did_requests.controller (new column)

[IssuerPanel.tsx]  controller state (default: record?.controller || targetController || walletAddress)
        │  onIssue/onUpdate({ ..., controller })
        ▼
[App.tsx handleIssueDid/handleUpdateDid] ──▶ [app-api.ts issueDidWithSync/updateDidWithSync]
        │                              │
        │                     activeRegistryApi.issueDid/updateDid({ ..., controller }) [UnifiedRegistryAPI]
        │                              │  mergeDidMetadata(controller); returned DidRecord.controller
        │                              ▼
        │                     syncWalletIssuedDid/syncWalletUpdatedDid({ ..., controller })
        ▼                              │  POST /api/wallet/dids/issue-sync|update-sync
[serviceApi.ts client] ────────────────┘
                                        ▼
                    [registry-service.js syncWalletIssuedDid/syncWalletUpdatedDid]
                                        │
                          upsertIssuedDidRecord(... controller ...)
                                        ▼
                          did_records.controller (new column)

[GET /api/dids/resolve] ──▶ [registry-service.js resolveDid()]
                                   controller: record.controller || record.did   (legacy fallback)

[MCP flow] createDidRequest (server-derived controller = holderWallet, caller never sends it)
                                        ▼
                          did_requests.controller (same column, same fallback rules downstream)

buildDidDocumentForRequest (request-document.js), used by issueApprovedDidRequest:
   controller: request.controller || request.subject_wallet_address   (legacy fallback, preserves PRE-feature behavior)
```

Two independent legacy-fallback rules exist deliberately (see ADR-002) because the two pre-feature derivation paths already diverged before this feature and each is preserved on its own terms rather than unified, to avoid silently changing output already observed by relying parties.

## Architecture Decision Records

### ADR-001: `controller` is propagated as a structured field end-to-end, never re-derived from the `didDocument` JSON string

- **Status**: Accepted
- **Context**: `controller` will exist inside the `didDocument` JSON payload (as it already does today) AND as a new persisted column on `did_requests`/`did_records`. Two designs are possible: (a) parse `didDocument` server-side to extract `controller` for the column, or (b) thread `controller` as its own explicit field through every function signature, exactly like `organizationName`, `agentName`, and `subjectWalletAddress` already are.
- **Decision**: Option (b). `RequestDidInput`, `IssueDidInput`, `UpdateDidInput` (`src/types/did.ts`), `CachedDidMetadata` (`src/lib/did/types.ts`), the `serviceApi.ts` client payload types (`createWalletDidRequest`, `syncWalletIssuedDid`, `syncWalletUpdatedDid`), and the corresponding `registry-service.js` functions all gain an explicit `controller` field/parameter.
- **Consequences**: More call sites touched (roughly a dozen), but no JSON-parsing/extraction logic anywhere, no risk of the column silently drifting from the JSON if a caller sends malformed or partial `didDocument` text, and it matches the codebase's existing convention exactly (zero new pattern introduced).
- **Alternatives considered**: Extracting `controller` from `JSON.parse(didDocument).controller` inside `syncWalletIssuedDid`/`syncWalletUpdatedDid` on the server. Rejected: it would be the only field in the whole pipeline derived this way, it silently breaks if the textarea JSON is hand-edited into something that doesn't parse the same way client and server expect, and it re-introduces exactly the kind of implicit derivation this feature exists to eliminate.

### ADR-002: Two independent, non-unified legacy-fallback rules for pre-feature records

- **Status**: Accepted
- **Context**: Before this feature, `resolveDid()` (`server/registry-service.js:1698`) hardcoded `controller: record.did`, while `buildDidDocumentForRequest()` (`src/lib/did/request-document.js:13`) derived `controller: request.subject_wallet_address`. Both now need a fallback for rows where the new `controller` column is `null` (pre-migration data, per proposal's explicit "no backfill" scope).
- **Decision**: Keep each fallback tied to its own prior behavior instead of unifying them to one value:
  - `resolveDid()`: `controller: record.controller || record.did` (matches functional spec REQ-04 Scenario 02 exactly).
  - `buildDidDocumentForRequest()`: `controller: request.controller || request.subject_wallet_address` (matches its own pre-feature output for legacy `did_requests` rows).
- **Consequences**: A legacy DID's `controller` value can differ depending on whether it's read via `/api/dids/resolve` vs. via the issuer document-build path — but that divergence already existed before this feature (that's precisely the bug REQ-04/proposal Approach describes), and this design does not introduce a NEW divergence for legacy data, it just stops the divergence from growing for new data. Documented explicitly wherever these fallbacks appear in code comments.
- **Alternatives considered**: Unify both fallbacks to `record.did`/`requestedDid`. Rejected: `buildDidDocumentForRequest` is called at issuance time from `issueApprovedDidRequest`, before the final DID string is guaranteed identical to what a relying party later resolves in every legacy edge case; changing its fallback would alter the actual issued document contents for legacy requests, a behavior change with no test coverage and no user-facing justification — out of scope per proposal ("no retroactive reconstruction").

### ADR-003: IssuerPanel gains two new props — `walletAddress` (issuer's connected wallet) and `targetController` (persisted value, if any) — with a three-level default chain

- **Status**: Accepted
- **Context**: `IssuerPanel.tsx` currently has no `walletAddress` prop at all (unlike `RequestForm.tsx`, which already receives it). The functional spec requires `controller` to default-populate from the operator's connected wallet at issuance/update time too (REQ-02), but if the DID was already requested with its own `controller`, that persisted value should take priority (REQ-03 Scenario 01).
- **Decision**: Add `walletAddress: string` and `targetController?: string` props to `IssuerPanelProps`. `targetController` is sourced by `App.tsx` from `selectedAdminDid.controller` (a `RegistryDidRow`, `src/types/service.ts:286`) — the persisted value from the linked `did_requests` row. New local state:
  ```ts
  const [controller, setController] = useState(
    record?.controller || targetController || walletAddress || "",
  );
  useEffect(() => {
    setController(record?.controller || targetController || walletAddress || "");
  }, [record?.controller, targetController, walletAddress]);
  ```
  Priority order: already-issued record's own controller → requested-but-not-yet-issued controller → issuer's connected wallet (first-time default). `buildDefaultDidDocument()` uses this `controller` state instead of `targetSubjectWalletAddress || record?.subjectWalletAddress || ""` at line 52. `handleIssue`/`handleUpdate` pass `controller` in the `onIssue`/`onUpdate` payload.
- **Consequences**: `App.tsx`'s `IssuerPanel` call site (lines 2045–2055) needs two new props wired: `walletAddress={walletAddress}` and `targetController={selectedAdminDid.controller}`. `RegistryDidRow` (`src/types/service.ts:286`) needs a `controller?: string | null` field, and `listRegistryDidRecords()`'s explicit column SELECT (`server/registry-service.js:1644-1664`, NOT `select *`) needs `dr.controller,` added — otherwise `selectedAdminDid.controller` is always `undefined` regardless of DB state.
- **Alternatives considered**: Only default from `walletAddress`, ignore any already-persisted `controller`. Rejected: directly violates REQ-03 Scenario 01 (persistence across the lifecycle).

### ADR-004: New UI state is named `controller` (not `controllerAddress`/`didController`) in both components

- **Status**: Accepted
- **Context**: The new UI state needs a name in `RequestForm.tsx` and `IssuerPanel.tsx`. It sits next to `agentAddress`/`subjectWalletAddress`, which are already named after their DID Document / API-payload counterparts with no prefix or suffix.
- **Decision**: `controller` everywhere — identical to the DID Document JSON key it populates and the new DB column name. No prefix/suffix. Follows the codebase's existing 1:1 naming convention for `subjectWalletAddress`, `agentName`, etc.
- **Consequences**: Zero translation/mapping needed between UI state, payload field, DB column, and JSON key — a single grep for `controller` finds every layer. No new naming convention introduced for future contributors to learn.
- **Alternatives considered**: `controllerAddress` (mirrors `subjectWalletAddress`'s "Address" suffix) or `didController` (disambiguates from other unrelated "controller" concepts in the codebase). Rejected: neither matches the DID Document JSON key or DB column name verbatim, which would reintroduce the exact kind of naming/derivation ambiguity this feature is meant to remove.

## Component Design

Organized by pipeline stage: types → UI → client API → server → schema → docs.

### Types

#### `src/types/did.ts`
**Responsabilidad**: Typed contracts for DID request/issue/update/record payloads shared across UI, client API, and app-api layers.
**Cambio**: Add `controller?: string` to `RequestDidInput`, `IssueDidInput`, `UpdateDidInput`, `DidRecord`. `RevokeDidInput`: no change (revoke does not touch controller).
**Dependencias**: Consumed by `RequestForm.tsx`, `IssuerPanel.tsx`, `App.tsx`, `src/lib/did/app-api.ts`, `src/lib/registry/unified-registry-api.ts`.

#### `src/lib/did/types.ts` (`CachedDidMetadata`)
**Responsabilidad**: Shape of the localStorage-cached DID metadata used for optimistic UI state before/independent of server confirmation.
**Cambio**: Add `controller?: string;` next to `subjectWalletAddress?: string;` (line 38).
**Dependencias**: Written/read by `mergeDidMetadata()` in `src/lib/registry/unified-registry-api.ts` and `src/lib/did/app-api.ts`.

#### `src/types/service.ts`
**Responsabilidad**: Wire-level row shapes returned by the registry-service HTTP API.
**Cambio**:
- `DidRequestRow` (line 71): add `controller?: string | null;` next to `subject_wallet_address` (line 80).
- `RegistryDidRow` (line 286): add `controller?: string | null;` next to `subject_wallet_address` (line 292).
- `getPersistedDidState`'s inline return type in `src/utils/serviceApi.ts` (lines 279–305): add `controller?: string | null;`.
**Dependencias**: `RegistryDidRow.controller` is the field ADR-003's `targetController` prop is sourced from — depends on `listRegistryDidRecords()`'s SELECT actually returning the column (see Server section).

### UI

#### `src/components/RequestForm.tsx`
**Responsabilidad**: Human-Operator-facing form for submitting a new DID request; owns `controller` state independent of `agentAddress`.
**Interfaz pública**:
```ts
onRequest(input: { /* existing fields */, controller?: string }): void
```
**Cambio**: New state next to `agentAddress` (line 40):
```ts
const [controller, setController] = useState(walletAddress || "");
useEffect(() => {
  setController(walletAddress || "");
}, [walletAddress]);
```
Default-document effect (lines 58–80): change `controller: agentAddress || ""` to `controller: controller || ""`, add `controller` to deps array. UI placement: new editable `Input` directly under the existing "Human Wallet" read-only block (lines 129–136), labeled "Controller (DID Document metadata)", helper text: "Informative DID Document metadata — does not grant authorization. See README § DID Document `controller` Field." `handleSubmit` (line 96): add `controller` to `onRequest(...)` payload.
**Dependencias**: `walletAddress` prop (already present). `onRequest` prop type gains `controller?: string`.

#### `src/components/IssuerPanel.tsx`
**Responsabilidad**: Operator-facing panel for issuing/updating/revoking a DID; owns `controller` state per the three-level default chain (ADR-003).
**Interfaz pública**:
```ts
interface IssuerPanelProps {
  // existing props...
  walletAddress: string;          // new
  targetController?: string;      // new
}
onIssue(input: { /* existing fields */, controller?: string }): void
onUpdate(input: { /* existing fields */, controller?: string }): void
onRevoke(input: { /* existing fields */ }): void   // unchanged
```
**Cambio**: `IssuerPanelProps` gains `walletAddress: string` and `targetController?: string`. New state/effect per ADR-003. `buildDefaultDidDocument()` line 52: `targetSubjectWalletAddress || record?.subjectWalletAddress || ""` → `controller || ""`; add `controller` to `useCallback` deps. `handleIssue`/`handleUpdate` (lines 92-142): add `controller` to `onIssue`/`onUpdate` payloads.
**Dependencias**: `App.tsx` call site must supply the two new props (see App.tsx below).

### Client API

#### `src/lib/registry/unified-registry-api.ts`
**Responsabilidad**: Client-side facade over on-chain circuit calls and off-chain metadata caching for the unified gated registry.
**Interfaz pública**:
```ts
gatedSelfRegisterDid(opts: { ..., controller?: string }): Promise<...>
requestDid(input: { ..., controller?: string }): Promise<...>
updateDid(opts: { ..., controller?: string }): Promise<DidRecord>
issueDid(opts: { ..., controller?: string }): Promise<DidRecord>
revokeDid(opts: { ... }): Promise<...>   // unchanged
```
**Cambio**: `gatedSelfRegisterDid` (315), `updateDid` (472), `issueDid` (587), `revokeDid` (530, no change to its own signature — listed for completeness) accept `controller`, include it in `mergeDidMetadata(...)` patch and in the returned `DidRecord` (`controller: opts.controller ?? cached.controller`). `requestDid` (447): add `controller?: string` to inline input type, thread into `gatedSelfRegisterDid({...})` call (459). No circuit-call changes anywhere — `controller` never becomes a `callTx.*` argument, stays off-chain metadata baked into `didDocument`.
**Dependencias**: `src/lib/did/app-api.ts`, `src/lib/did/types.ts` (`CachedDidMetadata`).

#### `src/lib/did/app-api.ts`
**Responsabilidad**: Application-level orchestration between `UnifiedRegistryAPI` and server-side sync endpoints (`serviceApi.ts`).
**Interfaz pública**:
```ts
requestDidWithSync(input: { ..., controller?: string }): Promise<...>
issueDidWithSync(input: { ..., controller?: string }): Promise<...>
updateDidWithSync(input: { ..., controller?: string }): Promise<...>
```
**Cambio**: `requestDidWithSync` (92): add `controller?: string` to input type; include in `mergeDidMetadata(...)` patch (107) and `createWalletDidRequest({...})` call (131). `issueDidWithSync` (159): pass `controller: input.controller` into `syncWalletIssuedDidStorage({...})` (165). `updateDidWithSync` (205): pass `controller: input.controller` into `syncWalletUpdatedDidStorage({...})` (211).
**Dependencias**: `src/lib/registry/unified-registry-api.ts`, `src/utils/serviceApi.ts`.

#### `src/utils/serviceApi.ts`
**Responsabilidad**: Thin HTTP client wrapping the registry-service REST endpoints.
**Interfaz pública**:
```ts
createWalletDidRequest(payload: { ..., controller?: string }): Promise<...>
syncWalletIssuedDid(payload: { ..., controller?: string }): Promise<...>
syncWalletUpdatedDid(payload: { ..., controller?: string }): Promise<...>
getPersistedDidState(...): Promise<{ ..., controller?: string | null }>
```
**Cambio**: `createWalletDidRequest` (223), `syncWalletIssuedDid` (472), `syncWalletUpdatedDid` (498): add `controller?: string` to payload types. `getPersistedDidState` inline return type (279): add `controller?: string | null;`.
**Dependencias**: `server/registry-service.js` REST endpoints (`POST /api/wallet/did-requests`, `POST /api/wallet/dids/issue-sync`, `POST /api/wallet/dids/update-sync`).

#### `src/App.tsx`
**Responsabilidad**: Top-level orchestration wiring UI components to `app-api.ts`, and supplying `IssuerPanel`'s new props.
**Interfaz pública**: (internal handlers, not exported)
```ts
handleRequestDid(payload: { ..., controller?: string }): void
handleIssueDid(payload: { ..., controller?: string }): void
handleUpdateDid(payload: { ..., controller?: string }): void
```
**Cambio**: `handleRequestDid` (660): add `controller?: string` to payload type, pass into `requestDidWithSync(...)` (673). `handleIssueDid`/`handleUpdateDid` (720): add `controller?: string` to payload types, pass through to `activeRegistryApi.issueDid({...})`/`updateDid({...})` (767). `IssuerPanel` call site (2045–2055): add `walletAddress={walletAddress}` and `targetController={selectedAdminDid.controller}`. Repair `useEffect` (584–631) that re-creates a wallet DID request via `createWalletDidRequest` when missing: add `controller: didRecord.controller || walletAddress` to its call (598).
**Dependencias**: `src/lib/did/app-api.ts`, `src/components/RequestForm.tsx`, `src/components/IssuerPanel.tsx`.

### Server

#### `server/registry-service.js`
**Responsabilidad**: Server-side persistence and business logic for DID requests/records, backing the REST endpoints consumed by `serviceApi.ts` and the MCP flow.
**Interfaz pública** (function signatures affected):
```js
createOrUpdateDidRequestRecord(input: { ..., controller?: string })
createWalletDidRequest(input: { ..., controller?: string })
createDidRequest(input: { ..., holderWallet })   // MCP flow — controller derived server-side
issueApprovedDidRequest(requestId)
upsertIssuedDidRecord(input: { ..., controller?: string })
syncWalletIssuedDid(input: { ..., controller?: string })
syncWalletUpdatedDid(input: { ..., controller?: string })
resolveDid(did): { ..., controller: string }
listRegistryDidRecords(...): RegistryDidRow[]   // now includes controller
```
**Cambio**:
- `createOrUpdateDidRequestRecord` (line 840): accept `input.controller`, default `input.controller || requesterWallet`. Add to `update` branch (lines 875-905) as `controller = $N`, and `insert` branch (lines 911-956) as new column + placeholder.
- `createWalletDidRequest` (line 1156): pass `controller: input.controller` through.
- `createDidRequest` (MCP flow, line 1097): pass `controller: holderWallet` (server-derived — MCP callers never send `controller`, per existing `platformGeneratedDidFields` contract; see `server/mcp-core.js` below).
- `issueApprovedDidRequest` (line 1275): pass `controller: request.controller` into `upsertIssuedDidRecord` (line 1373-1390).
- `upsertIssuedDidRecord` (line 970): accept `input.controller`; add to `insert` branch (998-1039) and `update` branch (1061-1091, `controller = $N`).
- `syncWalletIssuedDid` (line 1435): accept/pass `controller: input.controller`.
- `syncWalletUpdatedDid` (line 1501): accept `input.controller`; extend `update did_records` (1503-1517) with `controller = coalesce($N, controller)` — MUST be `coalesce`, not a hard overwrite, so an update call omitting `controller` doesn't null it out.
- `resolveDid` (line 1680): line 1698 `controller: record.did` → `controller: record.controller || record.did` (ADR-002). `select *` (line 1682) unchanged — already returns the new column once it exists.
- `listRegistryDidRecords` (line 1637): explicit column list (1644-1664) needs `dr.controller,` added — required for ADR-003's `targetController` to ever carry a real value.
**Dependencias**: `server/schema.sql` (new columns), `src/lib/did/request-document.js` (`issueApprovedDidRequest` calls `buildDidDocumentForRequest`), `server/mcp-core.js` (MCP flow entry point for `createDidRequest`).

#### `src/lib/did/request-document.js`
**Responsabilidad**: Builds the synthesized DID Document object for a `did_requests` row at issuance time.
**Interfaz pública**:
```js
buildDidDocumentForRequest(request): DidDocumentLike
```
**Cambio**: Line 13: `controller: request.subject_wallet_address` → `controller: request.controller || request.subject_wallet_address` (ADR-002).
**Dependencias**: Called by `issueApprovedDidRequest` in `server/registry-service.js`.

#### `server/mcp-core.js`
**Responsabilidad**: MCP tool-call entry points for the DID request flow, including the caller-facing contract that `controller` is platform-generated and must not be supplied by the MCP caller.
**Cambio**: No code change. `platformGeneratedDidFields` (605-610) already lists `controller`; prompt text (962) already tells callers not to send it. Server-side source of the derived value is `holderWallet`, wired via `createDidRequest` in `registry-service.js`.
**Dependencias**: `server/registry-service.js` (`createDidRequest`).

### Schema

#### `server/schema.sql`
**Responsabilidad**: Idempotent, additive schema migrations applied on server startup.
**Cambio**: Insert after line 139, before line 140's backfill block:
```sql
alter table if exists did_requests add column if not exists controller text;
alter table if exists did_records add column if not exists controller text;
```
Nullable, no default, no backfill, no index — consistent with the existing `add column if not exists` convention already used in this file.
**Dependencias**: Consumed by every `registry-service.js` function listed above.

### Docs

#### `README.md`
**Responsabilidad**: Project documentation, including the existing authorization-model sections (`### On-chain`, `## Coin-Gated Authorization (v0.9)`).
**Cambio**: New subsection "### DID Document `controller` Field" inserted after line 491 (end of `### Off-chain` content), before line 493 (`## Midnight-Centered Credential Direction`):
```markdown
### DID Document `controller` Field

The `controller` field inside a DID Document is informative W3C DID metadata. It
records who the document *declares* as its controller and defaults to the human
operator's connected wallet at request/issuance/update time, editable before
submission. It has no bearing on who is actually authorized to update or revoke a
DID on this platform.

Real authorization is governed exclusively on-chain by possession and consumption
of the correct capability-token color — see "Authorization model — coin-gated, not
identity-gated" above and [Coin-Gated Authorization (v0.9)](#coin-gated-authorization-v09).
Possessing, matching, or controlling the `controller` value neither grants nor is
required for update or revoke permission.

DID records created before this field existed have no persisted `controller` value;
resolution falls back to the DID's own identifier for those legacy records.
```
**Dependencias**: None — documentation-only change, satisfies REQ-05.

## Data Model

```sql
alter table if exists did_requests add column if not exists controller text;
alter table if exists did_records add column if not exists controller text;
```

Both nullable, no default, no backfill, no new index. Applied via the existing idempotent migration pattern in `server/schema.sql` (lines 136-139 today; new statements inserted immediately after, before the existing backfill block at line 140).

## Compact Contract Changes: None

This feature makes **zero** changes to `contracts/did_registry.compact` or `contracts/did_registry.compact.template`. Confirmed by tracing every `UnifiedRegistryAPI` call site that invokes `callTx.*` (`gatedSelfRegisterDid`, `updateDid`, `issueDid`, `revokeDid` in `src/lib/registry/unified-registry-api.ts`): none of them takes `controller` as a circuit argument, before or after this feature. `controller` is, and remains, off-chain metadata baked into the `didDocument` JSON string that is committed to on-chain state as an opaque blob — the on-chain `did_controller: Map<Bytes<32>, ZswapCoinPublicKey>` ledger state (keyed via `ownPublicKey()`) is a completely separate, pre-existing mechanism that this feature does not read, write, or otherwise touch. No new circuit, no new ledger field, no new witness, no change to any existing circuit's argument list or disclosure behavior.

## API Contract

| Endpoint | Change |
|---|---|
| `POST /api/wallet/did-requests` | body gains optional `controller`; server defaults to `walletAddress` (requester wallet) if omitted |
| `POST /api/wallet/dids/issue-sync` | body gains optional `controller` |
| `POST /api/wallet/dids/update-sync` | body gains optional `controller` |
| `GET /api/dids/resolve?did=...` | response `didDocument.controller` now reflects `record.controller \|\| record.did` instead of always `record.did` |
| `GET /api/registry/dids?contractAddress=...` | rows now include `controller` (explicit column list extended) |
| `POST /api/admin/did-requests/:id/issue` | no wire-contract change — `controller` for this path comes from the already-persisted `did_requests.controller` |

## Error Handling

- **Missing/empty `controller` on request/issue/update**: not an error. Every write path treats an omitted `controller` as "use the default" (requester/issuer wallet) rather than rejecting the request — matches REQ-02's default-population requirement, no new validation error surfaces to the Human Operator.
- **`syncWalletUpdatedDid` omitting `controller` on an update call**: MUST NOT be treated as "clear the value." The `coalesce($N, controller)` SQL pattern (see `server/registry-service.js` § Server) preserves the existing persisted value rather than nulling it out or erroring — this is a correctness requirement, not merely an optimization, per ADR risk table.
- **Legacy rows with `controller IS NULL`**: not an error condition anywhere in the pipeline. Both `resolveDid()` and `buildDidDocumentForRequest()` fall back deterministically (ADR-002) rather than throwing or returning `null`/`undefined` to a Relying Party.
- **Malformed/hand-edited `didDocument` JSON in the issuer textarea**: unchanged from today's existing behavior for this feature — since `controller` is never parsed out of the JSON string (ADR-001), a malformed JSON blob cannot silently corrupt the persisted `controller` column the way it could under the rejected JSON-extraction alternative. Existing JSON validation/error surfacing in `IssuerPanel.tsx`/`RequestForm.tsx` for the textarea itself is unchanged.
- **No new user-facing error states are introduced by this feature.** All new fields are optional with deterministic defaults/fallbacks at every layer.

## Testing Strategy

- **Unit tests**: `buildDidDocumentForRequest`/`resolveDid` fallback behavior (ADR-002), `createOrUpdateDidRequestRecord`/`upsertIssuedDidRecord` insert/update branches, `RequestForm.tsx` state independence (REQ-01 S02), `IssuerPanel.tsx` three-level default chain (ADR-003).
- **Integration tests** (real/test Postgres, per `tests/unified-registry.test.ts` patterns): full request→issue cycle with `controller` ≠ `subjectWalletAddress`; update cycle changing `controller`; legacy row simulation (`controller = null`) confirming both fallbacks independently.
- **E2E tests**: not required by this feature — no new user-visible flow beyond an additional form field within existing request/issue/update screens; covered by the integration layer above plus manual verification of REQ-05/REQ-06 (documentation and non-regression, respectively).

Referencia a scenarios de `1-functional/spec.md`: cada scenario MUST tener al menos un test correspondiente.

| Scenario | Test type |
|---|---|
| REQ-01 S01 | integration |
| REQ-01 S02 | unit (RequestForm) |
| REQ-02 S01/S02 | unit (RequestForm/IssuerPanel) |
| REQ-03 S01/S02 | integration |
| REQ-04 S01/S02 | unit (resolveDid, request-document) |
| REQ-05 S01/S02 | manual/doc-lint |
| REQ-06 S01/S02 | unit (RequestForm/IssuerPanel) |

## Non-Functional Requirements

- **Performance**: Negligible impact. One additional nullable `text` column per table (no index), one additional field on already-existing JSON payloads, one additional `SELECT` column in an already-executed query. No new round-trips, no new queries, no N+1 risk introduced.
- **Security**: This is a **metadata-clarity fix, not an authorization-model change**. Before and after this feature, the sole source of truth for who may update or revoke a DID is the on-chain `did_controller` map plus capability-token possession/consumption (`did_token_color`, `consumeToken`), governed entirely by `contracts/did_registry.compact`/`.template` — see "Compact Contract Changes: None" above. `controller` as introduced by this feature is, and is documented to be (REQ-05), purely descriptive off-chain metadata inside the `didDocument` JSON: it is never read by any authorization check, never passed to any `callTx.*` circuit call, and never gated on. No code path in this feature grants, denies, or influences update/revoke permission based on the `controller` value, whether it matches, differs from, or is absent relative to the caller's wallet. The functional-spec requirement (REQ-05 Scenario 02) that documentation must not imply otherwise is treated as a hard constraint on the README copy in this spec's Docs section, not merely a suggestion — any wording implying `controller` grants authority would be a defect in this feature's own deliverable. This spec does not change, weaken, or bypass the coin-gated authorization model delivered in `sdd/wip/005-coin-gated-admin-access`.
- **Observability**: No new logs, metrics, or traces are required by this feature. Existing request/issue/update logging in `server/registry-service.js` (if any) picks up `controller` for free as part of the already-logged input object; no dedicated instrumentation is added since `controller` carries no operational/alerting significance (it is display metadata, not a control-flow input).
