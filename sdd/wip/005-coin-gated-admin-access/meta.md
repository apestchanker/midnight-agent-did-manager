# Meta: Coin-Gated Admin Access — Eliminate Forgeable ownPublicKey() Authorization

## Identificación
- **ID**: 005
- **Slug**: 005-coin-gated-admin-access
- **Tipo**: fix
- **Estado**: verifying (verify run 2026-07-09: APPROVED tras re-verificación — ver 5-verify/report.md, sección "Re-verification")

## Resumen
Reemplaza el control de acceso ADMIN/ISSUER de `did_registry.compact`, basado en `ownPublicKey()` forgeable, por autorización rooteada en posesión/consumo de un shielded coin de admin — sin introducir ningún secreto de larga duración.

## Stack detectado
- **Lenguaje**: TypeScript / JavaScript (Node.js ESM, TypeScript ~5.2.2, React 18.2) + Compact (`pragma language_version >= 0.23 && <= 0.23`)
- **Framework**: Vite (frontend), Node.js HTTP server (backend `server/`), MCP (agent tooling)
- **Test runner**: vitest — `npm test` (`vitest run`)
- **Linter**: eslint — `npm run lint`

## Git
- **Branch**: fix/coin-gated-admin-access
- **Base branch**: main

## Artefactos
- [x] 1-functional/spec.md
- [x] 2-technical/spec.md
- [x] 3-tasks/tasks.json
- [x] 4-implementation/progress.md
- [x] 5-verify/report.md (`/sdd.verify` run 2026-07-09 — CONDITIONAL inicial, 100% spec compliance, 1 undocumented dead-code finding: `agentRole()`; re-verificación 2026-07-09 tras eliminar `agentRole()` sin callers → **APPROVED**, Dead Code Audit 6/6 LIMPIO)

## Fechas
- **Creada**: 2026-07-09
- **Última actualización**: 2026-07-09 (15/15 tasks done — build, tests, full ZK contract compile, and legacy-reference grep sweep all green; see 4-implementation/progress.md)
- **Completada**: 2026-07-09

## Notas
- **Vulnerabilidad confirmada**: `ownPublicKey()` no está criptográficamente ligado al firmante real de la transacción (confirmado vía inspección de código fuente del compilador/runtime/ledger de Compact + PoC empírico). El contrato actual usa `ownPublicKey()` en `assertRole`, `register_initial_admin` e `issue_did` como única barrera de autorización ADMIN/ISSUER.
- **Restricción explícita y no negociable del usuario**: cero autenticación basada en secretos de larga duración. El patrón estándar de Compact `witness local_secret_key() + persistentHash` fue rechazado explícitamente. El propio README (línea 315) todavía menciona un "owner witness secret" residual de un intento previo descartado — no debe reintroducirse ni en contrato ni en documentación.
- **Fuente real a editar**: `contracts/did_registry.compact` se GENERA desde `contracts/did_registry.compact.template` vía `scripts/compile-contract.js` (reemplaza `__CONTRACT_VERSION__`). Todo el trabajo de contrato va en el `.template`.
- **Estado actual del contrato** (confirmado por exploración): `constructor(salt: Bytes<32>)` solo setea `registry_salt`/`admin_registered`/`total_active_dids`, sin mint de admin token; `register_initial_admin()` gateado solo por `ownPublicKey()`; `mint_capability_tokens` usa `assertRole(adminRole())`; `issue_did` usa chequeo inline `is_admin || is_issuer` sin `assertRole` ni consumo de token; no existe `rotate_admin_tokens` ni comparación `coin.color` vs `did_token_color` en `request_update_did`.
- **Diseño ya acordado con el usuario** (detallar implementación, no re-derivar):
  1. `constructor` mintea el admin token génesis atómicamente (reemplaza el bootstrap en dos pasos actual).
  2. Nuevo helper `consumeAdminToken()` reemplaza `assertRole(adminRole())` en `mint_capability_tokens`, `issue_did`, `grant_role`, `revoke_role`, `revoke_did`. Rol ISSUER se elimina y se fusiona con ADMIN.
  3. Nuevo circuit `rotate_admin_tokens` para reemplazo/delegación per-holder atómica (burn-then-remint en una sola tx; explícitamente NO modelo de "supply global a cero" por riesgo de lockout permanente).
  4. `request_update_did` gana un assert `coin.color == did_token_color.lookup(did_key)`.
