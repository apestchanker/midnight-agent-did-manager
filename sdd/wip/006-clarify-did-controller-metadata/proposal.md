# Proposal: Clarify DID `controller` as Informative Metadata, Separate from `subjectWalletAddress`

## Intent

Hoy un solo input de UI ("Agent Wallet Address") alimenta a la vez `subjectWalletAddress` (el subject binding del agente) y `controller` del DID Document (un atributo declarativo del estándar W3C DID). Esto es engañoso: alguien inspeccionando un DID Document puede razonablemente asumir que `controller` determina quién puede administrar el DID, cuando la autorización real está gobernada exclusivamente por posesión/consumo de capability tokens on-chain (ya implementado, ya documentado en README). Esta feature separa ambos conceptos en el modelo de datos y en la UI, y cierra el gap de documentación que permite la confusión.

## Scope

### In Scope
- Nuevo campo `controller` explícito en `src/types/did.ts` (`DidRecord`, `RequestDidInput`, `IssueDidInput`, `UpdateDidInput` según aplique), independiente de `subjectWalletAddress`.
- Nuevo state de UI en `RequestForm.tsx` e `IssuerPanel.tsx` para `controller`, default-poblado desde la wallet humana conectada (`walletAddress`, NO `agentAddress`/`subjectWalletAddress`), editable por el usuario antes de submit.
- Nueva columna `controller` en `did_requests` y `did_records` (`server/schema.sql`), vía `alter table ... add column if not exists` — consistente con el patrón de migración idempotente ya usado en el archivo.
- Propagación del campo a través de `src/lib/did/app-api.ts` (`requestDidWithSync`/`issueDidWithSync`, cache local `mergeDidMetadata()`, persistencia Postgres) y de los dos generadores backend existentes (`src/lib/did/request-document.js`, `server/mcp-core.js`) que hoy derivan `controller` implícitamente.
- Unificación de la tercera fuente divergente: `resolveDid()` en `server/registry-service.js` (línea 1698) deja de hardcodear `controller: record.did` y pasa a leer el `controller` explícito guardado (con fallback a `record.did` solo para registros legacy sin valor migrado).
- Nueva subsección de README (cerca de `### On-chain` / `## Coin-Gated Authorization`) que documenta explícitamente: `controller` es metadata informativa del DID Document sin efecto de autorización; la autorización real está gobernada on-chain por capability tokens.
- `subjectWalletAddress` permanece intacto en semántica, nombre y flujo — no se renombra ni se modifica su comportamiento actual.

### Out of Scope
- Cualquier cambio al contrato Compact (`contracts/did_registry.compact` / `.template`) — su modelo de controller on-chain vía `ownPublicKey()` ya es correcto y queda fuera de alcance.
- Uso futuro de `subjectWalletAddress` como wallet propia del agente para pago/recepción — mencionado por el usuario como dirección futura, explícitamente diferido.
- Migración retroactiva de datos existentes que reconstruya `controller` para registros ya emitidos antes de esta feature (los registros legacy seguirán resolviendo `controller` vía fallback a `record.did` en `resolveDid()`, y sin valor propio en `did_records.controller`/`did_requests.controller`).
- Cambios a `agentAddress`/`subjectWalletAddress` en el flujo MCP (`server/mcp-core.js` ya documenta correctamente que `controller` es un `platformGeneratedDidFields` que el llamador no debe enviar — ese diseño se mantiene, solo cambia de qué valor server-side se deriva).

## Approach

Se agrega `controller` como campo propio de primera clase en todo el pipeline de datos (tipos → UI → API cliente → schema → persistencia), en paralelo a `subjectWalletAddress` sin tocarlo. En la UI, `controller` se auto-puebla desde la wallet humana conectada (`walletAddress`) al momento de armar el DID Document por defecto, pero queda editable en el textarea existente antes de emitir/actualizar — igual que hoy funciona `buildDefaultDidDocument()` en `IssuerPanel.tsx`.

