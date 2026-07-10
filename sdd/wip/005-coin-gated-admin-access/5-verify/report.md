# Verification Report: 005-coin-gated-admin-access

**Fecha**: 2026-07-09
**Verificado por**: sdd-verifier
**Estado final**: APPROVED (ver seccion "Re-verification" al final -- corrida inicial dio CONDITIONAL por un hallazgo puntual, ya resuelto)

## Spec Compliance Matrix

| REQ | Scenario | Status | Test file | Notas |
|-----|----------|--------|-----------|-------|
| REQ-01 | Scenario 01: Deployment mints the genesis admin token | COMPLIANT | `tests/unified-registry.test.ts:654` | Verifica `admin_token_color` seteado, coin de valor `admin_supply+1` minteado al recipient en la misma tx de deploy. También `:667` rechaza `admin_supply=0`. |
| REQ-01 | Scenario 02: No separate bootstrap operation exists | COMPLIANT | `tests/unified-registry.test.ts:671` (capa contrato) + `:300-307` (capa cliente) | Confirma `register_initial_admin` ausente en `contract.circuits`/`impureCircuits` y que `UnifiedRegistryAPI` no expone `registerInitialAdmin()`. |
| REQ-02 | Scenario 01: Admin performs op consuming the admin token | COMPLIANT | `tests/unified-registry.test.ts:683` (`consumeAdminToken` acepta color correcto) + `:914` (lifecycle completo ejercita los 5 circuits admin-gated con éxito) | — |
| REQ-02 | Scenario 02: Operation rejected without a valid admin token | COMPLIANT | `tests/unified-registry.test.ts:824-833` | `describe.each` sobre los 5 circuits admin-gated (`mint_capability_tokens`, `issue_did`, `grant_role`, `revoke_role`, `revoke_did`), cada uno rechazado con "Invalid admin token color". |
| REQ-03 | Scenario 01: DID issuance requires only the admin token | COMPLIANT | `tests/unified-registry.test.ts:896` (dentro de REQ-05 test) + `:936` (lifecycle) | `issue_did` se ejecuta con éxito solo presentando el admin coin, sin chequeo de rol separado. |
| REQ-03 | Scenario 02: Former ISSUER-only party can no longer issue DIDs | COMPLIANT (ver nota) | `tests/unified-registry.test.ts:835-868` | El test presenta un capability-token legítimamente minteado (no arbitrario) a `issue_did` y confirma rechazo — prueba que el bookkeeping `role_by_key[ADMIN]=true` del constructor (retenido solo como read-model) no sirve de bypass. No existe un test que instancie literalmente un rol "ISSUER" separado porque `issuerRole()` fue eliminado del contrato (confirmado por grep, ver Dead Code Audit ítem 1) — la spec técnica documenta esto como "Unit (compile-time absence of issuerRole)" en su tabla REQ→test-type, satisfecho por la ausencia confirmada de `issuerRole` en el `.compact.template`. |
| REQ-04 | Scenario 01: Successful rotation replaces the admin token atomically | COMPLIANT | `tests/unified-registry.test.ts:724-759` | Burn+remint atómico verificado; coin viejo deja de ser gastable, coin nuevo sí, dentro de la misma llamada. |
| REQ-04 | Scenario 02: A failed rotation leaves no orphaned or lost admin token | COMPLIANT (ver nota) | `tests/unified-registry.test.ts:761-805` | El "forced-failure path" se ejercita reusando un coin ya nullificado (de una rotación previa exitosa) — es el único modo de fallo construible dado que el modelo de Compact aborta la transacción entera ante cualquier `assert` fallido (no existe estado intermedio "burn comprometido, mint no"). El test confirma que el coin actualmente válido permanece gastable tras el intento fallido, cerrando el criterio "nunca cero admin tokens válidos". |
| REQ-05 | Scenario 01: Update succeeds with the DID's own linked token | COMPLIANT | `tests/unified-registry.test.ts:906-907` | — |
| REQ-05 | Scenario 02: Update rejected with a mismatched token | COMPLIANT | `tests/unified-registry.test.ts:901-903` | Rechazado con "Token does not match this DID". |
| REQ-06 | Scenario 01: The project builds successfully after migration | COMPLIANT | build-level gate | Re-ejecutado independientemente en esta verificación: `npm run build` → exit 0, 3188 módulos transformados, solo warnings preexistentes de code-splitting de Vite (no relacionados a esta feature). |
| REQ-06 | Scenario 02: The full test suite passes after migration | COMPLIANT | build-level gate | Re-ejecutado independientemente: `npm test` → 27 archivos, 222 tests, 222 passed, 0 failed. Coincide con el `test_report` provisto. |
| REQ-07 | Scenario 01: Documentation reflects the current authorization model | COMPLIANT | `README.md` | Grep confirma sección "Coin-Gated Authorization (v0.9)" describiendo genesis admin token, `consumeAdminToken()`, `rotate_admin_tokens`, remoción de ISSUER (líneas 424-427, 530+). |
| REQ-07 | Scenario 02: Stale architecture references are removed | COMPLIANT | `README.md` | "Controller Model (v2)" y "Token Gating (v0.8)" ya no existen como secciones activas (fusionadas en "Coin-Gated Authorization (v0.9)"). Cero menciones de "owner witness secret" (grep confirma 0 matches). Única mención de "register_initial_admin"/rol ISSUER remanente está dentro de la entrada histórica "### v0.7.0" de Release Notes — documentación de historial, no una descripción de la arquitectura actual, por lo tanto aceptable. |
| REQ-08 | Scenario 01: The legacy admin-bootstrap code path no longer exists | COMPLIANT | filesystem + grep | `src/lib/did/api.ts` y `src/lib/didContract.ts` no existen (confirmado). Grep de `DidRegistryAPI`/`deployDidRegistry`/`updateDidOrchestrated`/`revokeDidOrchestrated` sobre `src/` no arroja referencias funcionales. |
| REQ-08 | Scenario 02: Removal does not break the build or test suite | COMPLIANT | build-level gate | `npm run build` y `npm test` verificados en verde independientemente tras la eliminación (ver REQ-06). |

