import "./load-env.js";
import { createServer } from "http";
import { URL, fileURLToPath } from "url";
import { initializeDatabase, query } from "./db.js";
import { getRecentLogs, installProcessLogger } from "./log-store.js";
import {
  approveDidRequestByHuman,
  bootstrapDemoCustomer,
  createCustomer,
  createCustomerMcpKey,
  createDidRequest,
  createWalletDidRequest,
  createSubscription,
  recordActionTokenGrant,
  revokeCustomerMcpKey,
  updateCustomerMcpKeyScopes,
  getLatestAdminRegistryDeployment,
  getCustomerByWallet,
  getDidRequestById,
  getPersistedDidState,
  listRegistryDidRecords,
  issueApprovedDidRequest,
  linkWallet,
  listDidRequests,
  listAdminRegistryDeployments,
  rejectDidRequestByAdmin,
  rejectDidRequestByHuman,
  resolveDid,
  saveAdminRegistryDeployment,
  syncWalletIssuedDid,
  syncWalletRevokedDid,
  syncWalletUpdatedDid,
  validateDid,
} from "./registry-service.js";
import {
  assembleUnifiedVP,
  getCredentialBundle,
  getIssuerDescriptor,
  getMidnightProofMaterial,
  listCredentialsForDid,
  rotateCredentialsForDid,
  verifyCredentialJwt,
} from "./vc-service.js";
import {
  createMidnightProofRequest,
  verifyMidnightProofSubmission,
  verifyUnifiedVP,
} from "./midnight-proof-service.js";
import {
  approveProofRequestByHuman,
  createProofRequestForAgent,
  createProofRequestForWallet,
  deleteProofRequest,
  getProofRequestById,
  listProofRequests,
  rejectProofRequestByHuman,
  submitProofForRequest,
} from "./proof-request-service.js";
import {
  getClientIp,
  isOriginAllowed,
  normalizeWallet,
  parseRequestPath,
  readJson,
  RequestBodyError,
  sendJson,
  sendText,
  setCorsHeaders,
} from "./utils.js";
import {
  AuthError,
  createSessionFromSignature,
  issueNonce,
  validateSession,
} from "./session-service.js";

const PORT = Number(process.env.PORT || process.env.DID_API_PORT || 8787);
const HOST = (process.env.DID_API_HOST || "127.0.0.1").trim();
const DB_INIT_ATTEMPTS = Number(process.env.DID_API_DB_INIT_ATTEMPTS || 12);
const DB_INIT_RETRY_MS = Number(process.env.DID_API_DB_INIT_RETRY_MS || 2500);

installProcessLogger("backend");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableDatabaseStartupError(error) {
  const code = error && typeof error === "object" ? error.code : "";
  return [
    "ECONNREFUSED",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "ETIMEDOUT",
    "EAI_AGAIN",
    "EPERM",
  ].includes(code);
}

async function initializeDatabaseWithRetry() {
  for (let attempt = 1; attempt <= DB_INIT_ATTEMPTS; attempt += 1) {
    try {
      await initializeDatabase();
      return;
    } catch (error) {
      if (attempt >= DB_INIT_ATTEMPTS || !isRetryableDatabaseStartupError(error)) {
        throw error;
      }
      const code = error && typeof error === "object" ? error.code : "unknown";
      console.warn(
        `[did-api] database not reachable yet (${code}); retrying ${attempt}/${DB_INIT_ATTEMPTS - 1} in ${DB_INIT_RETRY_MS}ms`,
      );
      await wait(DB_INIT_RETRY_MS);
    }
  }
}

// Code review follow-up (feature 007, post-verify): the shared-secret
// X-DID-API-Key header was the ADR-005 predecessor to session-token bearer
// auth and was retired as a hard cutover, no dual-accept window. This
// function now only reads Authorization: Bearer, matching
// src/utils/serviceApi.ts, which already only ever sends that header.
function getApiAuthToken(req) {
  const authHeader = req.headers.authorization || "";
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim();
  }
  return "";
}

// (d) The agent routes used to accept the MCP key from either the X-MCP-Key
// header or a `mcpKey` field in the JSON body. Request bodies end up in access
// logs, error reports, proxy buffers and browser devtools far more readily
// than headers do, so a long-lived credential should never travel there. The
// body form is no longer honoured.
//
// Callers still sending it get a warning line rather than a silent failure, so
// a lingering integration is visible in the logs instead of just breaking. The
// key itself is never logged.
function getAgentMcpKey(req, body) {
  if (body && typeof body === "object" && body.mcpKey) {
    console.warn(
      "[backend] ignoring mcpKey supplied in the request body — send the X-MCP-Key header instead",
    );
  }
  const headerKey = req.headers["x-mcp-key"];
  return typeof headerKey === "string" ? headerKey.trim() : "";
}

