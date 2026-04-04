import "./load-env.js";
import { createServer } from "http";
import { URL } from "url";
import { getDatabaseUrl, initializeDatabase } from "./db.js";
import {
  approveDidRequestByHuman,
  bootstrapDemoCustomer,
  createCustomer,
  createCustomerMcpKey,
  createDidRequest,
  createWalletDidRequest,
  createSubscription,
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
  getCredentialBundle,
  getIssuerDescriptor,
  listCredentialsForDid,
  verifyCredentialJwt,
  verifyPresentation,
} from "./vc-service.js";
import {
  parseRequestPath,
  readJson,
  sendJson,
  sendText,
  setCorsHeaders,
} from "./utils.js";

const PORT = Number(process.env.DID_API_PORT || 8787);

const server = createServer(async (req, res) => {
  if (!req.url || !req.method) {
    sendText(res, 400, "Invalid request");
    return;
  }

  if (req.method === "OPTIONS") {
    setCorsHeaders(res);
    res.statusCode = 204;
    res.end("");
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const parts = parseRequestPath(url.pathname);

  try {
    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, {
        ok: true,
        databaseUrl: getDatabaseUrl(),
        time: new Date().toISOString(),
      });
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

    if (req.method === "POST" && parts[0] === "api" && parts[1] === "customers" && parts[3] === "mcp-keys") {
      const body = await readJson(req);
      sendJson(
        res,
        201,
        await createCustomerMcpKey({
          customerId: parts[2],
          label: body.label || "default-agent-key",
          scopes: body.scopes,
          expiresAt: body.expiresAt,
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

    if (req.method === "POST" && url.pathname === "/api/wallet/did-requests") {
      sendJson(res, 201, await createWalletDidRequest(await readJson(req)));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/wallet/did-state") {
      sendJson(
        res,
        200,
        await getPersistedDidState({
          contractAddress: url.searchParams.get("contractAddress") || "",
          walletAddress: url.searchParams.get("walletAddress") || "",
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

    if (req.method === "POST" && parts[0] === "api" && parts[1] === "human" && parts[2] === "did-requests" && parts[4] === "approve") {
      const body = await readJson(req);
      sendJson(
        res,
        200,
        await approveDidRequestByHuman({
          requestId: parts[3],
          humanWalletAddress: body.humanWalletAddress,
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

    if (req.method === "POST" && parts[0] === "api" && parts[1] === "admin" && parts[2] === "did-requests" && parts[4] === "issue") {
      const body = await readJson(req);
      sendJson(
        res,
        200,
        await issueApprovedDidRequest({
          requestId: parts[3],
          issuerWalletAddress: body.issuerWalletAddress,
          didDocument: body.didDocument,
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
      sendJson(
        res,
        200,
        await getCredentialBundle({
          did: body.did,
          scopes: body.scopes,
        }),
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/vcs/verify") {
      const body = await readJson(req);
      sendJson(res, 200, await verifyCredentialJwt(body.jwt));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/vps/verify") {
      const body = await readJson(req);
      sendJson(res, 200, await verifyPresentation(body));
      return;
    }

    sendText(res, 404, "Not found");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 500, {
      ok: false,
      error: message,
    });
  }
});

initializeDatabase()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`[did-api] listening on http://localhost:${PORT}`);
      console.log(`[did-api] database: ${getDatabaseUrl()}`);
    });
  })
  .catch((error) => {
    console.error("[did-api] failed to initialize database", error);
    process.exit(1);
  });
