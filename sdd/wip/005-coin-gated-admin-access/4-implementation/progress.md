# Implementation Progress: 005-coin-gated-admin-access

**Última actualización**: 2026-07-09
**Estado**: complete (15/15 tasks done)

## Tasks

| ID | Título | Estado | Tests | Notas |
|----|--------|--------|-------|-------|
| 1  | Verify kernel.self() legality inside a Compact constructor | done | n/a (pure verification task) | **CONFIRMADO**: `kernel.self()` y `tokenType(domainSep, kernel.self())` son legales y funcionales dentro de un `constructor(...)`. Spike compilado con `compact compile --skip-zk` (compiler v0.31.1, exit 0) y ejecutado vía `@midnight-ntwrk/compact-runtime`: el color calculado en el constructor y guardado en el ledger coincide byte-a-byte con el color del output Zswap real minteado en la misma llamada al constructor (`cfb3b670a3eb4a54fe3f718fa3fa745ca2e1913ef78da3f0adbfc24bfb135d9a`, value 2n). Ver "Verification Result" en `2-technical/spec.md` ADR-003. Task 2 procede con el diseño happy-path tal como está especificado — el fallback (mover el cálculo de color a un circuit post-constructor) NO es necesario. Archivos temporales del spike (contrato, output compilado, script de ejecución) eliminados tras la verificación — cero archivos remanentes bajo contracts/, src/ o scripts/. |
| 2  | Add admin_token_color, consumeAdminToken(), and genesis mint in constructor | done | compile pass | `contracts/did_registry.compact.template`: agregado ledger `admin_token_color: Bytes<32>`; agregado `pure circuit adminDomainSep()`; agregado `circuit consumeAdminToken(coin)` (near-clone de `consumeToken`, comparte `used_capability_nullifiers`, exact-equality contra `admin_token_color`); constructor cambia a `(salt, admin_recipient, admin_coin_nonce, admin_supply)`, mintea `admin_supply + 1` unidades vía `mintShieldedToken(adminDomainSep(), total, ...)` atómicamente, setea `admin_token_color = tokenType(adminDomainSep(), kernel.self())`, retiene `role_by_key`/`admin_registered`/`initial_admin` como bookkeeping de solo-lectura; `register_initial_admin()` eliminado por completo. `compact compile --skip-zk` exit 0. Verificado en el `.d.ts` generado: `admin_token_color` presente como ledger field, `register_initial_admin` ausente, `consumeAdminToken` correctamente no exportado (mismo patrón que `consumeToken`). |
| 3  | Add rotate_admin_tokens circuit for atomic admin token replacement | done | compile pass | `contracts/did_registry.compact.template`: agregado `export circuit rotate_admin_tokens(coin, new_recipient, new_coin_nonce)` — assert color==admin_token_color, assert value>=1, assert nullifier no usado, burn (`receiveShielded` + insert nullifier) y mint (`mintShieldedToken` de 2 unidades) en el mismo cuerpo de circuit (atómico, sin estado intermedio). `compact compile --skip-zk` exit 0. Verificado en el `.d.ts` generado: `rotate_admin_tokens` presente en `ImpureCircuits`/`PureCircuits`/`Circuits` con la firma esperada. |
| 4  | Migrate 5 admin circuits to consumeAdminToken(); remove ISSUER role | done | compile pass | `contracts/did_registry.compact.template`: `mint_capability_tokens` e `issue_did` ganan `coin: ShieldedCoinInfo` como primer parámetro y `consumeAdminToken(coin)` como primera instrucción (reemplazando `assertRole(adminRole())` y el chequeo inline `is_admin \|\| is_issuer` respectivamente); `grant_role`/`revoke_role`/`revoke_did` (firmas sin cambios) reemplazan su par `assertRole(adminRole())` + `consumeToken(coin)` por un único `consumeAdminToken(coin)` como primera instrucción; `issuerRole()` pure circuit eliminado por completo. `grep -n "issuerRole\|is_issuer\|assertRole"` sobre el template solo matchea la definición de `assertRole` (retenida per housekeeping note del spec — sin callers, pero el compilador no la flaggea como no usada) y un comentario — cero referencias funcionales restantes. `compact compile --skip-zk` exit 0 (verificación final con las 3 tasks juntas). Verificado en el `.d.ts` generado: `issue_did` tiene la firma exacta `(coin, did_key, did_commitment, doc_commitment, proof_commitment)`; `mint_capability_tokens` tiene `coin` como primer parámetro. |
| 5  | Add DID-linked color assert to request_update_did | done | compile pass | `contracts/did_registry.compact.template`: agregado `assert(disclose(coin.color) == did_token_color.lookup(did_key), "Token does not match this DID")` en `request_update_did`, inmediatamente después de los 4 asserts de precondición existentes (did_controller.member/lookup, party_status.member/lookup) y antes de `consumeToken(coin)`, sin `did_token_color.member()` guard previo (ADR-005: garantizado por los asserts anteriores). `compact compile --skip-zk` exit 0. Firma sin cambios (verificado en `.d.ts`: mismos 4 parámetros). |
| 6  | Update compile-contract.js CIRCUITS list for rotate_admin_tokens | done | full pipeline pass | `scripts/compile-contract.js`: `CIRCUITS` array editado — `"register_initial_admin"` removido, `"rotate_admin_tokens"` agregado (`consumeAdminToken` no agregado, consistente con `consumeToken`). Corrido `npm run compile-contract` completo (pipeline real con generación de claves ZK, sin `--skip-zk`) — exit 0: `✅ Compiled: contracts/did_registry.compact`, managed output + browser assets + metadata regenerados. Confirmado en `contracts/managed/did-registry/{keys,zkir}/`: existen `did-registry#rotate_admin_tokens.{prover,verifier,bzkir,zkir}`; cero archivos `register_initial_admin.*` remanentes. |
| 7  | Update UnifiedRegistryAPI.deploy() and add _buildAdminCoin() | done | tsc: 0 errores | `src/lib/registry/unified-registry-api.ts`: `deploy()` actualizado — deriva `admin_recipient` de `providers.shieldedCoinPublicKeyHex`, genera `admin_coin_nonce` random de 32 bytes, usa `admin_supply=5n` fijo, pasa `[salt, {bytes: adminRecipientBytes}, adminCoinNonce, adminSupply]` como args del constructor. Agregado `_buildAdminCoin()` privado (mirror de `_buildCoin()`, filtra por igualdad exacta contra `ledger.admin_token_color` vía `queryContractState()` + `module.ledger()`, value>=2n, mismo shape de error "No spendable admin credits found..."). `registerInitialAdmin()` eliminado por completo. Collateral fix en `src/lib/did/app-api.ts`: `deployUnifiedRegistry()` ya no llama a `api.registerInitialAdmin()` (bootstrap en 2 pasos eliminado), usa `deployed?.public` directamente para `initializeTxHash`/`initializeTxId`. **Marcada `done` en esta invocación (task_ids=[8])**: el único criterio pendiente — `npx tsc --noEmit` reportaba `TS6133: '_buildAdminCoin' is declared but its value is never read` porque no tenía callers — quedó resuelto como efecto colateral mecánico de Task 8, que cablea `_buildAdminCoin()` en los 5 métodos admin-gated. No se tocó código de Task 7 en sí; el desbloqueo es puramente consecuencia de Task 8 dándole callers reales al helper. Ver nota de Task 8 abajo y la nota correspondiente en `tasks.json`. |
| 8  | Wire admin coin into 5 gated methods; add rotateAdminTokens() | done | tsc: 0 errores; npm test: 265 passed / 6 failed (fallos pre-existentes, ver abajo) | `src/lib/registry/unified-registry-api.ts`: `mintTokens` gana `coin` (via `_buildAdminCoin()`) como primer arg de `contract.callTx.mint_capability_tokens`, matching la firma `(coin, subscription_key, recipient, coin_nonce, amount)` confirmada en el `.d.ts` generado. `issueDid` gana `coin` (via `_buildAdminCoin()`) como primer arg de `contract.callTx.issue_did`, matching `(coin, did_key, did_commitment, doc_commitment, proof_commitment)`. `grantRole`/`revokeRole`/`revokeDid` cambian su fuente de coin de `_buildCoin()` a `_buildAdminCoin()` (firmas de circuit sin cambios — `coin` ya era su primer parámetro). Nuevo método público `rotateAdminTokens(opts: { newRecipientBytes: Uint8Array })` agregado — construye admin coin via `_buildAdminCoin()`, genera `newCoinNonce` fresco, llama `contract.callTx.rotate_admin_tokens`, retorna `{ txHash, txId }`. `gatedSelfRegisterDid`/`requestUpdateDid`/`updateDid` quedaron intencionalmente sin cambios (siguen en `_buildCoin()` — no son admin-gated, consumen capability tokens per ADR-005). |
| 9  | Add unit/simulator tests for genesis mint and admin-token consumption | done | 37/37 (archivo) | tests/unified-registry.test.ts reescrito — ver detalle abajo |
| 10 | Add integration tests for full admin lifecycle and DID color check | done | 37/37 (archivo) | mismo archivo/invocación que Task 9 — ver detalle abajo |
| 11 | Delete the 5 pre-unification test files | done | 222/222 (suite completa) | 5 archivos borrados vía `git rm`, cero referencias remanentes |
| 12 | Delete src/lib/did/api.ts and prune dead exports from app-api.ts | done | build+test verde (conjunto con 13) | `src/lib/did/api.ts` eliminado; `app-api.ts` pierde `deployDidRegistry`/`updateDidOrchestrated`/`revokeDidOrchestrated` + el import de `DidRegistryAPI`; `AnyRegistryAPI` angostado a `UnifiedRegistryAPI` |
| 13 | Delete didContract.ts and repoint App.tsx/OwnerVaultPanel.tsx imports | done | tsc: 0 errores; build: exit 0; npm test: 27/222/0 | `src/lib/didContract.ts` eliminado; `App.tsx` y `OwnerVaultPanel.tsx` repuntados a `./lib/did/cache` / `./lib/did/vault` / `../types/did` |
| 14 | Rewrite README sections for the coin-gated admin model | done | n/a (doc-only) | On-chain, Controller Model+Token Gating → "Coin-Gated Authorization (v0.9)", owner witness secret removido, Release Notes v0.9.0, Contract Directory Notes corregida |
| 15 | Final wiring/smoke test: full build, tests, and legacy sweep | done | build: exit 0; test: 27/222/0; compile-contract: exit 0 (ZK real) | grep final limpio; cleanup de `src/generated/{did-registry,token-gating}/` gitignored y huérfanos |