function isPublicApiRoute(req, url, parts) {
  if (req.method === "OPTIONS") return true;
  if (req.method === "GET" && url.pathname === "/health") return true;
  if (req.method === "GET" && url.pathname === "/api/issuer") return true;
  if (req.method === "GET" && url.pathname === "/api/dids/resolve") return true;
  if (req.method === "GET" && url.pathname === "/api/dids/validate") return true;
  if (req.method === "POST" && url.pathname === "/api/vps/verify") return true;
  if (req.method === "POST" && url.pathname === "/api/vcs/verify") return true;
  if (req.method === "POST" && url.pathname === "/api/vps/midnight/verify") return true;
  if (req.method === "POST" && url.pathname === "/api/agent/did-requests") return true;
  if (req.method === "POST" && url.pathname === "/api/agent/proof-requests") return true;
  if (req.method === "POST" && url.pathname === "/api/auth/nonce") return true;
  if (req.method === "POST" && url.pathname === "/api/auth/session") return true;
  return false;
}

// OWASP A04 follow-up (security scan on tasks 1-3): POST /api/auth/nonce is
// unauthenticated by design (that's the whole point of a login challenge),
// so it must be rate-limited or an attacker can flood auth_nonces for an
// arbitrary declared wallet address. Fixed-window counter keyed by the
// declared wallet address (plus source IP when available) — an in-process
// Map with a TTL-equivalent window reset is sufficient here since what's
// being protected is a burst of unrateLimited nonce rows, not session
// validity (nonces are single-use and short-lived regardless).
//
// code review + security scan follow-up (tasks 7-8): the wallet address in
// the per-wallet bucket key is *client-declared* and unverified at this
// point (real proof of possession only happens later, in
// createSessionFromSignature) — it just has to match WALLET_ADDRESS_PATTERN.
// A single attacker IP can therefore roll a fresh, well-formed-but-arbitrary
// wallet address on every request and get a brand-new per-wallet bucket
// every time, sidestepping NONCE_RATE_LIMIT_MAX_REQUESTS entirely. A second,
// coarser limiter keyed by source IP alone (independent of any declared
// wallet) closes that gap; both limiters must pass. Same finding also
// pointed out these Maps are never pruned — every call now sweeps expired
// buckets out of both maps first, bounding their size to the number of
// distinct keys seen within the last rate-limit window.
const NONCE_RATE_LIMIT_WINDOW_MS = 60_000;
const NONCE_RATE_LIMIT_MAX_REQUESTS = 5;
const NONCE_IP_RATE_LIMIT_MAX_REQUESTS = 20;
const nonceRateLimitBuckets = new Map();
const nonceIpRateLimitBuckets = new Map();

function pruneExpiredRateLimitBuckets(buckets, now) {
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart >= NONCE_RATE_LIMIT_WINDOW_MS) {
      buckets.delete(key);
    }
  }
}

function checkAndBumpRateLimitBucket(buckets, key, now, maxRequests) {
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= NONCE_RATE_LIMIT_WINDOW_MS) {
    buckets.set(key, { count: 1, windowStart: now });
    return false;
  }
  bucket.count += 1;
  return bucket.count > maxRequests;
}

function isNonceRateLimited(walletAddress, remoteAddress) {
  const now = Date.now();
  pruneExpiredRateLimitBuckets(nonceRateLimitBuckets, now);
  pruneExpiredRateLimitBuckets(nonceIpRateLimitBuckets, now);

  const walletKey = `${normalizeWallet(walletAddress)}|${remoteAddress || ""}`;
  // Evaluate (and bump) both limiters unconditionally rather than
  // short-circuiting, so the IP-wide budget is always charged for the
  // request regardless of which limiter, if either, ultimately denies it.
  const walletLimited = checkAndBumpRateLimitBucket(
    nonceRateLimitBuckets,
    walletKey,
    now,
    NONCE_RATE_LIMIT_MAX_REQUESTS,
  );
  const ipLimited = checkAndBumpRateLimitBucket(
    nonceIpRateLimitBuckets,
    remoteAddress || "",
    now,
    NONCE_IP_RATE_LIMIT_MAX_REQUESTS,
  );
  return walletLimited || ipLimited;
}