- **Impacto en cascada**: `src/lib/registry/unified-registry-api.ts` (`deploy()` línea 110-118 y métodos `registerInitialAdmin`/`grantRole`/`revokeRole`/`revokeDid`/`issueDid`), `scripts/compile-contract.js` (lista `CIRCUITS` líneas 33-41 — agregar `rotate_admin_tokens`, evaluar remoción de `register_initial_admin`), y `README.md` (requiere reescritura sustancial, ver Scope de la propuesta).
- **Cambio de scope (2026-07-09)**: el usuario aprobó la propuesta con UNA modificación — el código legacy/huérfano y los 5 test files pre-unificación pasan de "Out of Scope" a "In Scope" (se ELIMINAN en esta misma iteración, no quedan flaggeados para después). Detalle:
  - `src/lib/did/api.ts` (clase `DidRegistryAPI`) se elimina completa.
  - `src/lib/did/app-api.ts`: se eliminan `deployDidRegistry`, `updateDidOrchestrated`, `revokeDidOrchestrated`; se mantienen `compileDidRegistry`, `deployUnifiedRegistry`, `requestDidWithSync`, `issueDidWithSync`, `updateDidWithSync`, `revokeDidWithSync`, `getTokenBalance` y los sync helpers (`mergeDidMetadata`, `syncWallet*Storage`) — confirmados vivos vía `src/App.tsx` y `src/hooks/useDeployFlow.ts`.
  - **Hallazgo vía Grep** (no asumido, verificado): `src/lib/didContract.ts` SÍ tiene otros usos — `src/App.tsx` importa `getSavedContractAddress`/`getSavedDeployment` y `src/components/OwnerVaultPanel.tsx` importa `getOwnerVaultStatus` desde ahí. Pero esos 3 exports son simples re-exports de `./did/cache`/`./did/vault`, sin relación con `DidRegistryAPI`. Resolución: se elimina `didContract.ts` completo y se repuntan esos 2 call sites a importar directo desde `./lib/did/cache` / `./lib/did/vault`. Todos los demás exports de `didContract.ts` (el re-export de `DidRegistryAPI`, `deployDidRegistry`, `requestDid`, `issueDid`, `updateDid`, `revokeDid`, `fetchDidRecord`, `fetchRegistrySummary`, `fetchRegistryAccess`) no tienen callers vivos.
  - Follow-on mecánico obligatorio al borrar `api.ts`: en `app-api.ts` remover `import { DidRegistryAPI } from "./api"` y angostar `type AnyRegistryAPI = DidRegistryAPI | UnifiedRegistryAPI` a solo `UnifiedRegistryAPI`.
  - Se eliminan los 5 test files pre-unificación: `src/tests/did-registry-gated.test.ts`, `token-gating.test.ts`, `token-gating-integration.test.ts`, `token-subscription.test.ts`, `token-api-layer.test.ts`. No se reescriben — el usuario pidió eliminarlos, no portarlos, ya que ejercitan una arquitectura (`self_register_did`/`register_initial_admin`/`ownPublicKey()`) que deja de existir.
  - Ver `proposal.md` (Scope, Affected Areas, Risks, Success Criteria) para el detalle actualizado.
- **Technical spec escrita (2026-07-09)** — ver `2-technical/spec.md`. 5 ADRs. Constructor final: `constructor(salt: Bytes<32>, admin_recipient: ZswapCoinPublicKey, admin_coin_nonce: Bytes<32>, admin_supply: Uint<64>)`. Nuevo ledger `admin_token_color: Bytes<32>`. Nuevo helper interno `consumeAdminToken()` (clona `consumeToken()`, comparte `used_capability_nullifiers`). Nuevo circuit `rotate_admin_tokens`. `issuerRole()` y `register_initial_admin()` eliminados.
- **OPEN QUESTION bloqueante — máxima prioridad para `/sdd.plan` (debe ser Task 0)**: si `kernel.self()` / `tokenType(domainSep, kernel.self())` son legales dentro de un `constructor(...)`. NO confundir con `mintShieldedToken()` en constructor, que SÍ está confirmado empíricamente (PoC previo). Lo no verificado es específicamente `kernel.self()` dentro del constructor. Verificar vía `/midnight-verify:verify` antes de escribir código. Fallback si falla: mover el cálculo de `admin_token_color` a un circuit interno separado, invocado por la primera tx admin-gateada post-deploy (peor UX, no bloqueante de diseño). Detalle completo en `2-technical/spec.md` ADR-003.

