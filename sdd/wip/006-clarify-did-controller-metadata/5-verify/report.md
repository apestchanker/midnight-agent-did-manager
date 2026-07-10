# Verification Report: 006-clarify-did-controller-metadata

**Fecha**: 2026-07-10
**Verificado por**: sdd-verifier
**Estado final**: APPROVED

## Spec Compliance Matrix

| REQ | Scenario | Status | Test file | Notas |
|-----|----------|--------|-----------|-------|
| REQ-01 | Scenario 01: Controller differs from subject wallet address | COMPLIANT | `tests/did-controller-lifecycle.test.ts:33-183` | Full request→issue→resolve cycle asserts `controller` (C1) and `subject_wallet_address` are stored and returned independently, `record.controller !== record.subject_wallet_address` explicitly asserted (line 108). |
| REQ-01 | Scenario 02: Omitted controller does not corrupt subject wallet address | COMPLIANT | `tests/request-form-state.test.ts:20-73` | `agentControllerReducer` describe block proves `SET_CONTROLLER`/`SYNC_CONTROLLER_DEFAULT` leave `agentAddress` byte-for-byte unchanged and vice versa, including a chained-actions test. Reducer is the actual state mechanism wired into `RequestForm.tsx` (confirmed via `useReducer(agentControllerReducer, ...)` at line 46), not a structural proxy. |
| REQ-02 | Scenario 01: Default population from connected wallet | COMPLIANT | `tests/request-form-state.test.ts:8-18`, `tests/issuer-panel-state.test.ts:7-50` | `computeDefaultController(walletAddress)` returns `walletAddress`; `computeIssuerDefaultController` priority-3 case returns `walletAddress` when nothing else set. Both functions are actually called from their components' `useState`/`useEffect` initializers (verified by reading `RequestForm.tsx:46-70` and `IssuerPanel.tsx:46-88`). |
| REQ-02 | Scenario 02: Manual override before submission | COMPLIANT | `tests/request-form-state.test.ts:26-33`, `IssuerPanel.tsx:198-210` | `SET_CONTROLLER` reducer action models the manual-edit path and is asserted to update `controller` independent of the default. `handleSubmit`/`handleIssue`/`handleUpdate` all read current `controller` state into the payload (`RequestForm.tsx:111`, `IssuerPanel.tsx:111,137`), so an edited value — not the default — reaches `onRequest`/`onIssue`/`onUpdate`. |
| REQ-03 | Scenario 01: Controller persists from request to issuance | COMPLIANT | `tests/did-controller-lifecycle.test.ts:33-183` | Same cross-layer test as REQ-01 S01: `createWalletDidRequest` (C1) → `issueApprovedDidRequest` asserts `record.controller === controllerC1` (line 168) with no change during issuance. |
| REQ-03 | Scenario 02: Controller persists through update | COMPLIANT | `tests/did-controller-lifecycle.test.ts:185-262` | Explicit before/after `resolveDid()` around a `syncWalletUpdatedDid(C1→C2)` call; asserts `afterUpdate.controller === C2` and `!== C1` (lines 260-261). |
| REQ-04 | Scenario 01: Resolution returns explicit controller for new records | COMPLIANT | `tests/registry-service-issue.test.ts:226-240`, `tests/did-controller-lifecycle.test.ts:180-182` | `resolveDid` returns `record.controller` when present (unit) and end-to-end via the lifecycle test's resolve step. |
| REQ-04 | Scenario 02: Resolution falls back for legacy records | COMPLIANT | `tests/registry-service-issue.test.ts:242-256`, `tests/did-controller-lifecycle.test.ts:264-314` | Unit test asserts fallback to `record.did` when `controller` is null. Lifecycle test additionally proves the two ADR-002 fallback rules (`resolveDid` → `record.did`; `buildDidDocumentForRequest` → `subject_wallet_address`) are independent and land on different values for the same legacy row pair. |
| REQ-05 | Scenario 01: Documentation states controller is non-authoritative and points to real auth model | COMPLIANT (manual/doc-lint per technical spec) | `README.md:493-515` | New "### DID Document `controller` Field" section explicitly states informative-metadata status, "has no bearing on who is actually authorized to update or revoke a DID," and cross-references "Authorization model — coin-gated, not identity-gated" and the `#coin-gated-authorization-v09` section. Manually verified by direct read — no automated test exists for this scenario, consistent with the technical spec's own Testing Strategy table (`REQ-05 S01/S02 → manual/doc-lint`). |
| REQ-05 | Scenario 02: Documentation text does not imply controller governs update/revoke authority | COMPLIANT (manual/doc-lint per technical spec) | `README.md:493-515`, `src/components/RequestForm.tsx:161`, `src/components/IssuerPanel.tsx:208-217` | Manually reviewed every controller-adjacent authorization sentence in the repo: (1) README §493-515 attributes authorization exclusively to capability-token possession/consumption and explicitly disambiguates the off-chain `controller` field from the separate on-chain `did_controller` ledger entry mentioned in the Development section (line 112), preventing the reader from conflating the two; (2) `RequestForm.tsx:161` and `IssuerPanel.tsx:209` both carry "does not grant authorization" helper text next to the editable field; (3) `IssuerPanel.tsx:213-217`'s adjacent authorization note reads "Issuance and revocation are authorized on-chain by possession and consumption of the correct capability token — not by this `controller` field, and not by a browser owner secret" — an explicit negative statement ruling out the exact misreading REQ-05 exists to prevent. No sentence found anywhere that states or implies controller value possession/matching grants or is required for update/revoke permission. |
| REQ-06 | Scenario 01: Subject wallet address flow unaffected | COMPLIANT | `tests/request-form-state.test.ts`, `tests/issuer-panel-state.test.ts` (full files) | No test in either file's `agentAddress`/`subjectWalletAddress` assertions changed semantics; `agentControllerReducer`'s `SET_AGENT_ADDRESS`/`SYNC_AGENT_ADDRESS_FROM_PROP` actions preserve pre-existing behavior (confirmed by reading `RequestForm.tsx` — `agentAddress` prop/state naming and population untouched). |
| REQ-06 | Scenario 02: Editing controller does not affect subject wallet address | COMPLIANT | `tests/request-form-state.test.ts:26-33,53-60`, `tests/issuer-panel-state.test.ts` (three-level chain tests) | Directly asserted: `SET_CONTROLLER`/`SYNC_CONTROLLER_DEFAULT` reducer actions leave `agentAddress` byte-for-byte equal to its prior value. `IssuerPanel`'s `controller` state/effect is independent of `targetSubjectWalletAddress`/`record?.subjectWalletAddress`, confirmed by reading `IssuerPanel.tsx:46-88` (no shared state or derivation between the two). |

