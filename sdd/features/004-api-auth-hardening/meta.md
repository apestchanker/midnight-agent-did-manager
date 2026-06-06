# Meta: API Auth Hardening

## Identificacion
- **ID**: 004
- **Slug**: 004-api-auth-hardening
- **Tipo**: corrective-design
- **Estado**: implemented

## Resumen
Endurece los dos servidores HTTP locales (`server/index.js` REST y `server/mcp-http.js` MCP). Las rutas privadas ahora exigen un token compartido (`DID_API_AUTH_TOKEN`) via header `X-DID-API-Key` o `Authorization: Bearer`. Se agrega binding de host configurable (default `127.0.0.1`), allowlist de CORS por origen, limite de tamano de body JSON y mensajes de error genericos fuera de `development`.

## Decision
- Rutas publicas explicitas (health, resolve, validate, verify de VC/VP, intake de agentes) se mantienen sin token.
- El resto de rutas REST y el endpoint MCP `/logs` requieren token; sin `DID_API_AUTH_TOKEN` configurado responden 503, con token invalido 401.
- El frontend envia el token desde `VITE_DID_API_AUTH_TOKEN` en todas las llamadas autenticadas (`requestJson`, `getCustomerByWallet`, `fetchBackendLogs`, `fetchMcpLogs`).
- Ambos servidores escuchan en `DID_API_HOST` / `DID_MCP_HOST` (default loopback) en vez de todas las interfaces.
- CORS responde solo a origenes en `DID_CORS_ALLOWED_ORIGINS` (default `localhost:5173`, `127.0.0.1:5173`).

## Regresion corregida
La primera version del hardening rompio el panel de Logs del admin:
- `fetchMcpLogs` no enviaba `X-DID-API-Key`, por lo que el endpoint MCP `/logs` endurecido respondia 401.
- El panel carga backend + MCP con `Promise.all`, asi que el 401 del MCP rechazaba la promesa combinada y blanqueaba ambos paneles (backend y MCP), no solo el de MCP.

Fix:
- `fetchMcpLogs` ahora adjunta `X-DID-API-Key` cuando `VITE_DID_API_AUTH_TOKEN` esta presente, igual que `fetchBackendLogs`.
- `/api/admin/logs` ahora pasa `req` a `sendJson` para devolver el header CORS correcto por origen.

## Evidencia
- `npm run test`: 147/147 passing.
- `npm run lint`: 0 errores (3 warnings preexistentes de react-hooks).
- `npm run build`: tsc + vite build OK.

## Fechas
- **Creada**: 2026-06-06
- **Implementada**: 2026-06-06