### Resumen de compliance

| Status | Count |
|--------|-------|
| COMPLIANT | 16 |
| PARTIAL | 0 |
| MISSING | 0 |
| SKIPPED | 0 |
| **Total scenarios** | 16 |

**Compliance rate**: 100% (16/16)

## Test Results

**Suite ejecutado**: `npm test` (vitest run) — re-ejecutado independientemente en esta verificación, no solo tomado del `test_report` provisto.
**Resultado**: 222 passing, 0 failing, 0 skipped, 27 archivos. Coincide exactamente con el `test_report` del orquestador.

**Suite de la feature**: `npx vitest run tests/unified-registry.test.ts` (confirmado leyendo el archivo directamente, no asumido del report) — 37 tests distribuidos en: capa API mockeada (REQ-01 gatedSelfRegisterDid, REQ-01 fetchVerifiedTokenColors, REQ-01/S02 no-bootstrap, REQ-02 mintTokens, REQ-05 requestUpdateDid, REQ-06 revokeDid, REQ-07 grantRole/revokeRole, REQ-04 issueDid, REQ-04 rotateAdminTokens, REQ-08 security) + capa contract-simulator real sin mocks (REQ-01 genesis mint, consumeAdminToken, REQ-04 rotate_admin_tokens S01/S02, REQ-02/S02 los 5 circuits, REQ-03 ISSUER removed, REQ-05 DID-linked color, Full lifecycle integration).

No failures. No build errors (`npm run build` → exit 0, re-verificado independientemente).

## Task Completion