### Resumen de compliance

| Status | Count |
|--------|-------|
| COMPLIANT | 12 |
| PARTIAL | 0 |
| MISSING | 0 |
| SKIPPED | 0 |
| **Total scenarios** | 12 |

**Compliance rate**: 100% (12/12)

Nota: REQ-05's dos scenarios están marcados COMPLIANT vía verificación manual/doc-lint, tal como especifica explícitamente `2-technical/spec.md`'s Testing Strategy table (`REQ-05 S01/S02 | manual/doc-lint`) — no existe ni se esperaba un test automatizado para estos dos scenarios. La verificación manual fue realizada por este agente leyendo directamente `README.md:493-515`, `RequestForm.tsx`, e `IssuerPanel.tsx` línea por línea (no se asumió el contenido desde `progress.md`).

## Test Results

**Suite ejecutado (reportado por sdd-tdd-runner)**: `npm test` (feature scope: 9 archivos) + full suite
**Resultado feature scope**: 98/98 passing, 0 failing, 0 build errors
**Resultado full suite**: 31 archivos, 273/273 passing, 0 failing
**Regresiones fuera de scope**: ninguna

No failing tests to report.

## Task Completion

| ID | Título | Status | Archivos OK |
|----|--------|--------|-------------|
| 1  | Add controller field to shared DID types | done | ✓ |
| 2  | Add controller column to did_requests and did_records schema | done | ✓ |
| 3  | Persist controller on DID request creation/update paths | done | ✓ |
| 4  | Fall back to subject_wallet_address for legacy requests in buildDidDocumentForRequest | done | ✓ |
| 5  | Persist and resolve controller on issue/update/resolve/list paths | done | ✓ |
| 6  | Thread controller through UnifiedRegistryAPI client facade | done | ✓ |
| 7  | Propagate controller through app-api.ts and serviceApi.ts | done | ✓ |
| 8  | Add independent controller field to RequestForm | done | ✓ |
| 9  | Add three-level default controller chain to IssuerPanel | done | ✓ |
| 10 | Wire controller props and payloads through App.tsx | done | ✓ |
| 11 | Document controller as non-authoritative DID Document metadata | done | ✓ |
| 12 | Cross-layer tests for full request-to-issue and update lifecycles | done | ✓ |
| 13 | Final build, typecheck, full test suite, and doc-wording verification | done | ✓ |