## Bloqueantes

Ninguno.

## Tasks 12-15 (2026-07-09) — Legacy removal final, README rewrite, smoke test

**Task 12**: `src/lib/did/api.ts` (la clase `DidRegistryAPI`, ~709 líneas, el cliente de la
arquitectura de bootstrap en dos pasos gateada por `ownPublicKey()` que esta feature
elimina on-chain) se borró completo. Se confirmó vía grep, ANTES de editar, que sus únicos
importadores eran `src/lib/did/app-api.ts` (el propio archivo a editar) y
`src/lib/didContract.ts` (target de Task 13, borrado en el mismo batch) — ningún otro
archivo del repo dependía de él. En `app-api.ts`: removidos `deployDidRegistry`,
`updateDidOrchestrated`, `revokeDidOrchestrated` (las únicas 3 funciones tipadas contra
`DidRegistryAPI`), el import `import { DidRegistryAPI } from "./api"`, y
`type AnyRegistryAPI` angostado de `DidRegistryAPI | UnifiedRegistryAPI` a solo
`UnifiedRegistryAPI`. Efecto colateral detectado y corregido: al borrar
`updateDidOrchestrated`/`revokeDidOrchestrated`, el import `executeGatedAction` de
`../token/token-witness.js` quedó sin ningún caller — cambiado a
`import type { TokenProviders }` (único símbolo de ese módulo aún en uso, por
`getTokenBalance`). El resto de `app-api.ts` (`compileDidRegistry`,
`deployUnifiedRegistry`, `requestDidWithSync`, `issueDidWithSync`, `updateDidWithSync`,
`revokeDidWithSync`, `getTokenBalance`, sync helpers) quedó sin cambios, tal como
especificaba la task.