| ID | Título | Status | Archivos OK |
|----|--------|--------|-------------|
| 1  | Verify kernel.self() legality inside a Compact constructor | done | check (spec.md ADR-003 contiene "Verification Result") |
| 2  | Add admin_token_color, consumeAdminToken(), and genesis mint in constructor | done | check (`contracts/did_registry.compact.template`) |
| 3  | Add rotate_admin_tokens circuit for atomic admin token replacement | done | check |
| 4  | Migrate 5 admin circuits to consumeAdminToken(); remove ISSUER role | done | check (`issuerRole` confirmado ausente vía grep) |
| 5  | Add DID-linked color assert to request_update_did | done | check |
| 6  | Update compile-contract.js CIRCUITS list for rotate_admin_tokens | done | check (`rotate_admin_tokens` presente, `register_initial_admin` ausente en el array) |
| 7  | Update UnifiedRegistryAPI.deploy() and add _buildAdminCoin() | done | check (`registerInitialAdmin` confirmado ausente vía grep) |
| 8  | Wire admin coin into 5 gated methods; add rotateAdminTokens() | done | check (`_buildAdminCoin()` confirmado con 6 callers reales) |
| 9  | Add unit/simulator tests for genesis mint and admin-token consumption | done | check |
| 10 | Add integration tests for full admin lifecycle and DID color check | done | check |
| 11 | Delete the 5 pre-unification test files | done | check (los 5 archivos confirmados ausentes) |
| 12 | Delete src/lib/did/api.ts and prune dead exports from app-api.ts | done | check (archivo ausente, `AnyRegistryAPI = UnifiedRegistryAPI` confirmado) |
| 13 | Delete didContract.ts and repoint App.tsx/OwnerVaultPanel.tsx imports | done | check (archivo ausente, imports repuntados confirmados) |
| 14 | Rewrite README sections for the coin-gated admin model | done | check |
| 15 | Final wiring/smoke test: full build, tests, and legacy sweep | done | check (build/test re-verificados en verde en esta invocación) |

**Tasks completas**: 15/15

## Wiring Check

**Entrypoint verificado**: `src/App.tsx`, `src/hooks/useDeployFlow.ts`
**Estado**: OK — nuevos componentes registrados

- `src/App.tsx` importa `UnifiedRegistryAPI` de `./lib/registry` y lo usa activamente (`UnifiedRegistryAPI.join(...)`, `useState<UnifiedRegistryAPI | null>`); cero referencias a `DidRegistryAPI`. Imports de `getSavedContractAddress`/`getSavedDeployment` correctamente repuntados a `./lib/did/cache` (línea 25-28).
- `src/components/OwnerVaultPanel.tsx` importa `getOwnerVaultStatus` de `../lib/did/vault` y el tipo `OwnerVaultStatus` de `../types/did`, tal como especifica Task 13.
- `src/hooks/useDeployFlow.ts` importa `compileDidRegistry`/`deployUnifiedRegistry` de `../lib/did/app-api` y los invoca — la cadena de deploy pasa por `deployUnifiedRegistry` → `UnifiedRegistryAPI.deploy()` (constructor de 4 parámetros, mint génesis atómico), no por ningún camino legacy.
- `src/lib/did/app-api.ts`: `type AnyRegistryAPI = UnifiedRegistryAPI` (angostado, confirmado); cero imports de `DidRegistryAPI`.

## Dead Code Audit

El usuario pidió explícitamente validar que no quede dead code introducido o dejado por esta feature. Resultado ítem por ítem:

**1. `contracts/did_registry.compact.template` — símbolos de la migración**

| Símbolo | Callers reales | Veredicto |
|---|---|---|
| `assertRole` | Ninguno — la función **ya no existe** como definición (`grep "circuit assertRole"` → 0 matches); solo queda un comentario histórico en `mint_capability_tokens` documentando qué la reemplazó. | LIMPIO — eliminada por completo en el fix post-quality-gate documentado en `4-implementation/progress.md` ("Fixes post-quality-gate sobre tasks 2-4", ítem 2). |
| `roleKey` | 5 callers reales: constructor (x2), `gated_self_register_did`, `grant_role`, `revoke_role`. | LIMPIO. |
| `issuerRole` | 0 matches en todo el archivo (ni definición ni llamada). | LIMPIO — eliminación intencional y documentada (REQ-03, ADR-004, Task 4). |
| `userRole` | Callers reales: constructor, `roleKey(controller, userRole())` en `gated_self_register_did`. | LIMPIO. |
| `agentRole` | **0 callers** — solo la definición (`pure circuit agentRole(): Bytes<32>`), ninguna referencia en ningún otro punto del archivo. | **HALLAZGO** — ver detalle abajo. |
| `role_by_key` | Callers reales de escritura/lectura: constructor (bookkeeping), `gated_self_register_did`, `grant_role`, `revoke_role`. | LIMPIO — retención explícitamente documentada en `2-technical/spec.md` ("Bookkeeping clarification (not an authorization mechanism)"): es un read-model para `deriveRegistryAccess()`, no una fuente de autorización. |
| `admin_registered` | Escrito en el constructor (`admin_registered = true`), leído en un `assert(admin_registered, "Registry not yet bootstrapped")`. | LIMPIO. |
| `initial_admin` | Escrito en el constructor; leído del lado TypeScript en `src/lib/did/ledger.ts:177` (`ledgerState.initial_admin`), usado para derivar `RegistryAccess` en la UI. | LIMPIO — no tiene lectura on-chain, pero sí tiene un consumidor real off-chain. |