**Tasks completas**: 13/13

Todos los archivos declarados en `files` para cada tarea fueron confirmados existentes y con contenido no vacío, incluyendo los dos módulos de lógica pura extraídos por el implementador (`src/lib/did/request-form-state.ts`, `src/lib/did/issuer-panel-state.ts`), que no figuraban en el `tasks.json` original pero son consumidos directamente por `RequestForm.tsx`/`IssuerPanel.tsx`.

## Wiring Check

**Entrypoint verificado**: `src/App.tsx`

Verificaciones puntuales (lectura directa del código, no del progress.md):
- `handleRequestDid` (línea 679): pasa `controller: payload.controller` a `requestDidWithSync(...)`.
- `handleIssueDid` (línea 775): pasa `controller: payload.controller` a `activeRegistryApi.issueDid(...)`.
- `handleUpdateDid` (línea 861): pasa `controller: payload.controller` a `updateDidWithSync(...)`.
- `IssuerPanel` call site (líneas 2052-2064): pasa `walletAddress={walletAddress}` (línea 2058) y `targetController={selectedAdminDid.controller ?? undefined}` (línea 2059), ambos nuevos props requeridos por ADR-003.
- Repair `useEffect` (línea 602): incluye `controller: didRecord.controller || walletAddress` en su llamada a `createWalletDidRequest`.

**Estado**: OK — todos los componentes nuevos están conectados end-to-end desde la UI hasta el servidor.

## Hallazgos

### Bloqueantes (requieren resolución antes de archivar)
Ninguno.

### Warnings (recomendados pero no bloqueantes)
- `tasks.json`'s test-file hints for tasks 3, 8, y 9 (`tests/registry-service-mcp.test.ts`, `tests/request-form.test.tsx`, `tests/issuer-panel.test.tsx`) no coinciden con los archivos de test reales usados (`tests/registry-service-request.test.ts`, `tests/request-form-state.test.ts`, `tests/issuer-panel-state.test.ts`). Las desviaciones están justificadas y documentadas explícitamente en `progress.md` (ausencia de jsdom/@testing-library/react en el repo; archivo MCP real sin cobertura de `createDidRequest`). No bloqueante — la cobertura funcional existe y fue confirmada leyendo los archivos reales, no los nombres listados en `tasks.json`.
- Line 112 of README.md ("`update`/`revoke` of a DID by its own controller is resolved from `ownPublicKey()`...") uses the word "controller" in the on-chain sense before the new disambiguation section appears later in the document (line 510+). A first-time reader proceeding top-to-bottom could momentarily conflate the two concepts before reaching the clarifying note. The new section itself explicitly resolves this by cross-referencing back to line 112's phrasing, so this is a minor documentation-ordering nit, not a REQ-05 violation — the explicit disambiguation exists and is unambiguous once read.

## Veredicto

**Estado**: APPROVED

Todos los 12 scenarios funcionales tienen cobertura COMPLIANT (10 vía test automatizado, 2 vía verificación manual/doc-lint explícitamente prescrita por la spec técnica para REQ-05). 0 tests failing (98/98 en scope, 273/273 en la suite completa). Las 13 tareas están `done` con todos los archivos declarados existentes y con contenido. El wiring end-to-end fue verificado por lectura directa de código en `App.tsx`, `RequestForm.tsx` e `IssuerPanel.tsx`, no asumido desde `progress.md`.

### Siguiente paso

Listo para archivar → `/sdd.finish 006-clarify-did-controller-metadata` o `/sdd.archive 006-clarify-did-controller-metadata`
