import "./load-env.js";
import { createServer } from "http";
import { URL } from "url";
import { initializeDatabase } from "./db.js";
import { getRecentLogs, installProcessLogger } from "./log-store.js";
import {
  approveDidRequestByHuman,
  bootstrapDemoCustomer,
  createCustomer,
  createCustomerMcpKey,
  createDidRequest,
  createWalletDidRequest,
  createSubscription,
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
  parseRequestPath,
  readJson,
  RequestBodyError,
  sendJson,
  sendText,
  setCorsHeaders,
} from "./utils.js";

const PORT = Number(process.env.DID_API_PORT || 8787);
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

function getApiAuthToken(req) {
  const headerToken = req.headers["x-did-api-key"];
  if (typeof headerToken === "string" && headerToken.trim()) {
    return headerToken.trim();
  }
  const authHeader = req.headers.authorization || "";
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim();
  }
  return "";
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
  return false;
}

function requireApiAuth(req, res, url, parts) {
  if (isPublicApiRoute(req, url, parts)) return true;
  const expected = String(process.env.DID_API_AUTH_TOKEN || "").trim();
  if (!expected) {
    sendJson(res, 503, {
      ok: false,
      error: "api_auth_not_configured",
      message: "DID_API_AUTH_TOKEN is required for private API routes.",
    }, req);
    return false;
  }
  if (getApiAuthToken(req) !== expected) {
    sendJson(res, 401, {
      ok: false,
      error: "unauthorized",
      message: "Missing or invalid API authorization token.",
    }, req);
    return false;
  }
  return true;
}

const server = createServer(async (req, res) => {
  if (!req.url || !req.method) {
    sendText(res, 400, "Invalid request", req);
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

  try {
    if (!requireApiAuth(req, res, url, parts)) {
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, {
        ok: true,
        time: new Date().toISOString(),
      }, req);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/admin/logs") {
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
      const mcpKey = req.headers["x-mcp-key"] || body.mcpKey;
      sendJson(
        res,
        201,
        await createDidRequest({
          ...body,
          mcpKey,
        }),
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/agent/proof-requests") {
      const body = await readJson(req);
      const mcpKey = req.headers["x-mcp-key"] || body.mcpKey;
      sendJson(
        res,
        201,
        await createProofRequestForAgent({
          ...body,
          mcpKey,
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
      sendJson(res, 201, await saveAdminRegistryDeployment(await readJson(req)));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/admin/registry-deployments/latest") {
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
          humanWalletAddress: body.humanWalletAddress,
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
          humanWalletAddress: body.humanWalletAddress,
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
          humanWalletAddress: body.humanWalletAddress,
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
          humanWalletAddress: body.humanWalletAddress,
          reason: body.reason,
        }),
      );
      return;
    }

    if (req.method === "POST" && parts[0] === "api" && parts[1] === "admin" && parts[2] === "did-requests" && parts[4] === "issue") {
      const body = await readJson(req);
      sendJson(
        res,
        200,
        await issueApprovedDidRequest({
          requestId: parts[3],
          issuerWalletAddress: body.issuerWalletAddress,
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
      const body = await readJson(req).catch(() => ({}));
      sendJson(
        res,
        200,
        await deleteProofRequest({
          proofRequestId: parts[3],
          adminWalletAddress: body.adminWalletAddress,
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
      const body = await readJson(req);
      sendJson(
        res,
        200,
        await rejectDidRequestByAdmin({
          requestId: parts[3],
          adminWalletAddress: body.adminWalletAddress,
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