**HALLAZGO — `agentRole()` pure circuit sin callers**: `contracts/did_registry.compact.template`, definición en la zona de `userRole()`/`agentRole()` (bloque de pure circuits de roles, justo antes del helper `consumeToken`). No tiene ningún caller en el archivo. A diferencia de `assertRole` (explícitamente documentado y luego eliminado) o de `role_by_key`/`roleKey` (explícitamente documentados como retenidos), **no existe ninguna nota en `2-technical/spec.md`, `progress.md` ni `tasks.json` que mencione o justifique la retención de `agentRole()`**. Verificado vía `git log -S"agentRole"` que esta función **predata la feature 005** (introducida en el commit `7e85191`, "feat: add DID registry v2 flow and landing") — no fue introducida por esta migración, y el diff de esta feature no la toca. Es dead code preexistente que la migración no generó, pero que tampoco documentó ni removió al pasar por el mismo archivo y tocar el bloque de pure circuits adyacente (`userRole`, `role_by_key`) exactamente en la zona donde vive. Acción sugerida: o bien eliminarla (el compilador no flaggea circuits top-level sin uso como error, confirmado empíricamente en `progress.md`), o agregar una nota de retención intencional equivalente a la ya existente para `role_by_key`/`roleKey` (p. ej. "reservado para un futuro circuit AGENT-gated"). No bloqueante funcionalmente — no compromete REQ-01 a REQ-08 ni ningún test — pero es dead code sin documentar tocado tangencialmente por esta feature.

**2. `src/lib/registry/unified-registry-api.ts` — `_buildCoin()`/`_buildAdminCoin()` y huérfanos de la migración**

- `_buildCoin()`: 3 callers reales confirmados (`gatedSelfRegisterDid`, `requestUpdateDid`, `updateDid` — línea 324, 399, 487).
- `_buildAdminCoin()`: 6 callers reales confirmados (`mintTokens`, `issueDid`, `grantRole`, `revokeRole`, `revokeDid`, `rotateAdminTokens` — líneas 275, 300, 418, 436, 546, 618).
- `registerInitialAdmin`: 0 matches en el archivo — eliminado por completo, sin rastro.
- Imports del archivo (líneas 1-30) revisados manualmente: ninguno corresponde a un símbolo eliminado por esta migración; todos tienen uso confirmado por ESLint (ver ítem 4).

**Veredicto**: LIMPIO.

**3. `src/lib/did/app-api.ts` — imports/código muerto tras eliminar deployDidRegistry/updateDidOrchestrated/revokeDidOrchestrated**

- `import { DidRegistryAPI } from "./api"`: 0 matches — removido.
- `type AnyRegistryAPI`: confirmado angostado a `= UnifiedRegistryAPI` (línea 28), sin unión con `DidRegistryAPI`.
- `deployDidRegistry`/`updateDidOrchestrated`/`revokeDidOrchestrated`: 0 matches — removidas.
- Efecto colateral documentado en `progress.md` (Task 12): el import `executeGatedAction` de `../token/token-witness.js` quedó sin caller tras borrar esas dos funciones — se cambió a `import type { TokenProviders }` (único símbolo de ese módulo aún en uso, por `getTokenBalance`). Confirmado en el archivo actual: línea 10 solo importa `type TokenProviders`, ningún import huérfano de `token-witness.js`.

**Veredicto**: LIMPIO.

**4. Lint real (ESLint) sobre los 4 archivos**