Sobre la tercera fuente divergente (`resolveDid()` usando `record.did` como su propio controller): se recomienda unificarla en este mismo scope, no diferirla. La razón es que dejarla como está introduciría una CUARTA inconsistencia sumada a la que esta feature busca resolver — tendríamos `controller` explícito y persistido en `did_records`, pero el endpoint de resolución pública seguiría ignorándolo y devolviendo un valor distinto y hardcodeado. `resolveDid()` ya construye su DID Document de forma sintética (no reutiliza el `did_document` JSON almacenado; arma un objeto mínimo con `@context`, `id`, `service`, `organization`), así que el cambio es acotado: agregar `dr.controller` al `select` y usar `controller: record.controller || record.did` (fallback defensivo solo para filas legacy sin valor migrado). No se identificó ninguna razón técnica de peso para excluir este cambio del scope.

## Affected Areas

| Area | Impact | Description |
|------|--------|--------------|
| `src/types/did.ts` | Modified | Agrega campo `controller?: string` a `DidRecord`, `RequestDidInput`, `IssueDidInput`, `UpdateDidInput` |
| `src/components/RequestForm.tsx` | Modified | Nuevo state `controller` independiente de `agentAddress`; default-poblado desde `walletAddress`; editable |
| `src/components/IssuerPanel.tsx` | Modified | `buildDefaultDidDocument()` usa el nuevo campo `controller` explícito en vez de `targetSubjectWalletAddress`/`record.subjectWalletAddress` |
| `src/lib/did/app-api.ts` | Modified | `requestDidWithSync`/`issueDidWithSync` propagan `controller` hasta `mergeDidMetadata()` y persistencia Postgres |
| `server/schema.sql` | Modified | Nueva columna `controller text` en `did_requests` y `did_records` vía `alter table ... add column if not exists` |
| `src/lib/did/request-document.js` | Modified | Deja de derivar `controller` de `subject_wallet_address`; usa el campo explícito recibido |
| `server/mcp-core.js` | Modified | Ajusta de qué valor server-side deriva `controller` en `platformGeneratedDidFields`; mantiene el patrón de que el llamador MCP no lo envía |
| `server/registry-service.js` | Modified | `resolveDid()` (línea ~1698) deja de hardcodear `controller: record.did`; lee el valor explícito persistido con fallback a `record.did` |
| `README.md` | Modified | Nueva subsección documentando que `controller` es metadata informativa sin efecto de autorización |
| `contracts/did_registry.compact` / `.compact.template` | None | Sin cambios — el modelo on-chain de controller ya es correcto |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Confusión residual si algún consumidor externo del DID Document interpreta `controller` como fuente de autorización pese a la nueva documentación | Low | La nueva subsección de README es explícita y se ubica junto a las secciones de autorización existentes; considerar en el technical spec si agregar una nota inline en el propio JSON generado (ej. campo de metadata adicional) |
| Registros legacy sin `controller` persistido devuelven un valor distinto post-cambio en `resolveDid()` si no se aplica el fallback correctamente | Low | Fallback explícito a `record.did` para filas con `controller` nulo, cubierto en Approach |
| Cambio de `resolveDid()` rompe algún consumidor que ya depende del valor actual `controller: record.did` | Low | El campo sigue siendo un string DID válido en el caso legacy (fallback); solo cambia para registros nuevos con `controller` explícito distinto — comportamiento esperado y deseado |
| Migración de columna nueva en `did_requests`/`did_records` sobre datos en producción | Low | Se usa el patrón idempotente ya establecido (`add column if not exists`), columna nullable, sin backfill destructivo |

## Rollback Plan

Revert de git de los commits de la feature. La migración de schema (`alter table add column if not exists controller`) es aditiva y no destructiva — no requiere rollback de datos; la columna puede quedar sin uso si se revierte el código de aplicación. No hay migración de datos existente que deshacer.

## Dependencies

- Ninguna dependencia externa. Depende del modelo de autorización coin-gated ya implementado (`sdd/wip/005-coin-gated-admin-access`), pero no lo modifica ni bloquea sobre él.

## Success Criteria

- [ ] `controller` existe como campo propio en tipos, UI, API cliente y schema, desacoplado de `subjectWalletAddress`.
- [ ] El campo `controller` en la UI se auto-puebla desde la wallet humana conectada y es editable antes de emitir/actualizar un DID.
- [ ] `subjectWalletAddress` no cambia de nombre ni de comportamiento en ningún flujo existente.
- [ ] `resolveDid()` devuelve el `controller` explícito persistido (con fallback documentado para registros legacy), eliminando la divergencia con las demás fuentes.
- [ ] README documenta explícitamente que `controller` es metadata informativa sin efecto de autorización, y remite al modelo real de autorización on-chain ya documentado.
