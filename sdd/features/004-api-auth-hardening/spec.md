# API Auth Hardening

## Functional Requirements

- Private REST routes MUST reject requests without a valid shared token.
  - With no `DID_API_AUTH_TOKEN` configured, private routes MUST respond `503 api_auth_not_configured`.
  - With a configured token and a missing/invalid client token, private routes MUST respond `401 unauthorized`.
- The token MAY be supplied via `X-DID-API-Key: <token>` or `Authorization: Bearer <token>`.
- Public routes MUST remain reachable without a token: `GET /health`, `GET /api/issuer`, `GET /api/dids/resolve`, `GET /api/dids/validate`, `POST /api/vps/verify`, `POST /api/vcs/verify`, `POST /api/vps/midnight/verify`, `POST /api/agent/did-requests`, `POST /api/agent/proof-requests`, and any `OPTIONS` preflight.
- The MCP HTTP `/logs` endpoint MUST require the same token as the REST private routes.
- The frontend MUST attach the configured `VITE_DID_API_AUTH_TOKEN` to every authenticated call, including both backend and MCP log fetches.
- Both servers MUST bind to the configured loopback host by default and MUST allow override via `DID_API_HOST` / `DID_MCP_HOST`.
- CORS responses MUST reflect only origins present in `DID_CORS_ALLOWED_ORIGINS` (default local Vite origins), and every JSON/text response MUST carry the per-origin CORS header.
- JSON request bodies MUST be size-limited (`DID_MAX_JSON_BODY_BYTES`) and malformed/oversized bodies MUST return a structured error without crashing the server.
- Unhandled errors MUST return a generic `internal_error` message unless `NODE_ENV=development`.

## Logs Access Requirement

- The admin Logs view MUST display backend and MCP logs whenever the configured token is valid.
- A failure fetching one log source MUST NOT silently blank the other; both fetches MUST be authenticated so the combined load succeeds under normal configuration.

## Security Notes

The shared token is a coarse gate suitable for this local-development repository. It is not per-user authorization and MUST NOT be treated as production-grade access control. Production deployments should layer real authentication, per-principal authorization, and transport security in front of these services, and keep the services bound to loopback or an internal network unless fronted by an authenticating proxy.