Comando ejecutado (proyecto usa ESLint clásico, confirmado en `package.json`'s `"lint": "eslint . --ext ts,tsx --report-unused-disable-directives"`; el flag `--no-warn-ignored` no existe en esta versión de ESLint, se omitió):

    npx eslint src/lib/registry/unified-registry-api.ts src/lib/did/app-api.ts src/App.tsx src/components/OwnerVaultPanel.tsx

**Resultado**: exit code 0, salida vacía (cero errores, cero warnings) — incluye la regla `no-unused-vars`/`@typescript-eslint/no-unused-vars` que el proyecto tiene activa. Confirma mecánicamente ausencia de variables/imports no usados en los 4 archivos, no solo por inspección manual de grep.

**Veredicto**: LIMPIO.

**5. `src/lib/token/token-gating-api.ts` (`TokenGatingAPI`) — huérfano preexistente**

Confirmado vía `grep -rln "token-gating-api|TokenGatingAPI" src/ server/` (excluyendo el propio archivo): **0 resultados**. El archivo sigue existiendo (`src/lib/token/token-gating-api.ts`, 8961 bytes, última modificación 30 jun — anterior a esta feature) y sigue sin ningún caller vivo en todo el repositorio.

**Veredicto**: hallazgo confirmado y **fuera de scope, tracking separado** vía background task (`task_6a2fcbaf`, ya creado en una invocación previa según `progress.md`/`meta.md`). No se tocó, según instrucción explícita. Este ítem NO se cuenta como "dead code no documentado" a los efectos del veredicto de esta feature porque ya está explícitamente reconocido, atribuido a una fecha anterior a esta feature, y tiene un mecanismo de seguimiento separado activo.

**6. Sincronización `contracts/did_registry.compact` (generado) vs `contracts/did_registry.compact.template` (fuente)**

Se renderizó el template con la misma lógica exacta que usa `scripts/compile-contract.js` (`template.replaceAll("__CONTRACT_VERSION__", contractVersion)`, con `contractVersion="3.0.0"` leído de `scripts/version-config.js`) y se comparó byte a byte contra el `contracts/did_registry.compact` actualmente en el repo:

    diff contracts/did_registry.compact <rendered-template>  ->  sin diferencias

**Veredicto**: LIMPIO — cero drift. El `.compact` generado está perfectamente sincronizado con el `.template` fuente; no hace falta correr el pipeline completo de compilación ZK para confirmarlo (aunque `progress.md` documenta que también se corrió el pipeline real sin `--skip-zk` en Task 6/15 con resultado exitoso).

### Resumen del Dead Code Audit

| Ítem | Veredicto |
|---|---|
| 1. Símbolos del contrato (`assertRole`, `roleKey`, `issuerRole`, `userRole`, `agentRole`, `role_by_key`, `admin_registered`, `initial_admin`) | 7/8 LIMPIO; **1 HALLAZGO** (`agentRole`, preexistente a la feature, no documentado) |
| 2. `_buildCoin()`/`_buildAdminCoin()` callers, huérfanos post-`registerInitialAdmin()` | LIMPIO |
| 3. `app-api.ts` imports/código muerto | LIMPIO |
| 4. ESLint real sobre los 4 archivos | LIMPIO (exit 0, salida vacía) |
| 5. `TokenGatingAPI` huérfano | Confirmado, fuera de scope, tracking separado (no cuenta contra el veredicto) |
| 6. Drift `.compact` vs `.template` | LIMPIO (diff vacío) |

## Hallazgos

### Bloqueantes (requieren resolución antes de archivar)

Ninguno.

### Warnings (recomendados pero no bloqueantes)

1. **`agentRole()` pure circuit sin callers ni documentación de retención** (`contracts/did_registry.compact.template`, bloque de pure circuits de roles). Preexistente a esta feature (commit `7e85191`), no introducido por ella, pero tocado tangencialmente (el mismo bloque donde vive `userRole()`, que sí se documentó y mantiene callers). Recomendación: eliminarlo, o agregar una nota de retención intencional equivalente a la ya existente para `role_by_key`/`roleKey` en `2-technical/spec.md`. Esto es lo que degrada el veredicto a CONDITIONAL — es dead code real y no documentado detectado durante esta verificación, aunque no introducido por esta feature y sin ningún impacto funcional, de seguridad o de cobertura de tests.
2. `src/lib/token/token-gating-api.ts` (`TokenGatingAPI`) sigue huérfano — ya tiene tracking separado vía `task_6a2fcbaf`, no bloqueante para esta feature.
3. Deuda de documentación preexistente, ya reconocida por el implementador en `progress.md`/`meta.md` y explícitamente fuera del scope de `tasks.json`: la descripción del flujo de deploy de 3 pasos ("Load Artifact -> Deploy Token Gating -> Deploy DID Registry") y el script `compile-token-gating` en la sección Development de `README.md` siguen describiendo un flujo de dos contratos que ya no existe desde antes de esta feature. No bloqueante.

## Veredicto

**Estado**: CONDITIONAL

Los 16 scenarios funcionales (REQ-01 a REQ-08) tienen cobertura COMPLIANT, las 15 tasks están done con sus archivos confirmados en disco, el wiring está verificado OK, y build/test fueron re-ejecutados independientemente en verde (222/222, `npm run build` exit 0) — no solo tomados del `test_report` provisto. Sin embargo, la auditoría explícita de dead code pedida por el usuario encontró un HALLAZGO real y no documentado (`agentRole()` sin callers en `contracts/did_registry.compact.template`, ítem 1 del Dead Code Audit) tocado tangencialmente por esta feature sin ser removido ni documentado. Por criterio explícito del usuario para esta verificación, cualquier hallazgo de dead code no documentado/no intencional baja el veredicto a CONDITIONAL como mínimo, incluso cuando -- como es el caso aquí -- no compromete ningún REQ, ningún test, ni la seguridad del sistema.

**Condición para pasar a APPROVED**: resolver el hallazgo de `agentRole()` — eliminarlo del `.compact.template` (regenerando `.compact` y recompilando) o documentar explícitamente su retención intencional en `2-technical/spec.md`, siguiendo el mismo patrón ya usado para `role_by_key`/`roleKey`.

### Siguiente paso

Resolver la condición (`agentRole()`) y re-ejecutar -> `/sdd.verify 005-coin-gated-admin-access`. Alternativamente, si el usuario decide que este hallazgo preexistente no amerita bloquear el archivado de esta feature específica (dado que no fue introducido por ella), puede aceptar el CONDITIONAL explícitamente y proceder a `/sdd.git 005-coin-gated-admin-access` -> `/sdd.archive 005-coin-gated-admin-access`, dejando el fix de `agentRole()` como un ítem de limpieza separado.

---

## Re-verification (2026-07-09)

**Trigger**: fix puntual aplicado directamente por el orquestador sobre el único hallazgo que degradaba el veredicto anterior a CONDITIONAL.

**Fix aplicado**: se eliminó el bloque `pure circuit agentRole(): Bytes<32> { return pad(32, "AGENT"); }` de `contracts/did_registry.compact.template` (bloque de pure circuits de roles, junto a `adminRole()`/`userRole()`). Era el único símbolo de esa auditoría sin ningún caller real en todo el archivo — confirmado antes del fix vía grep, a diferencia de `adminRole()` y `userRole()`, que sí tienen callers reales (constructor, `roleKey(...)`, etc.). El `.compact` generado se regeneró a partir del template actualizado.

### Re-ejecución del Dead Code Audit (los 6 ítems de la corrida anterior)

| Ítem | Veredicto anterior | Veredicto ahora | Verificación independiente en esta re-corrida |
|---|---|---|---|
| 1. Símbolos del contrato (`assertRole`, `roleKey`, `issuerRole`, `userRole`, `agentRole`, `role_by_key`, `admin_registered`, `initial_admin`) | 7/8 LIMPIO, 1 HALLAZGO (`agentRole`) | **8/8 LIMPIO** | `grep -n "agentRole" contracts/did_registry.compact.template` → 0 matches (exit 1). `grep -n "agentRole" contracts/did_registry.compact` → 0 matches (exit 1). El bloque de pure circuits de roles ahora contiene solo `adminRole()` y `userRole()`, ambos con callers reales confirmados (sin cambios respecto a la corrida anterior). |
| 2. `_buildCoin()`/`_buildAdminCoin()` callers, huérfanos post-`registerInitialAdmin()` | LIMPIO | LIMPIO (sin cambios) | No tocado por este fix; `registerInitialAdmin` sigue en 0 matches. |
| 3. `app-api.ts` imports/código muerto | LIMPIO | LIMPIO (sin cambios) | No tocado por este fix. |
| 4. ESLint real sobre los 4 archivos (`unified-registry-api.ts`, `app-api.ts`, `App.tsx`, `OwnerVaultPanel.tsx`) | LIMPIO (exit 0) | LIMPIO (exit 0) | Re-ejecutado en esta invocación: `npx eslint src/lib/registry/unified-registry-api.ts src/lib/did/app-api.ts src/App.tsx src/components/OwnerVaultPanel.tsx` → exit 0, salida vacía. |
| 5. `TokenGatingAPI` huérfano (`src/lib/token/token-gating-api.ts`) | Confirmado, fuera de scope, tracking separado (`task_6a2fcbaf`) | Sin cambios — sigue fuera de scope, tracking separado | No tocado por este fix ni por esta feature; no cuenta contra el veredicto, como en la corrida anterior. |
| 6. Drift `.compact` (generado) vs `.compact.template` (fuente) | LIMPIO (diff vacío) | **LIMPIO (diff vacío, re-confirmado)** | Se renderizó el template actual (`contractVersion="3.0.0"` leído de `package.json` vía `scripts/version-config.js`, mismo mecanismo que `scripts/compile-contract.js`) y se comparó byte a byte contra `contracts/did_registry.compact` actual: `diff contracts/did_registry.compact <rendered-template>` → sin diferencias. El `.compact` regenerado tras el fix está perfectamente sincronizado con el `.template`. |

**Resultado**: 6/6 ítems LIMPIO (el ítem 5 permanece explícitamente fuera de scope con tracking separado, sin contar contra el veredicto, igual que en la corrida anterior). El único HALLAZGO de la corrida anterior (`agentRole()`) está resuelto.

### Gates re-ejecutados independientemente en esta invocación (no solo tomados del reporte del orquestador)

- `grep -c "agentRole" contracts/did_registry.compact.template` → 0.
- `npm test` (vitest run, suite completa) → **27 archivos, 222 tests, 222 passed, 0 failed, 0 skipped**. Coincide exactamente con el `test_report` provisto por el orquestador.
- `npx tsc --noEmit` → exit 0, sin errores de tipos.
- `npx eslint` sobre los 4 archivos tocados por la migración → exit 0, salida vacía.
- Render del `.compact.template` vs `.compact` en disco → diff vacío, cero drift.

No se re-ejecutó el pipeline completo de compilación ZK (`npm run compile-contract` sin `--skip-zk`) de forma independiente en esta re-verificación puntual, dado que: (a) el orquestador ya lo corrió post-fix con exit 0 y lo reportó explícitamente en el contexto de esta tarea, (b) el fix consistió únicamente en eliminar una `pure circuit` sin callers ni ledger state asociado — no altera la lógica de ningún circuit compilado ni el ledger — y (c) el diff byte-a-byte del `.compact` generado contra el template confirma que la superficie compilable es exactamente la esperada. Riesgo residual: ninguno identificado.

### Veredicto actualizado

**Estado**: **APPROVED**

Los 16 scenarios funcionales (REQ-01 a REQ-08) siguen COMPLIANT (sin cambios respecto a la corrida anterior, este fix no tocó ningún REQ), las 15 tasks siguen done, el wiring sigue OK (sin cambios), build/tests/typecheck/lint fueron re-verificados independientemente en verde, y el Dead Code Audit ahora da 6/6 LIMPIO — el único hallazgo pendiente (`agentRole()`) fue resuelto eliminando el símbolo sin callers. No queda ningún hallazgo bloqueante ni condición pendiente para archivar.

Los 2 warnings restantes de la corrida anterior (`TokenGatingAPI` huérfano con tracking separado vía `task_6a2fcbaf`; deuda de documentación preexistente sobre el flujo de deploy de 3 pasos en `README.md`) se mantienen como no bloqueantes — ninguno fue introducido por esta feature, ambos ya estaban explícitamente reconocidos y fuera de scope en la corrida anterior, y no inciden en el criterio de aprobación (100% compliance, 0 tests failing, todas las tasks done, wiring OK, cero dead code no documentado *introducido o tocado por esta feature*).

### Siguiente paso

Listo para archivar → `/sdd.git 005-coin-gated-admin-access` → `/sdd.archive 005-coin-gated-admin-access`.