**Task 13**: `src/lib/didContract.ts` (el archivo de compatibilidad que re-exportaba
`DidRegistryAPI` completo más `getSavedContractAddress`/`getSavedDeployment`/
`getOwnerVaultStatus`, estos últimos simples re-exports de `./did/cache`/`./did/vault`)
se borró completo. `src/App.tsx` repuntado: `getSavedContractAddress`/
`getSavedDeployment` ahora se importan de `./lib/did/cache` directamente. 
`src/components/OwnerVaultPanel.tsx` repuntado: `getOwnerVaultStatus` ahora se importa de
`../lib/did/vault`, y el tipo `OwnerVaultStatus` de `../types/did` (se separó en dos
import statements porque uno es valor y el otro es type-only). Se confirmó antes de editar
que ambos exports (`getOwnerVaultStatus` en `vault.ts` línea 33, `OwnerVaultStatus` en
`types/did.ts` línea 99) existen exactamente donde la task los describía.

Verificación conjunta 12+13 (Tasks 12 y 13 se implementaron y verificaron como una unidad
porque `didContract.ts` seguía importando `./did/api` y `deployDidRegistry` hasta que Task
13 lo borró — un `tsc --noEmit` intermedio entre Task 12 y Task 13 mostraba exactamente 2
errores, ambos en `didContract.ts`, ambos resueltos al completar Task 13):
- `npx tsc --noEmit` → exit 0, 0 errores.
- `npm run build` (`tsc && vite build`) → exit 0, 3184-3188 módulos transformados; solo
  warnings preexistentes de code-splitting de Vite sobre imports dinámicos vs estáticos
  (no relacionados a esta feature, presentes también antes de estos cambios).
- `npm test` → 27 archivos, 222 tests, 0 fallos.
- Grep de `deployDidRegistry|updateDidOrchestrated|revokeDidOrchestrated|DidRegistryAPI`
  sobre todo `src/` confirma cero referencias funcionales remanentes fuera de dos
  comentarios históricos en `unified-registry-api.ts` que documentan de qué patrón se
  derivó el código actual (no llaman a nada).

**Task 14 — corrección de un dato desactualizado en la instrucción del orquestador**: la
invocación de esta task para el sub-agente afirmaba que `2-technical/spec.md` documenta
`rotate_admin_tokens` con una firma FIJA de 3 parámetros `(coin, new_recipient,
new_coin_nonce)` y remint fijo de 2 unidades, calificándola de "firma final vigente, no
la contradigas". Antes de escribir una sola línea del README se releyeron tanto
`contracts/did_registry.compact.template` (código real, compilado y testeado) como
`2-technical/spec.md` completo: **ambos documentan hoy la firma de 4 parámetros**
`(coin, new_recipient, new_coin_nonce, new_supply: Uint<64>)` con remint configurable —
`2-technical/spec.md` ADR-003 termina con un bloque explícito "Post-implementation
correction (2026-07-09)" que registra que ADR-002 y la firma de `rotate_admin_tokens`
fueron revisadas DESPUÉS de escribir el spec original, para reconciliarlo con el código
tal como quedó implementado (ver la sección "Fix de diseño sobre tasks 3/8" más abajo en
este mismo archivo, fechada también 2026-07-09, que documenta la aprobación explícita del
usuario de esa reversión de diseño). En otras palabras: la instrucción del orquestador
citaba un estado del spec ya superado por una corrección posterior — no el estado
"reconciliado" que afirmaba ser. Se procedió a escribir el README reflejando la firma de 4
parámetros real (verificada además en `src/lib/registry/unified-registry-api.ts`, que pasa
`opts.newSupply` como cuarto argumento de `contract.callTx.rotate_admin_tokens`), no la de
3 parámetros de la instrucción. Ningún contenido fue inventado: todo se verificó contra
archivos reales (`contracts/did_registry.compact.template`,
`src/lib/registry/unified-registry-api.ts`, `scripts/compile-contract.js`).

Secciones reescritas en `README.md`:
- **"On-chain"** (antes: dos contratos separados, constructor `token_contract:
  ZswapCoinPublicKey`, modelo controller v2, circuits `self_register_did`/
  `register_initial_admin` inexistentes) → reescrita desde cero describiendo el contrato
  único v3.0.0 actual: constructor de 4 parámetros con mint génesis atómico,
  `consumeToken`/`consumeAdminToken`, `rotate_admin_tokens`, ISSUER eliminado,
  `did_token_color` check en `request_update_did`.
- **"Controller Model (v2)"** + **"Token Gating (v0.8)"** → fusionadas y reemplazadas por
  una única sección nueva **"Coin-Gated Authorization (v0.9)"** que describe los dos
  colores de token (capability + admin) sobre el contrato unificado, sin mención de un
  contrato `token_gating.compact` separado ni de un flujo de dos transacciones entre
  contratos distintos.
- **"owner witness secret"** (línea ~315, dentro de "Product Views → Admin") → reemplazada
  por una descripción correcta de la autorización admin-tier vía `consumeAdminToken()`.
- **Release Notes** → nueva entrada **v0.9.0** documentando el fix de seguridad completo:
  reemplazo de `ownPublicKey()` forgeable por `consumeAdminToken()`, mint génesis atómico,
  `rotate_admin_tokens`, remoción de ISSUER, DID-linked color check en
  `request_update_did`, y remoción del código legacy.