// Security scan follow-up (final gate, feature 007): POST /api/auth/session
// had no rate limiting of its own — only /api/auth/nonce did. A nonce
// obtained through the (already-limited) nonce endpoint stays valid for its
// whole DID_AUTH_NONCE_TTL_SECONDS window, and an attacker who has a nonce
// (or even a bogus/never-issued one) could hammer this endpoint with
// arbitrary signature attempts for the rest of that window with no cap at
// all — each attempt runs real signature-verification crypto
// (verifySignature) inside createSessionFromSignature, so this was an
// unauthenticated, uncapped CPU-amplification vector (OWASP A04). There is
// no cleanly-declared wallet available at this point in the request (the
// wallet is only known *after* signature verification succeeds), so unlike
// isNonceRateLimited this limiter is IP-only. The threshold is looser than
// the nonce limiter's (10/60s vs 5/60s) since a legitimate login may need a
// retry or two after a typo'd signature, but still far short of "unlimited".
// Reuses the exact same bucket/prune/check helpers as the nonce limiter.
const SESSION_RATE_LIMIT_MAX_REQUESTS = 10;
const sessionRateLimitBuckets = new Map();

function isSessionRateLimited(remoteAddress) {
  const now = Date.now();
  pruneExpiredRateLimitBuckets(sessionRateLimitBuckets, now);
  return checkAndBumpRateLimitBucket(
    sessionRateLimitBuckets,
    remoteAddress || "",
    now,
    SESSION_RATE_LIMIT_MAX_REQUESTS,
  );
}

// The rest of isPublicApiRoute's surface was unauthenticated AND uncapped.
// /api/vps/verify, /api/vcs/verify and /api/vps/midnight/verify each run real
// signature and proof verification, so they are the same unauthenticated
// CPU-amplification vector isSessionRateLimited was added for; /api/dids/*
// and /api/issuer are cheaper but still anonymous database reads. Since these
// carry no credential, source IP is the only key available — which is a weak
// key behind CGNAT or a botnet, so these limits are an abuse brake, not an
// access control. The credential on each non-public route remains the real
// gate. Same window, buckets and prune helpers as the limiters above.
//
// /health is deliberately absent: Render polls it for liveness and must never
// be throttled. /api/auth/nonce and /api/auth/session are absent because they
// already have dedicated limiters and should not be charged twice.
const PUBLIC_COMPUTE_RATE_LIMITS = {
  "/api/vps/verify": 10,
  "/api/vcs/verify": 10,
  "/api/vps/midnight/verify": 10,
  "/api/dids/resolve": 30,
  "/api/dids/validate": 30,
  "/api/issuer": 30,
};
const publicComputeRateLimitBuckets = new Map();

function isPublicComputeRateLimited(pathname, remoteAddress) {
  const maxRequests = PUBLIC_COMPUTE_RATE_LIMITS[pathname];
  if (maxRequests === undefined) return false;

  const now = Date.now();
  pruneExpiredRateLimitBuckets(publicComputeRateLimitBuckets, now);
  // Per-route budget: exhausting the verify quota must not also lock out
  // did resolution for the same caller.
  return checkAndBumpRateLimitBucket(
    publicComputeRateLimitBuckets,
    `${pathname}|${remoteAddress || ""}`,
    now,
    maxRequests,
  );
}