- **Feature completa (2026-07-09)** — las 15 tasks de `tasks.json` están `done`. Resumen de
  lo implementado en tasks 12-15 (ver `4-implementation/progress.md` para el detalle
  completo): `src/lib/did/api.ts` y `src/lib/didContract.ts` eliminados junto con sus
  callers muertos en `app-api.ts`/`App.tsx`/`OwnerVaultPanel.tsx`; `README.md` reescrito
  (On-chain, Coin-Gated Authorization v0.9 — reemplaza Controller Model v2 + Token Gating
  v0.8 —, Release Notes v0.9.0, Contract Directory Notes, mención de "owner witness
  secret" removida); gate final ejecutado y verde: `npm run build` exit 0, `npm test`
  27/222/0, `npm run compile-contract` (pipeline ZK real, sin `--skip-zk`) exit 0, grep de
  legacy sin referencias rotas.
- **Corrección de instrucción desactualizada detectada en Task 14**: la invocación del
  orquestador para Task 14 afirmaba que `rotate_admin_tokens` tiene una firma fija de 3
  parámetros (remint de 2 unidades, no configurable) como "vigente". Se verificó contra
  el código real (`contracts/did_registry.compact.template`) y contra
  `2-technical/spec.md` (que ya incluye un bloque "Post-implementation correction"
  documentando la reconciliación) que la firma real y actualmente compilada/testeada es
  de **4 parámetros** — `(coin, new_recipient, new_coin_nonce, new_supply: Uint<64>)` —
  con remint configurable. El README se escribió reflejando el estado real verificado, no
  la instrucción desactualizada. Ver `4-implementation/progress.md` para el detalle
  completo de la verificación.
- **Hallazgo fuera de scope, no corregido, flaggeado vía background task**:
  `src/lib/token/token-gating-api.ts` (`TokenGatingAPI`) no tiene ningún caller vivo en
  todo el repo — huérfano de la misma naturaleza que `src/lib/did/api.ts` (Task 12), pero
  no estaba en el scope de esta feature. También queda sin corregir la descripción del
  flujo de deploy de 3 pasos ("Deploy Token Gating" como paso separado) en la sección
  Development de `README.md` — deuda de documentación preexistente a esta feature, de la
  unificación v3 anterior.
- **Próximo paso recomendado**: `/sdd.verify 005-coin-gated-admin-access` (no se generó un
  `5-verify/report.md` formal en esta invocación — Task 15 ejecutó un gate equivalente
  inline, documentado en `progress.md`) y luego `/sdd.git` / `/sdd.archive` si el usuario
  quiere completar la ceremonia SDD completa.
- **Re-verificación (2026-07-09)**: el orquestador aplicó directamente el fix sugerido en
  el único hallazgo bloqueante del `report.md` — se eliminó el bloque
  `pure circuit agentRole(): Bytes<32> { return pad(32, "AGENT"); }` de
  `contracts/did_registry.compact.template` (único símbolo del bloque de pure circuits de
  roles sin ningún caller real; `adminRole()`/`userRole()` sí tienen callers y se
  mantienen intactos). Post-fix se re-corrió `sdd-verifier` de forma independiente:
  `grep agentRole` → 0 matches en template y en `.compact` generado; render del template
  vs `.compact` en disco → diff vacío (cero drift); `npm test` → 27/222/0 (re-ejecutado,
  no solo tomado del report del orquestador); `npx tsc --noEmit` → exit 0; `npx eslint`
  sobre los 4 archivos tocados por la migración → exit 0. Dead Code Audit re-corrido
  completo: 6/6 ítems LIMPIO (el ítem 5, `TokenGatingAPI` huérfano, sigue explícitamente
  fuera de scope con tracking separado vía `task_6a2fcbaf`, sin contar contra el
  veredicto). **Veredicto final: APPROVED.** Detalle completo en
  `5-verify/report.md`, sección "Re-verification (2026-07-09)".