- **Contract Directory Notes** (~905-921) → corregida: `contracts/did_registry.compact.template`
  listado como fuente editable, `contracts/did_registry.compact` como output generado (no
  editar a mano), `contracts/archived/token_gating.compact` explícitamente marcado
  **"Archived, not active"**.

Fixes adicionales de bajo riesgo, fuera de las secciones explícitamente listadas por la
task pero directamente contradictorios con el fix de esta feature (se aplicaron por
juicio propio del implementador, ya que dejar esas menciones habría creado
inconsistencia interna dentro del mismo README que la task pedía corregir):
- Diagrama Mermaid "Agent Identity Flow" (~línea 65): `"ADMIN · ISSUER · USER · AGENT
  roles"` → `"coin-gated admin token + capability tokens"`.
- Diagrama de secuencia "Reference Architecture" (~líneas 147-155): removida la
  interacción con un participante `TokenContract` separado y las llamadas
  `consume_token_for_action`/`self_register_did`(v2 sin coin)/`issue_did` sin coin;
  reemplazadas por `gated_self_register_did(coin, ...)` / `issue_did(coin, ...)` sobre el
  único contrato, con `consumeToken`/`consumeAdminToken` explícitos.
- Nota de autorización en la descripción del admin deploy panel (~línea 691): "`issue/
  update/revoke` resuelto desde `ownPublicKey()`" → distinción correcta entre
  admin-tier (`consumeAdminToken()`) y controller-tier (`ownPublicKey()` + color check).

**NO se tocó** (deuda de documentación preexistente a esta feature, de la unificación v3
anterior, fuera del scope explícito de tasks.json): la descripción del flujo de deploy de
3 pasos ("Load Artifact → Deploy Token Gating → Deploy DID Registry") ni el script
`compile-token-gating` en la sección Development. Ambos describen todavía un flujo de dos
contratos que ya no existe desde antes de que esta feature empezara. Documentado como
hallazgo, no corregido en esta invocación.

**Task 15 — resultado explícito de los 4 pasos del gate final**:

1. `npm run build` → **exit 0**. 3184-3188 módulos transformados por Vite (varió levemente
   entre corridas por el HMR interno, sin relevancia). Solo warnings preexistentes de
   code-splitting (`dynamically imported ... but also statically imported`), no
   relacionados a esta feature — presentes ya antes de estos cambios.
2. `npm test` → **27 archivos, 222 tests, 0 fallos**. Repetido 3 veces en distintos puntos
   de la invocación (tras Tasks 12+13, tras la recompilación de Task 15 paso 3, y una vez
   más tras el cleanup de `src/generated/`) — siempre estable, mismo resultado.
3. `npm run compile-contract` (pipeline completo, **sin** `--skip-zk`) → **exit 0**.
   Confirmado en `contracts/managed/did-registry/keys/`: `rotate_admin_tokens.prover`
   pesa ~9.96 MB (evidencia de generación ZK real, no un placeholder de `--skip-zk`);
   `rotate_admin_tokens.{prover,verifier}` y `.{bzkir,zkir}` presentes; cero archivos
   `register_initial_admin.*` remanentes; los 8 circuits esperados
   (`gated_self_register_did`, `grant_role`, `issue_did`, `mint_capability_tokens`,
   `request_update_did`, `revoke_did`, `revoke_role`, `rotate_admin_tokens`) todos
   presentes con `.prover`/`.verifier`. Se re-verificó `tsc --noEmit` y `npm test`
   inmediatamente después, ambos en verde, confirmando que la regeneración de
   `src/generated/didRegistryContract.runtime.{js,d.ts}` no rompió nada.
4. Grep final sobre `src/`, `tests/`, `scripts/`, `contracts/*.compact(.template)`,
   `README.md` para `register_initial_admin`, `issuerRole`, `is_issuer`,
   `self_register_did` (palabra completa), `didContract`, `src/lib/did/api`,
   `owner witness secret`, `DidRegistryAPI`, y los nombres de los 5 test files
   eliminados: **cero referencias funcionales/rotas**. Los únicos hits restantes son (a)
   comentarios históricos en el contrato/cliente documentando qué se reemplazó, (b) prosa
   de README (Release Notes, On-chain) narrando la migración, y (c) un test
   (`tests/unified-registry.test.ts` línea 671) que afirma explícitamente la AUSENCIA de
   `register_initial_admin` — exactamente el patrón ya establecido como aceptable en la
   nota de Task 11.

   **Hallazgo colateral durante el sweep, corregido**: `src/generated/did-registry/` y
   `src/generated/token-gating/` eran subdirectorios **gitignored** (confirmado vía
   `git ls-files` — cero resultados), **no referenciados por ningún archivo fuente**
   (grep de `generated/did-registry/` y `generated/token-gating/` sobre `src/`, `scripts/`,
   `tests/` dio cero resultados), con fecha de modificación del 27 de junio — de un compile
   mucho más viejo, anterior incluso a la unificación v3. Contenían los circuits viejos
   (`register_initial_admin`, `self_register_did` sin gating, `issuerRole`, `is_issuer`) y
   contaminaban el grep sweep con falsos positivos. Se eliminaron (`rm -rf`) por higiene —
   son build output local puro, no código fuente ni artefacto trackeado por git, y nada los
   importa (el runtime real y usado es `src/generated/didRegistryContract.runtime.js`,
   regenerado con fecha de hoy). Se re-verificó `tsc --noEmit` y `npm test` después del
   borrado — ambos en verde, confirmando que efectivamente eran cruft sin ningún caller.

   **Hallazgo adicional, fuera de scope de esta feature, flaggeado vía `spawn_task` (no
   ejecutado)**: `src/lib/token/token-gating-api.ts` (clase `TokenGatingAPI`) no tiene
   ningún caller vivo en todo el repo (grep de `token-gating-api|TokenGatingAPI` sobre
   `src/` y `server/` solo matchea el propio archivo) — es huérfano de la misma
   naturaleza que `src/lib/did/api.ts` (Task 12), aparentemente no capturado por la
   limpieza de la unificación v3 anterior a esta feature. No estaba en el scope de
   `tasks.json` de `005-coin-gated-admin-access`, así que no se tocó — se dejó una
   sugerencia de background task para una sesión futura.

Todos los Success Criteria de `proposal.md` quedan satisfechos por los resultados de este
run: build limpio, suite de tests limpia, pipeline de compilación ZK real limpio, y sweep
de legacy sin referencias rotas.

## Tasks 9 y 10 (2026-07-09) — tests/unified-registry.test.ts reescrito

Ambas tasks se ejecutaron en la misma invocación porque comparten el mismo archivo objetivo y la
misma infraestructura de test nueva (helpers `deploy()`/`run()`/`seedBytes()` para ejecución real
del contrato compilado). Se dividen en dos partes:

**PARTE 1 — TS API-layer (mocks, sin cambios de patrón, solo corrección de los 6 fallos heredados
de Task 8)**:
- Se agregó `MOCK_ADMIN_COLOR` (distinto de `MOCK_COLOR`) y se agregó `admin_token_color:
  fromHex(MOCK_ADMIN_COLOR)` al ledger mockeado en `makeModule()` — resuelve el `TypeError` que
  causaba 5 de los 6 fallos previos (`_buildAdminCoin()` no podía leer un campo que el mock no
  tenía).
- `makeProviders()` ahora da balance en ambos colores por defecto; `makeCallTx()` reemplaza el
  mock `register_initial_admin` (método eliminado) por `rotate_admin_tokens`.
- Se **eliminó** el describe `REQ-03 registerInitialAdmin` (llamaba a un método que ya no existe
  desde Task 7) y se agregó `REQ-01/S02 — no separate bootstrap operation exists (client layer)`,
  que confirma que `UnifiedRegistryAPI` no expone `registerInitialAdmin()` — cierre del REQ-01
  Scenario 02 también en la capa cliente (el cierre en la capa contrato ya lo cubre Task 9 Parte 2).
- Se corrigieron las assertions de color (`MOCK_COLOR` → `MOCK_ADMIN_COLOR`) en `REQ-02
  mintTokens`, `REQ-06 revokeDid`, `REQ-07 grantRole/revokeRole` — estos circuits ahora consumen
  un coin admin-coloreado vía `_buildAdminCoin()`, no un capability-color genérico.
- Se reescribió por completo `REQ-04 issueDid`: el test anterior afirmaba explícitamente "issue_did
  NO recibe coin" (`args.toHaveLength(4)`, chequeo `"value" in arg === false`) — eso era correcto
  bajo el contrato v2 pre-005 pero es exactamente lo opuesto de lo que Task 4/ADR-004 implementó
  (`issue_did` gana `coin` como primer parámetro). Reescrito para esperar 5 args con `coin` primero.
- Se agregó `REQ-04 rotateAdminTokens` (2 tests nuevos) — no existía ninguna cobertura de esta
  capa API para el método nuevo de Task 8 hasta ahora.

**PARTE 2 — Contract-simulator real (`@midnight-ntwrk/compact-runtime`, sin mocks)**, siguiendo el
patrón que usaba `src/tests/token-gating.test.ts` antes de ser eliminado en Task 11 (carga el
`Contract`/`ledger` reales desde `../src/generated/didRegistryContract.runtime.js`, ejecuta
`contract.impureCircuits.*` directamente, encadena estado real entre llamadas):

- **Hallazgo empírico durante el ciclo RED→GREEN** (documentado porque no era obvio de la lectura
  del contrato): `consumeToken()`/`consumeAdminToken()` llaman `receiveShielded(coin)` seguido de
  `sendImmediateShielded(coin, ownPublicKey(), remaining)` — ambos con el MISMO `coin` de entrada.
  Ejecutando el contrato compilado y volcando `outputs[].recipient.is_left` se confirmó que esto
  produce **3 outputs Zswap** por llamada, no 1: `receiveShielded` primero crea un output de
  "custodia" de valor completo hacia el contrato mismo (`recipient.is_left === false`); luego
  `sendImmediateShielded`→`sendShielded` internamente hace su propio `createZswapInput` (gastando
  el coin original) y produce el output realmente pagado al caller (`recipient.is_left === true`,
  valor = remaining) MÁS un tercer output "residual" de 1 unidad, también propiedad del contrato
  (`recipient.is_left === false`) — el "costo de procesamiento" que el patrón retiene. Para
  `rotate_admin_tokens` (que solo hace `receiveShielded`, sin `sendImmediateShielded` de vuelta —
  burn completo) el patrón es más simple: 1 output de custodia (contrato) + 1 output del nuevo
  mint (caller). El primer intento de estos tests (sin filtrar) fallaba 6/6 con valores/colores
  incorrectos porque tomaba el output[0] equivocado (el de custodia del contrato, no el gastable
  por el caller) en varios circuits. **Fix**: el helper de test `run()` filtra
  `outputs.filter(o => o.recipient.is_left)` antes de devolver `outputs`, exponiendo solo los
  coins que el caller puede efectivamente gastar — con eso los índices originales (0 para
  circuits que solo consumen, 0/1 para `mint_capability_tokens` que además mintea, 0 para
  `rotate_admin_tokens`) quedan correctos y estables.
- `describe('REQ-01 — genesis admin token minted atomically at deploy')`: mint de
  `admin_supply + 1` con color coincidente con `ledger.admin_token_color`; rechazo de
  `admin_supply = 0`; ausencia de `register_initial_admin` en `contract.circuits`/`impureCircuits`.
- `describe('consumeAdminToken — accepts admin color, rejects any other color')`: exercised vía
  `mint_capability_tokens` (no requiere DID previamente registrado).
- `describe('REQ-04 — rotate_admin_tokens atomic replacement')`: S01 (burn+remint atómico, coin
  viejo deja de ser gastable, coin nuevo sí) y S02 — el "atomic-failure path" simplificado según
  instrucción del orquestador: reusar un coin ya nullificado (de una rotación previa exitosa)
  contra el mismo `rotate_admin_tokens` falla con "Admin token already used" sin dejar estado
  parcial, y el coin legítimamente rotado en la llamada exitosa anterior sigue gastable después
  del intento fallido (demuestra que nunca hay un estado con cero admin tokens válidos).
- `describe.each` `REQ-02/S02` sobre los 5 circuits admin-gated (`mint_capability_tokens`,
  `issue_did`, `grant_role`, `revoke_role`, `revoke_did`): cada uno rechaza un coin de color
  arbitrario con "Invalid admin token color" — sin necesitar un DID pre-registrado, porque
  `consumeAdminToken(coin)` es la PRIMERA instrucción en los 5 circuits.
- `describe('REQ-03 — ISSUER role removed')`: caso más fuerte que el anterior — `issue_did`
  rechaza un coin de capability-token LEGÍTIMAMENTE minteado (no arbitrario), probando que no
  existe bypass vía el bookkeeping de `role_by_key` que el constructor sí escribe para el deployer
  (`role_by_key[ADMIN]=true`) — ese bookkeeping es de solo lectura para la UI, no autoriza nada.
- `describe('REQ-05 — request_update_did requires the DID's own linked token color')`: mintea 2
  colores de capability distintos, registra el DID con el color A, activa el DID vía `issue_did`,
  confirma que el color B (válido pero no vinculado) es rechazado con "Token does not match this
  DID" y que el color A (como change coin) es aceptado, moviendo `party_status` a 4
  (pending_update).
- `describe('Full lifecycle integration')`: cadena completa `deploy -> mint_capability_tokens ->
  gated_self_register_did -> issue_did -> grant_role -> revoke_role -> revoke_did ->
  rotate_admin_tokens` sobre una única instancia de contrato, verificando en cada paso el valor
  decreciente del admin coin (11→10→9→8→7→6→7 tras rotar con `new_supply=6`) y las transiciones
  de `party_status`/`total_active_dids`.

**Verificación**: `npx vitest run tests/unified-registry.test.ts` → 37/37 passing. `npx tsc
--noEmit` → 0 errores (el archivo vive en `tests/` en la raíz, fuera del `include` de
`tsconfig.json`, así que no participa del gate de `npm run build`, pero se verificó igual que el
resto del proyecto sigue en 0 errores).

## Task 11 (2026-07-09) — Eliminación de los 5 test files pre-unificación

`git rm src/tests/did-registry-gated.test.ts src/tests/token-gating.test.ts
src/tests/token-gating-integration.test.ts src/tests/token-subscription.test.ts
src/tests/token-api-layer.test.ts`. Grep de los 5 nombres de archivo sobre todo el repo (excluyendo
`sdd/`) confirma cero referencias remanentes salvo prosa descriptiva en los comentarios de cabecera
de `tests/unified-registry.test.ts` (documentando de qué patrón se derivó su Parte 2 de
contract-simulator real), redactada para no dar a entender que el archivo eliminado sigue
existiendo.

**`npm test` (suite completa) post-Tasks 9/10/11**: `27 archivos, 222 passed, 0 failed` (antes de
esta invocación: 32 archivos, 265 passed, 6 failed — los 6 fallos eran exactamente los que Tasks
9/10 corrigieron; la diferencia en el total de tests pasando, 265→222, es la resta neta de los
tests eliminados en los 5 archivos de Task 11 más el delta de tests agregados/reescritos en
`tests/unified-registry.test.ts`).

## Decisiones de implementación

### Fix de diseño sobre tasks 3/8: `rotate_admin_tokens` gana `new_supply` (2026-07-09)

Tras revisión posterior, se detectó que la implementación existente de `rotate_admin_tokens`
(task 3) hardcodeaba `mintShieldedToken(adminDomainSep(), 2 as Uint<64>, ...)` — cada
rotación siempre remintea exactamente 2 unidades (1 anchor + 1 credit) sin importar cuánto
tenía el admin originalmente, sin ningún parámetro para elegir el supply. Esto seguía al
pie de la letra la decisión documentada en ADR-002 de `2-technical/spec.md` ("rotate_admin_tokens
mints a fresh 2-unit admin coin... is NOT a batch-replenishment operation"), pero el usuario
**aprobó explícitamente** revertir esa decisión y restaurar un parámetro `new_supply:
Uint<64>` configurable, para que el admin pueda batch-replenish en una rotación igual que
`mint_capability_tokens` permite elegir `amount`. Esto es una corrección de diseño aprobada
por el usuario, no un bug de implementación contra la spec vigente — **contradice
ADR-002/ADR-003 tal como están redactados hoy en `2-technical/spec.md`**; ese documento
debería actualizarse en un pase posterior para reflejar esta reversión (fuera de scope de
esta invocación, que es un fix puntual sobre código, no reescritura de spec).

**Cambios aplicados** (sobre las tasks 3 y 8, ya `done` — se mantienen `done`, no se
reabren como nuevas tasks):

1. `contracts/did_registry.compact.template`: firma de `rotate_admin_tokens` cambia de
   `(coin, new_recipient, new_coin_nonce)` a `(coin, new_recipient, new_coin_nonce,
   new_supply: Uint<64>)`. Se agregó `assert(disclose(new_supply) >= (1 as Uint<64>),
   "new_supply must be at least 1")` (mismo patrón que el guard de `admin_supply` en el
   constructor, fix post-quality-gate anterior) y `const total = (disclose(new_supply) +
   (1 as Uint<64>)) as Uint<64>;`, usando `total` en vez del literal `2 as Uint<64>` en
   `mintShieldedToken(...)`.
2. `compact compile --skip-zk contracts/did_registry.compact.template <tmp-dir>` → exit 0.
   `.d.ts` generado verificado: `rotate_admin_tokens` con 4 parámetros, `new_supply_0:
   bigint` como último argumento.
3. Pipeline completo `npm run compile-contract` (sin `--skip-zk`, generación real de claves
   ZK) → exit 0. Confirmado en `contracts/managed/did-registry/{keys,zkir}/`:
   `did-registry#rotate_admin_tokens.{prover,verifier,bzkir,zkir}` regenerados con la nueva
   firma; `src/generated/didRegistryContract.runtime.{js,d.ts}` regenerados.
4. `src/lib/registry/unified-registry-api.ts`: `rotateAdminTokens(opts: {
   newRecipientBytes: Uint8Array; newSupply: bigint })` — ahora pasa `opts.newSupply` como
   cuarto argumento de `contract.callTx.rotate_admin_tokens`, consistente con cómo
   `mintTokens()` maneja su parámetro `credits`/`amount`. `newSupply` tiene un caller real
   (el `callTx` call), así que no genera `TS6133`.
5. `npx tsc --noEmit` → exit 0 (0 errores).
6. `grep -rn "rotateAdminTokens\|rotate_admin_tokens" src/ tests/` confirma que
   `unified-registry-api.ts` es el único caller real de ambos símbolos en todo el
   proyecto (además del `.d.ts` generado) — no queda ningún caller con la firma vieja de
   3 parámetros, porque no existía ningún otro caller de `rotateAdminTokens()` en el
   proyecto (ni UI ni tests lo invocaban todavía; Tasks 9/10, aún `pending`, son las que
   agregarían tests de este circuit).

### Tasks 5-7 (2026-07-09)

- Task 5 y 6 se implementaron y verificaron sin sorpresas: Task 5 compiló limpio con `--skip-zk` (cambio de una sola línea, sin impacto en firma de `request_update_did`); Task 6 se verificó corriendo el pipeline completo de compilación (`npm run compile-contract`, sin `--skip-zk`, generación real de claves ZK) en background — exit 0, con `rotate_admin_tokens` presente en `keys/`/`zkir/` y `register_initial_admin` completamente ausente. Esta corrida completa también regeneró `src/generated/didRegistryContract.runtime.{js,d.ts}` con el contrato final de tasks 2-6, lo cual fue necesario para que Task 7 pudiera type-checkear contra las firmas de circuit actualizadas.
- Task 7: se detectó y corrigió un break colateral necesario en `src/lib/did/app-api.ts` — `deployUnifiedRegistry()` (función que la spec técnica marca explícitamente como "keep", no como candidata a borrado) todavía llamaba a `api.registerInitialAdmin()` después de `UnifiedRegistryAPI.deploy()`, reproduciendo el bootstrap en dos pasos que esta feature elimina. Se quitó esa llamada y se ajustó `initializeTxHash`/`initializeTxId` para leer directamente de `deployed?.public` (el mismo dato de la tx de deploy, ya que el constructor mintea el admin token atómicamente). Este fix no estaba explícito en ninguna task de `tasks.json` pero es una consecuencia mecánica directa y necesaria de Task 7's propio acceptance criteria ("registerInitialAdmin() no longer exists as a method"); sin él, `npm run build` fallaría con `TS2339` en un archivo distinto al de la task.
- Task 7 quedó `in-progress`, no `done`, por el TS6133 de `_buildAdminCoin()` sin caller — ver historial de Bloqueantes de esa invocación. Se optó explícitamente por NO adelantar el cableado de Task 8 (que resolvería el lint) para respetar el scope de esa invocación (`task_ids=[5,6,7]`) y no hacer trabajo de Task 8 sin que estuviera marcada como asignada.

### Task 8 (2026-07-09)

- Se cablearon los 5 call sites de `_buildAdminCoin()` exactamente como especifica ADR-001/ADR-004: `mintTokens` e `issueDid` (que antes no pasaban ningún `coin`) ahora lo obtienen vía `_buildAdminCoin()` y lo pasan como primer argumento de `callTx`; `grantRole`/`revokeRole`/`revokeDid` (que ya pasaban un `coin`, pero obtenido de `_buildCoin()`, el helper genérico multi-color) cambian su única línea de obtención de coin a `_buildAdminCoin()`, sin tocar el resto del método. `gatedSelfRegisterDid`, `requestUpdateDid` y `updateDid` se dejaron deliberadamente intactos en `_buildCoin()`: no son circuits admin-gated (`request_update_did` usa `consumeToken()` + el assert de color ligado al DID de ADR-005, no `consumeAdminToken()`), así que cablearles `_buildAdminCoin()` habría sido incorrecto.
- **Resolución del bloqueante de Task 7**: al darle a `_buildAdminCoin()` sus primeros callers reales (los 5 sitios de arriba), el `TS6133: '_buildAdminCoin' is declared but its value is never read` que dejaba a Task 7 en `in-progress` desapareció sin ningún cambio adicional en el helper en sí — exactamente como anticipaba la nota de Task 7. Por instrucción explícita del orquestador para esta invocación, Task 7 se marca `done` en esta misma pasada (no solo Task 8), documentando aquí que el desbloqueo fue un efecto colateral mecánico de Task 8, no trabajo nuevo sobre Task 7.
- **Discrepancia de firma en `rotateAdminTokens()` resuelta a favor de `tasks.json`/spec técnica**: la instrucción del orquestador para esta invocación describía la firma como `rotateAdminTokens(opts: { newRecipientBytes: Uint8Array; newSupply: bigint })`, pero tanto `tasks.json` (Task 8, descripción y acceptance criteria) como `2-technical/spec.md` (Component Design → Client, sección `rotateAdminTokens`) especifican explícitamente `opts: { newRecipientBytes: Uint8Array }`, sin `newSupply`. Se verificó además en el `.d.ts` generado (`src/generated/didRegistryContract.runtime.d.ts`) que el circuit `rotate_admin_tokens` acepta exactamente 3 parámetros — `(coin, new_recipient, new_coin_nonce)` — sin ningún parámetro de supply; ADR-002 documenta por qué: la rotación siempre mintea un coin fijo de 2 unidades (1 anchor + 1 credit), no un batch configurable. Se implementó la firma tal como la especifica `tasks.json`/spec (fuente de verdad de este kit — ver `persistence-contract.md`), sin `newSupply`. Agregar ese parámetro sin usarlo además habría roto la compilación, ya que `tsconfig.json` tiene `noUnusedParameters: true`.
- **Verificación**: `npx tsc --noEmit` → exit 0 (0 errores en todo el proyecto, confirmando la resolución del TS6133). `npm test` (suite completa, 32 archivos) → `265 passed, 6 failed`; los 6 fallos están 100% concentrados en `tests/unified-registry.test.ts` y son, sin excepción, tests que ejercitan la API pre-Task-7/8 (uno llama al método eliminado `registerInitialAdmin()`; los otros cinco mockean un ledger sin `admin_token_color`, campo agregado en Task 2 pero nunca reflejado en el mock del test). Esto coincide exactamente con lo que Tasks 9/10 tienen asignado reescribir — no se modificó `tests/unified-registry.test.ts` en esta invocación (fuera de scope de Task 8). No se detectó ninguna regresión en los otros 31 archivos de test (265 casos).

- Task 1 (pura verificación, sin código de producción) resolvió el "Open Question" bloqueante de ADR-003 con veredicto CONFIRMADO. Esto elimina la necesidad de considerar el fallback (circuit separado post-constructor) en Task 2 — el diseño del constructor happy-path documentado en ADR-003 puede implementarse tal cual.
- Tasks 2, 3 y 4 se implementaron secuencialmente sobre `contracts/did_registry.compact.template` (nunca sobre `contracts/did_registry.compact`, que se regenera vía `scripts/compile-contract.js`). Se compiló con `compact compile --skip-zk contracts/did_registry.compact.template <tmp-dir>` después de cada task y una vez más al final de las tres — todas las corridas dieron exit 0 sin necesidad de resolver `__CONTRACT_VERSION__` primero, ya que ese placeholder solo aparece dentro de un literal string pasado a `pad(32, ...)` en `contract_version()`, que es sintácticamente válido tal cual (no requirió correr el paso de sustitución del build script para esta verificación).
- `assertRole()` (pure circuit que lee `role_by_key`) quedó sin callers dentro del contrato tras Task 4, tal como anticipaba la "Post-migration housekeeping note" de la spec técnica. Se confirmó empíricamente que el compilador (v0.5.1 CLI / toolchain del proyecto) NO flaggea circuits top-level sin uso como error — el compile final con las tres tasks aplicadas siguió dando exit 0 — así que se dejó `assertRole()` en el archivo sin modificarlo, tal como la spec permitía como opción por defecto.

### Fixes post-quality-gate sobre tasks 2-4 (2026-07-09)

Tras el code review + security scan del quality gate de tasks 2-4, el usuario aprobó 3 fixes puntuales sobre `contracts/did_registry.compact.template`. Estos NO son tasks nuevas de `tasks.json` — son correcciones sobre la implementación ya existente de las tasks 2, 3 y 4 (que siguen `done`).

1. **Validación de `admin_supply` en el constructor**: agregado `assert(disclose(admin_supply) >= (1 as Uint<64>), "admin_supply must be at least 1")` en el `constructor(...)`, justo después de `total_active_dids = 0 as Uint<64>;` y antes de que `admin_supply` se use para calcular `public_supply`/`total`/mintear. Previene un génesis degenerado con `admin_supply = 0` (solo el 1 anchor unit minteado, sin ningún admin token utilizable — el contrato quedaría sin forma de operar ningún circuit gateado por admin).

2. **`assertRole()` eliminado; `roleKey()` retenido**: se confirmó vía grep que `roleKey()` tiene 5 callers activos fuera de `assertRole()` (constructor ×2, `gated_self_register_did`, `grant_role`, `revoke_role`), así que solo se borró la función `assertRole()` (antes líneas 123-128, entre `userRole()`/`agentRole()` y el comentario de `consumeToken`). Grep post-fix confirma cero referencias funcionales a `assertRole` restantes en el archivo — solo queda un comentario histórico en `mint_capability_tokens` que documenta qué reemplazó (`consumeAdminToken(coin)`) y por qué (forgeable vía `ownPublicKey()`).

3. **Namespace del nullifier por color (anti-colisión cross-token)**: el cálculo de `nullifier_proxy` cambió de `persistentHash<Bytes<32>>(disclose(coin.nonce))` a `persistentHash<Vector<2, Bytes<32>>>([disclose(coin.color), disclose(coin.nonce)])` en las 3 ubicaciones que escriben/leen el mapa compartido `used_capability_nullifiers`: `consumeToken()`, `consumeAdminToken()`, y el bloque de burn de `rotate_admin_tokens()`. Antes del fix, dos coins con el mismo `nonce` pero distinto `color` (ej. un capability token y el admin token, o dos capability tokens de distintas subscriptions) podían colisionar en el nullifier y bloquear (o falsamente marcar como "ya usado") el consumo de uno a partir del otro, ya que el nullifier solo dependía del nonce. Namespacing por color hace que el nullifier sea único por (color, nonce), preservando la seguridad de compartir un único mapa de replay entre todos los tipos de token del contrato.

**Verificación**: `compact compile --skip-zk contracts/did_registry.compact.template <tmp-dir>` → exit 0, sin `__CONTRACT_VERSION__` a resolver (mismo motivo que en tasks 2-4: el placeholder vive dentro de un literal string pasado a `pad(32, ...)` en `contract_version()`, sintácticamente válido tal cual). `.d.ts` generado verificado: `assertRole` ausente (no exportado, como antes), `admin_token_color`/`admin_supply_0` presentes con la forma esperada, los 7 circuits exportados (`gated_self_register_did`, `grant_role`, `issue_did`, `mint_capability_tokens`, `request_update_did`, `revoke_did`, `revoke_role`) generan `.zkir` como antes — ningún circuit exportado se agregó ni se quitó por estos fixes.
