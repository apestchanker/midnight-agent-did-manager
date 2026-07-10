# Meta: Clarify DID `controller` as Informative Metadata, Separate from `subjectWalletAddress`

## Identificación
- **ID**: 006
- **Slug**: 006-clarify-did-controller-metadata
- **Tipo**: fix
- **Estado**: verifying

## Resumen
Separa el campo `controller` del DID Document (metadata W3C declarativa) del campo `subjectWalletAddress` (subject binding del agente), default-poblando `controller` desde la wallet humana conectada y documentando explícitamente que la autorización real está gobernada on-chain por posesión de capability tokens, no por este campo.

## Stack detectado
- **Lenguaje**: TypeScript / JavaScript (ESM), Node.js, React 18
- **Framework**: Vite (frontend) + Node.js HTTP server (server/index.js) + MCP server (server/mcp-*.js)
- **Test runner**: vitest — `npm test`
- **Linter**: eslint — `npm run lint`

## Git
- **Branch**: fix/clarify-did-controller-metadata
- **Base branch**: main

## Artefactos
- [x] 1-functional/spec.md
- [x] 2-technical/spec.md
- [x] 3-tasks/tasks.json
- [x] 4-implementation/progress.md
- [x] 5-verify/report.md

## Fechas
- **Creada**: 2026-07-10
- **Última actualización**: 2026-07-10 (sdd-verifier: veredicto APPROVED. Spec Compliance Matrix 100% — 12/12 scenarios COMPLIANT (10 vía test automatizado cruzado contra los archivos de test reales, 2 vía verificación manual/doc-lint de REQ-05 per la propia spec técnica). 13/13 tasks done con archivos confirmados en disco. Wiring end-to-end verificado por lectura directa de `App.tsx`/`RequestForm.tsx`/`IssuerPanel.tsx`. Test suite: 98/98 en scope, 273/273 full suite, 0 failing. Ver `5-verify/report.md` para el detalle completo.)
- **Completada**: —

## Notas
- Hoy un único input UI ("Agent Wallet Address") en `RequestForm.tsx`/`IssuerPanel.tsx` alimenta simultáneamente `subjectWalletAddress` (subject binding del agente) y `controller` del DID Document (metadata declarativa W3C). Esto es confuso y potencialmente engañoso: alguien leyendo el DID Document puede asumir que `controller` gobierna autorización, cuando la autorización real vive on-chain (`did_controller` map + `did_token_color` + `consumeToken`, ya implementado y ya documentado en README).
- `src/types/did.ts` no tiene hoy ningún campo `controller` explícito en `DidRecord`/`RequestDidInput`/`IssueDidInput`/`UpdateDidInput`/`RevokeDidInput` — solo `subjectWalletAddress?`. Hay que agregarlo.
- Existen HOY tres fuentes divergentes de `controller`:
  1. `src/lib/did/request-document.js:13` (MCP flow) — deriva de `subject_wallet_address`.
  2. `server/registry-service.js:1698` dentro de `resolveDid()` — self-referential, usa `record.did` como su propio controller.
  3. UI (`RequestForm.tsx`/`IssuerPanel.tsx`) — deriva de `agentAddress`/`subjectWalletAddress` vía el mismo input.
  Esta feature agrega una CUARTA fuente (el nuevo campo explícito `controller`, poblado desde la wallet humana conectada) si no se unifica `resolveDid()`. La propuesta recomienda unificar `resolveDid()` para leer el `controller` explícito guardado, evitando agravar la divergencia — ver sección Approach de `proposal.md`.
- El contrato Compact (`contracts/did_registry.compact` / `.template`) NO se toca — su modelo de controller on-chain (`did_controller: Map<Bytes<32>, ZswapCoinPublicKey>` vía `ownPublicKey()`) es independiente del `controller` del JSON DID Document off-chain y ya es correcto.
- `server/schema.sql` usa el patrón `alter table ... add column if not exists` para migraciones idempotentes (líneas 136-139) — agregar `controller` como columna nueva en `did_requests` y `did_records` es consistente con esa convención existente.
- README.md ya documenta extensamente el modelo real de autorización basado en tokens (`### On-chain`, línea ~380, y `## Coin-Gated Authorization (v0.9)`, línea ~660) — falta solamente una aclaración específica sobre el campo `controller` del DID Document JSON.
- Feature relacionada pero NO bloqueante: `sdd/wip/005-coin-gated-admin-access` (autorización on-chain vía coin-gated tokens) — esta feature consume esa base ya implementada, no la modifica.
- **Gaps de test infra detectados al planear tasks.json (relevante para sdd-implementer en tasks 8, 9 y 12)**:
  1. El proyecto NO tiene entorno de test de componentes React configurado (sin `jsdom`, sin `@testing-library/react`, sin ningún `.test.tsx` existente). Las tasks 8 (`RequestForm.tsx`) y 9 (`IssuerPanel.tsx`) requieren tests unitarios per technical spec (REQ-01 S02, ADR-003) — el implementer deberá agregar el entorno de testing de componentes, o extraer la lógica pura de default/independencia de estado a un helper testeable sin render, lo que sea más simple.
  2. NO existe un harness de test contra Postgres real en este repo — todos los tests de `server/registry-service.js` (`tests/registry-service-*.test.ts`) mockean `server/db.js` (`query`/`withTransaction`). La técnical spec llama "integration tests... real/test Postgres" a los 3 escenarios de ciclo completo (REQ-01/03/04) — la task 12 (`tests/did-controller-lifecycle.test.ts`) sigue en cambio el patrón de mocked-DB multi-función ya usado en el repo, no una conexión real a Postgres.
- **Task 13 step 5 (wording grep) — hallazgos explícitos**: `grep -n -i controller README.md` y sobre los componentes UI tocados encontró:
  1. `README.md:112` — "`update`/`revoke` of a DID by its own controller is resolved from `ownPublicKey()` plus the DID's linked capability-token color" — esto es sobre el mapa ON-CHAIN `did_controller: Map<Bytes<32>, ZswapCoinPublicKey>` (keyed vía `ownPublicKey()`), un mecanismo pre-existente y correcto, DISTINTO del campo `controller` del DID Document JSON off-chain que esta feature aclara. No se modificó — está fuera de scope (functional spec Out-of-Scope: "Any change to the on-chain Compact contract's controller model... is already correct and is not touched by this feature") y no hace ninguna afirmación sobre el campo JSON `controller`.
  2. `src/App.tsx` líneas 1080/2265/2267 — sidebar item `{ id: "owner-vault", label: "Controller", ... }`, título de sección "Registry Controller", y texto "Inspect the v2 controller-bound registry state" — también refieren al modelo de ownership/controller-binding ON-CHAIN del contrato (`OwnerVaultPanel`), no al campo `controller` del DID Document. Sin relación con REQ-05, no tocado.
  3. Ningún otro hit de `controller` cerca de "authorized"/"permission"/"can update"/"can revoke" implica que el campo `controller` del DID Document gobierna autorización — la única instancia previa de wording ambiguo (`src/components/IssuerPanel.tsx`, nota bajo el nuevo input de Controller: "authorized by on-chain roles bound to the connected wallet controller") fue identificada y corregida en task 11 (ver progress.md).