// OWASP A09 follow-up (security scan on tasks 4-6): createSessionFromSignature
// wrote no audit trail on success or failure. Rather than teach
// session-service.js about audit_events directly (its failure paths run
// mostly *before* any withTransaction block, and the one failure detected
// *inside* the transaction would have its audit row rolled back along with
// everything else), the HTTP layer records the event here — same
// audit_events table/columns already used by registry-service.js's and
// proof-request-service.js's local `audit()` helpers, just invoked with the
// plain `query()` export instead of a transaction client.
async function auditAuthEvent(input) {
  try {
    await query(
      `insert into audit_events (actor_type, actor_ref, event_type, entity_type, entity_id, event_data)
       values ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        input.actorType,
        input.actorRef,
        input.eventType,
        input.entityType,
        input.entityId,
        JSON.stringify(input.eventData || {}),
      ],
    );
  } catch (auditError) {
    // Best-effort: a failure to record an audit row must never turn an
    // otherwise-successful (or otherwise-correctly-rejected) auth attempt
    // into a 500.
    console.error("[did-api] failed to record auth audit event", auditError);
  }
}

function declaredWalletFromSignatureData(signature) {
  try {
    const parsed = JSON.parse(String(signature?.data || ""));
    return normalizeWallet(parsed && typeof parsed === "object" ? parsed.walletAddress : "");
  } catch {
    return "";
  }
}

// Replaces the old shared-secret requireApiAuth (ADR-005): validates the
// bearer token (still extracted via the unchanged getApiAuthToken) against
// session-service.validateSession instead of a static DID_API_AUTH_TOKEN
// comparison. Idempotent per request — if req.session is already populated
// by an earlier call in the same request (the top-level gate), a second
// call with { admin: true } at an admin route reuses it instead of
// re-validating the token against the database a second time.
async function requireSession(req, res, url, parts, { admin = false } = {}) {
  if (isPublicApiRoute(req, url, parts)) return true;

  if (!req.session) {
    const token = getApiAuthToken(req);
    const session = await validateSession(token);
    if (!session) {
      sendJson(res, 401, {
        ok: false,
        error: "unauthorized",
        message: "Missing or invalid session.",
      }, req);
      return false;
    }
    req.session = session;
  }

  if (admin) {
    const adminConfigured = String(process.env.DID_ADMIN_WALLET_ADDRESS || "").trim();
    if (!adminConfigured) {
      sendJson(res, 503, {
        ok: false,
        error: "admin_auth_not_configured",
        message: "DID_ADMIN_WALLET_ADDRESS is required for admin routes.",
      }, req);
      return false;
    }
    if (!req.session.isAdmin) {
      sendJson(res, 403, {
        ok: false,
        error: "forbidden",
        message: "Administrator session required.",
      }, req);
      return false;
    }
  }

  return true;
}

const server = createServer(async (req, res) => {
  if (!req.url || !req.method) {
    sendText(res, 400, "Invalid request", req);
    return;
  }

  // Defense in depth against browser-driven cross-site abuse. CORS alone only
  // stops the browser from *reading* the response — by then the request has
  // already executed here. This refuses ahead of every route, preflight
  // included. It is deliberately not a perimeter control: a non-browser client
  // can set any Origin it likes, so the real gate on each route is still its
  // credential. Requests with no Origin at all (agents, curl, SDK clients,
  // Render health checks) are unaffected.
  if (!isOriginAllowed(req)) {
    console.warn(`[backend] rejected disallowed Origin: ${req.headers.origin}`);
    sendJson(res, 403, {
      ok: false,
      error: "forbidden_origin",
      message: "Request Origin is not allowed.",
    }, req);
    return;
  }

  if (req.method === "OPTIONS") {
    setCorsHeaders(res, req);
    res.statusCode = 204;
    res.end("");
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const parts = parseRequestPath(url.pathname);
  console.info(`[backend] ${req.method} ${url.pathname}`);

  // (b) Unauthenticated compute endpoints are the real abuse surface: they run
  // DB reads and signature/proof verification for anyone, with no credential to
  // revoke. /health is excluded so Render's health checks never trip it, and
  // the two /api/auth/* routes keep their own dedicated limiters rather than
  // being charged twice here.
  if (isPublicComputeRateLimited(url.pathname, getClientIp(req))) {
    sendJson(res, 429, {
      ok: false,
      error: "rate_limited",
      message: "Too many requests for this endpoint. Try again shortly.",
    }, req);
    return;
  }

  try {
    if (!(await requireSession(req, res, url, parts))) {
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, {
        ok: true,
        time: new Date().toISOString(),
      }, req);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/nonce") {
      const body = await readJson(req);
      const walletAddress = String(body.walletAddress || "");
      if (isNonceRateLimited(walletAddress, getClientIp(req))) {
        sendJson(res, 429, {
          ok: false,
          error: "rate_limited",
          message: "Too many challenge requests. Try again shortly.",
        }, req);
        return;
      }
      try {
        const result = await issueNonce(walletAddress);
        sendJson(res, 200, result, req);
      } catch (error) {
        // Expected validation failure (session-service.issueNonce throws a
        // typed AuthError for a malformed/empty wallet address): safe to
        // echo back to the caller, same as before this fix. Anything else
        // (e.g. a Postgres error out of the `insert into auth_nonces`
        // call) is unexpected and must not leak internal detail to this
        // unauthenticated, public route — rethrow so it's handled by the
        // general catch-all below, which already redacts `error.message`
        // per `process.env.NODE_ENV` (same pattern as every other
        // unhandled error in this file).
        if (error instanceof AuthError) {
          sendJson(res, error.statusCode, {
            ok: false,
            error: error.code,
            message: error.message,
          }, req);
          return;
        }
        throw error;
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/session") {
      if (isSessionRateLimited(getClientIp(req))) {
        sendJson(res, 429, {
          ok: false,
          error: "rate_limited",
          message: "Too many session exchange attempts. Try again shortly.",
        }, req);
        return;
      }
      const body = await readJson(req);
      try {
        const result = await createSessionFromSignature({ signature: body.signature });
        await auditAuthEvent({
          actorType: "wallet",
          actorRef: result.walletAddress,
          eventType: "auth_session_created",
          entityType: "auth_session",
          entityId: result.walletAddress,
          eventData: { isAdmin: result.isAdmin },
        });
        sendJson(res, 200, result, req);
      } catch (error) {
        if (error instanceof AuthError) {
          const declaredWallet = declaredWalletFromSignatureData(body?.signature);
          await auditAuthEvent({
            actorType: "wallet",
            actorRef: declaredWallet || "unknown",
            eventType: "auth_session_denied",
            entityType: "auth_session",
            entityId: declaredWallet || "unknown",
            eventData: { reason: error.code },
          });
          sendJson(res, error.statusCode, {
            ok: false,
            error: error.code,
            message: error.message,
          }, req);
          return;
        }
        throw error;
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/admin/logs") {
      if (!(await requireSession(req, res, url, parts, { admin: true }))) {
        return;
      }
      sendJson(res, 200, {
        entries: getRecentLogs(Number(url.searchParams.get("limit") || "200")),
      }, req);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/customers") {
      sendJson(res, 201, await createCustomer(await readJson(req)));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/customers/by-wallet") {
      const walletAddress = url.searchParams.get("walletAddress") || "";
      const customer = await getCustomerByWallet(walletAddress);
      if (!customer) {
        sendText(res, 404, "Customer not found");
        return;
      }
      sendJson(res, 200, customer);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/demo/bootstrap") {
      sendJson(res, 201, await bootstrapDemoCustomer(await readJson(req)));
      return;
    }

    if (req.method === "POST" && parts[0] === "api" && parts[1] === "customers" && parts[3] === "wallets") {
      const body = await readJson(req);
      sendJson(
        res,
        201,
        await linkWallet({
          customerId: parts[2],
          walletAddress: body.walletAddress,
          isPrimary: body.isPrimary,
          autoApprove: body.autoApprove,
        }),
      );
      return;
    }

    if (req.method === "POST" && parts[0] === "api" && parts[1] === "customers" && parts[3] === "subscriptions") {
      const body = await readJson(req);
      sendJson(
        res,
        201,
        await createSubscription({
          customerId: parts[2],
          planCode: body.planCode,
          didQuotaTotal: body.didQuotaTotal,
          status: body.status,
          endsAt: body.endsAt,
        }),
      );
      return;
    }

    if (req.method === "POST" && parts[0] === "api" && parts[1] === "customers" && parts[3] === "action-token-grants") {
      const body = await readJson(req);
      sendJson(
        res,
        201,
        await recordActionTokenGrant({
          customerId: parts[2],
          subscriptionId: body.subscriptionId,
          tokenContractAddress: body.tokenContractAddress,
          networkId: body.networkId,
          recipientShieldedAddress: body.recipientShieldedAddress,
          subscriptionKeyHex: body.subscriptionKeyHex,
          creditsGranted: body.creditsGranted,
          creditsUsed: body.creditsUsed,
          mintTxHash: body.mintTxHash,
          mintTxId: body.mintTxId,
          actorRef: body.actorRef,
          status: body.status,
        }),
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/action-token-grants") {
      const body = await readJson(req);
      sendJson(
        res,
        201,
        await recordActionTokenGrant({
          customerId: body.customerId,
          customerRef: body.customerRef,
          subscriptionId: body.subscriptionId,
          tokenContractAddress: body.tokenContractAddress,
          networkId: body.networkId,
          recipientShieldedAddress: body.recipientShieldedAddress,
          subscriptionKeyHex: body.subscriptionKeyHex,
          creditsGranted: body.creditsGranted,
          creditsUsed: body.creditsUsed,
          mintTxHash: body.mintTxHash,
          mintTxId: body.mintTxId,
          actorRef: body.actorRef,
          status: body.status,
        }),
      );
      return;
    }

    if (
      req.method === "POST" &&
      parts[0] === "api" &&
      parts[1] === "customers" &&
      parts[3] === "mcp-keys" &&
      parts[5] === "revoke"
    ) {
      sendJson(
        res,
        200,
        await revokeCustomerMcpKey({
          customerId: parts[2],
          keyId: parts[4],
        }),
      );
      return;
    }

    if (
      req.method === "POST" &&
      parts[0] === "api" &&
      parts[1] === "customers" &&
      parts[3] === "mcp-keys" &&
      parts.length === 4
    ) {
      const body = await readJson(req);
      sendJson(
        res,
        201,
        await createCustomerMcpKey({
          customerId: parts[2],
          label: body.label || "default-agent-key",
          scopes: body.scopes,
          expiresAt: body.expiresAt,
          networkId: body.networkId,
        }),
      );
      return;
    }

    if (
      req.method === "POST" &&
      parts[0] === "api" &&
      parts[1] === "customers" &&
      parts[3] === "mcp-keys" &&
      parts[5] === "scopes"
    ) {
      const body = await readJson(req);
      sendJson(
        res,
        200,
        await updateCustomerMcpKeyScopes({
          customerId: parts[2],
          keyId: parts[4],
          scopes: body.scopes,
        }),
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/agent/did-requests") {
      const body = await readJson(req);
      sendJson(
        res,
        201,
        await createDidRequest({
          ...body,
          mcpKey: getAgentMcpKey(req, body),
        }),
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/agent/proof-requests") {
      const body = await readJson(req);
      sendJson(
        res,
        201,
        await createProofRequestForAgent({
          ...body,
          mcpKey: getAgentMcpKey(req, body),
        }),
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/wallet/did-requests") {
      sendJson(res, 201, await createWalletDidRequest(await readJson(req)));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/wallet/proof-requests") {
      sendJson(res, 201, await createProofRequestForWallet(await readJson(req)));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/wallet/did-state") {
      sendJson(
        res,
        200,
        await getPersistedDidState({
          contractAddress: url.searchParams.get("contractAddress") || "",
          walletAddress: url.searchParams.get("walletAddress") || "",
          agentId: url.searchParams.get("agentId") || "",
        }),
      );
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/did-requests") {
      sendJson(
        res,
        200,
        await listDidRequests({
          customerId: url.searchParams.get("customerId") || undefined,
          status: url.searchParams.get("status") || undefined,
        }),
      );
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/proof-requests") {
      sendJson(
        res,
        200,
        await listProofRequests({
          customerId: url.searchParams.get("customerId") || undefined,
          status: url.searchParams.get("status") || undefined,
        }),
      );
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/registry/dids") {
      sendJson(
        res,
        200,
        await listRegistryDidRecords(
          url.searchParams.get("contractAddress") || "",
        ),
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/admin/registry-deployments") {
      if (!(await requireSession(req, res, url, parts, { admin: true }))) {
        return;
      }
      const body = await readJson(req);
      sendJson(
        res,
        201,
        await saveAdminRegistryDeployment({
          ...body,
          deployerWalletAddress: req.session.walletAddress,
        }),
      );
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/admin/registry-deployments/latest") {
      if (!(await requireSession(req, res, url, parts, { admin: true }))) {
        return;
      }
      sendJson(
        res,
        200,
        await getLatestAdminRegistryDeployment({
          networkId: url.searchParams.get("networkId") || undefined,
          deployerWalletAddress:
            url.searchParams.get("deployerWalletAddress") || undefined,
        }),
      );
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/admin/registry-deployments") {
      if (!(await requireSession(req, res, url, parts, { admin: true }))) {
        return;
      }
      sendJson(
        res,
        200,
        await listAdminRegistryDeployments({
          networkId: url.searchParams.get("networkId") || undefined,
          deployerWalletAddress:
            url.searchParams.get("deployerWalletAddress") || undefined,
        }),
      );
      return;
    }

    if (req.method === "GET" && parts[0] === "api" && parts[1] === "did-requests" && parts[2]) {
      const request = await getDidRequestById(parts[2]);
      if (!request) {
        sendText(res, 404, "DID request not found");
        return;
      }
      sendJson(res, 200, request);
      return;
    }

    if (req.method === "GET" && parts[0] === "api" && parts[1] === "proof-requests" && parts[2]) {
      const proofRequest = await getProofRequestById(parts[2]);
      if (!proofRequest) {
        sendText(res, 404, "Proof request not found");
        return;
      }
      sendJson(res, 200, proofRequest);
      return;
    }

    if (req.method === "POST" && parts[0] === "api" && parts[1] === "human" && parts[2] === "did-requests" && parts[4] === "approve") {
      const body = await readJson(req);
      sendJson(
        res,
        200,
        await approveDidRequestByHuman({
          requestId: parts[3],
          humanWalletAddress: req.session.walletAddress,
          requestedDid: body.requestedDid,
          onchainRequestTxId: body.onchainRequestTxId,
          onchainRequestTxHash: body.onchainRequestTxHash,
        }),
      );
      return;
    }

    if (req.method === "POST" && parts[0] === "api" && parts[1] === "human" && parts[2] === "did-requests" && parts[4] === "reject") {
      const body = await readJson(req);
      sendJson(
        res,
        200,
        await rejectDidRequestByHuman({
          requestId: parts[3],
          humanWalletAddress: req.session.walletAddress,
          reason: body.reason,
        }),
      );
      return;
    }

    if (req.method === "POST" && parts[0] === "api" && parts[1] === "human" && parts[2] === "proof-requests" && parts[4] === "approve") {
      const body = await readJson(req);
      sendJson(
        res,
        200,
        await approveProofRequestByHuman({
          proofRequestId: parts[3],
          humanWalletAddress: req.session.walletAddress,
          holderSignature: body.holderSignature,
        }),
      );
      return;
    }

    if (req.method === "POST" && parts[0] === "api" && parts[1] === "human" && parts[2] === "proof-requests" && parts[4] === "reject") {
      const body = await readJson(req);
      sendJson(
        res,
        200,
        await rejectProofRequestByHuman({
          proofRequestId: parts[3],
          humanWalletAddress: req.session.walletAddress,
          reason: body.reason,
        }),
      );
      return;
    }

    if (req.method === "POST" && parts[0] === "api" && parts[1] === "admin" && parts[2] === "did-requests" && parts[4] === "issue") {
      if (!(await requireSession(req, res, url, parts, { admin: true }))) {
        return;
      }
      const body = await readJson(req);
      sendJson(
        res,
        200,
        await issueApprovedDidRequest({
          requestId: parts[3],
          issuerWalletAddress: req.session.walletAddress,
          didDocument: body.didDocument,
          onchainRequestTxId: body.onchainRequestTxId,
          onchainRequestTxHash: body.onchainRequestTxHash,
          claimsManifest: body.claimsManifest,
          onchainIssueTxId: body.onchainIssueTxId,
          onchainIssueTxHash: body.onchainIssueTxHash,
          didCommitment: body.didCommitment,
          documentCommitment: body.documentCommitment,
          proofCommitment: body.proofCommitment,
        }),
      );
      return;
    }

    if (req.method === "DELETE" && parts[0] === "api" && parts[1] === "admin" && parts[2] === "proof-requests" && parts[3]) {
      if (!(await requireSession(req, res, url, parts, { admin: true }))) {
        return;
      }
      sendJson(
        res,
        200,
        await deleteProofRequest({
          proofRequestId: parts[3],
          adminWalletAddress: req.session.walletAddress,
        }),
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/wallet/dids/issue-sync") {
      sendJson(res, 200, await syncWalletIssuedDid(await readJson(req)));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/wallet/dids/update-sync") {
      sendJson(res, 200, await syncWalletUpdatedDid(await readJson(req)));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/wallet/dids/revoke-sync") {
      sendJson(res, 200, await syncWalletRevokedDid(await readJson(req)));
      return;
    }

    if (req.method === "POST" && parts[0] === "api" && parts[1] === "admin" && parts[2] === "did-requests" && parts[4] === "reject") {
      if (!(await requireSession(req, res, url, parts, { admin: true }))) {
        return;
      }
      const body = await readJson(req);
      sendJson(
        res,
        200,
        await rejectDidRequestByAdmin({
          requestId: parts[3],
          adminWalletAddress: req.session.walletAddress,
          reason: body.reason,
        }),
      );
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/dids/resolve") {
      const did = url.searchParams.get("did") || "";
      const result = await resolveDid(did);
      if (!result) {
        sendText(res, 404, "DID not found");
        return;
      }
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/dids/validate") {
      const did = url.searchParams.get("did") || "";
      sendJson(res, 200, await validateDid(did));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/issuer") {
      sendJson(res, 200, await getIssuerDescriptor());
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/vcs/by-did") {
      const did = url.searchParams.get("did") || "";
      sendJson(res, 200, await listCredentialsForDid(did));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/vcs/bundle") {
      const body = await readJson(req);

      if (body.holderSignatureEnvelope) {
        sendJson(res, 400, {
          ok: false,
          failure_layer: "structural",
          message: "holderSignatureEnvelope is no longer supported. Use POST /api/vps/assemble to obtain a UnifiedVerifiablePresentation.",
        });
        return;
      }

      const bundle = await getCredentialBundle({
        did: body.did,
        scopes: body.scopes,
      });
      sendJson(res, 200, bundle);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/vcs/rotate") {
      const body = await readJson(req);
      sendJson(
        res,
        200,
        await rotateCredentialsForDid({
          did: body.did,
        }),
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/vcs/midnight-proof") {
      const body = await readJson(req);
      sendJson(
        res,
        200,
        await getMidnightProofMaterial({
          did: body.did,
          scopes: body.scopes,
          challenge: body.challenge,
          verifier: body.verifier,
          purpose: body.purpose,
        }),
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/vps/midnight/request") {
      const body = await readJson(req);
      sendJson(
        res,
        200,
        await createMidnightProofRequest({
          did: body.did,
          scopes: body.scopes,
          challenge: body.challenge,
          verifier: body.verifier,
          purpose: body.purpose,
        }),
      );
      return;
    }

    if (req.method === "POST" && parts[0] === "api" && parts[1] === "proof-requests" && parts[3] === "submit") {
      const body = await readJson(req);
      sendJson(
        res,
        200,
        await submitProofForRequest({
          proofRequestId: parts[2],
          submission: body.submission,
        }),
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/vps/midnight/verify") {
      const body = await readJson(req);
      const submission = body.submission
        ? { ...body.submission, coinPublicKey: body.coinPublicKey ?? body.submission.coinPublicKey }
        : body.submission;
      const verification = await verifyMidnightProofSubmission({
        proofRequest: body.proofRequest,
        submission,
      });
      sendJson(res, 200, verification);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/vcs/verify") {
      const body = await readJson(req);
      sendJson(res, 200, await verifyCredentialJwt(body.jwt));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/vps/assemble") {
      const body = await readJson(req);
      const { did, scopes, challenge, verifier, purpose, submission } = body;
      if (!did || !scopes || !challenge || !purpose || !submission) {
        sendJson(res, 400, {
          ok: false,
          failure_layer: "structural",
          message: "Missing required fields: did, scopes, challenge, purpose, submission",
        });
        return;
      }
      const proofRequest = await createMidnightProofRequest({ did, scopes, challenge, verifier, purpose });
      const verification = await verifyMidnightProofSubmission({ proofRequest, submission });
      if (!verification.valid) {
        if (verification.failure_layer === "proof_server_unavailable" || verification.degraded) {
          const { presentation } = await assembleUnifiedVP({
            did,
            scopes,
            challenge,
            verifier,
            purpose,
            proofValue: submission?.proof?.proofValue ?? "",
            publicInputsHash: submission?.proof?.publicInputsHash,
            coinPublicKey: submission?.proof?.coinPublicKey ?? submission?.coinPublicKey ?? "",
            bundleCommitment: submission?.bundleCommitment ?? "",
            holderBindingCommitment: submission?.holderBindingCommitment ?? "",
            disclosedScopes: scopes,
            degraded: true,
          });
          sendJson(res, 200, presentation);
          return;
        }
        sendJson(res, 422, {
          ok: false,
          ...verification,
        });
        return;
      }
      const { presentation } = await assembleUnifiedVP({
        did,
        scopes,
        challenge,
        verifier,
        purpose,
        proofValue: submission?.proof?.proofValue ?? "",
        publicInputsHash: submission?.proof?.publicInputsHash,
        coinPublicKey: submission?.proof?.coinPublicKey ?? submission?.coinPublicKey ?? "",
        bundleCommitment: submission?.bundleCommitment ?? "",
        holderBindingCommitment: submission?.holderBindingCommitment ?? "",
        disclosedScopes: scopes,
      });
      sendJson(res, 200, presentation);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/vps/verify") {
      const body = await readJson(req);
      const result = await verifyUnifiedVP({ vp: body });
      if (!result.valid) {
        const layer = result.failure_layer || result.status;
        const statusCode =
          layer === "structural" || layer === "degraded_proof" ? 400 : 422;
        sendJson(res, statusCode, {
          ok: false,
          valid: false,
          failure_layer: result.failure_layer || result.status || "unknown",
          status: result.status,
          message: result.message || (result.warnings && result.warnings[0]) || "Verification failed.",
          warnings: result.warnings?.length ? result.warnings : undefined,
        });
        return;
      }
      sendJson(res, 200, result);
      return;
    }

    sendText(res, 404, "Not found", req);
  } catch (error) {
    if (error instanceof RequestBodyError) {
      console.warn("[did-api] invalid request body", error.message);
      sendJson(res, error.statusCode, {
        ok: false,
        error: error.code,
        message: error.message,
      }, req);
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    console.error("[did-api] request failed", error);
    sendJson(res, 500, {
      ok: false,
      error: "internal_error",
      message: process.env.NODE_ENV === "development" ? message : "Internal server error.",
    }, req);
  }
});

// Only auto-initialize the database and start listening when this file is
// run directly (`node server/index.js` / `npm run dev:api`), not when it's
// imported — e.g. by tests that need the `server` instance and the auth
// gate functions without triggering a real DB connection or a real listen()
// on import. Production behavior (`node server/index.js`) is unchanged.
const isMainModule =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
  initializeDatabaseWithRetry()
    .then(() => {
      server.listen(PORT, HOST, () => {
        console.log(`[did-api] listening on http://${HOST}:${PORT}`);
      });
    })
    .catch((error) => {
      console.error("[did-api] failed to initialize database", error);
      process.exit(1);
    });
}

export { server, requireSession, isPublicApiRoute };
