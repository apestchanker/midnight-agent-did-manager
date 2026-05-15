import { TextEncoder } from "util";
import { addressFromKey, verifySignature } from "@midnight-ntwrk/ledger-v8";
import { MidnightBech32m, UnshieldedAddress } from "@midnight-ntwrk/wallet-sdk-address-format";
import { query, withTransaction } from "./db.js";
import { normalizeWallet, uniqueScopes } from "./utils.js";
import { authenticateMcpKey, getCustomerByWallet } from "./registry-service.js";
import {
  createMidnightProofRequest,
  verifyMidnightProofSubmission,
} from "./midnight-proof-service.js";

function decodeHexToUtf8(value) {
  try {
    return Buffer.from(value, "hex").toString("utf8");
  } catch {
    return value;
  }
}

function normalizeWalletSignatureHex(value, minimumHexLength = 64) {
  const raw = String(value || "").trim();
  if (!/^[0-9a-f]+$/i.test(raw) || raw.length % 2 !== 0) {
    return raw;
  }
  const decoded = decodeHexToUtf8(raw).trim();
  if (/^[0-9a-f]+$/i.test(decoded) && decoded.length >= minimumHexLength) {
    return decoded;
  }
  return raw;
}

function encodeDerivedWalletAddress(rawAddressHex, networkId) {
  try {
    return MidnightBech32m.encode(
      networkId || "preprod",
      new UnshieldedAddress(Buffer.from(rawAddressHex, "hex")),
    ).toString();
  } catch {
    return rawAddressHex;
  }
}

function buildApprovalPayload(material, holderWalletAddress) {
  return JSON.stringify(
    {
      did: material.did,
      challenge: material.challenge,
      purpose: material.purpose,
      verifier: material.verifier || null,
      disclosedScopes: material.disclosedScopes,
      bundleCommitment: material.bundleCommitment,
      holderBindingCommitment: material.holderBindingCommitment,
      holderWalletAddress: normalizeWallet(holderWalletAddress),
    },
    null,
    2,
  );
}

async function findDidRecordForCustomer(client, { did, customerId }) {
  const result = await client.query(
    `select dr.*, req.customer_id
     from did_records dr
     join did_requests req on req.id = dr.request_id
     where dr.did = $1
       and req.customer_id = $2
     limit 1`,
    [did, customerId],
  );
  return result.rows[0] || null;
}

async function audit(client, input) {
  await client.query(
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
}

export async function createProofRequestForAgent(input) {
  const mcp = await authenticateMcpKey(input.mcpKey);
  if (!mcp) {
    throw new Error("Invalid or revoked MCP key.");
  }

  return withTransaction(async (client) => {
    const didRecord = await findDidRecordForCustomer(client, {
      did: String(input.did || ""),
      customerId: mcp.customer_id,
    });
    if (!didRecord) {
      throw new Error("DID not found for the authenticated customer.");
    }

    const proofRequest = await createMidnightProofRequest({
      did: didRecord.did,
      scopes: uniqueScopes(input.scopes),
      challenge: input.challenge,
      verifier: input.verifier,
      purpose: input.purpose || "selective-disclosure",
    });

    const approvalPayload = buildApprovalPayload(
      proofRequest.material,
      didRecord.subject_wallet_address,
    );

    const inserted = await client.query(
      `insert into proof_requests (
         customer_id,
         mcp_key_id,
         did_record_id,
         did,
         contract_address,
         network_id,
         agent_id,
         requester_wallet_address,
         holder_wallet_address,
         scopes,
         verifier,
         purpose,
         challenge,
         proof_material,
         approval_payload
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14::jsonb, $15)
       returning *`,
      [
        mcp.customer_id,
        mcp.id,
        didRecord.id,
        didRecord.did,
        didRecord.contract_address,
        didRecord.network_id,
        didRecord.agent_id || null,
        normalizeWallet(input.requesterWalletAddress || didRecord.subject_wallet_address),
        normalizeWallet(didRecord.subject_wallet_address),
        JSON.stringify(uniqueScopes(input.scopes)),
        input.verifier ? String(input.verifier) : null,
        String(input.purpose || "selective-disclosure"),
        proofRequest.material.challenge,
        JSON.stringify(proofRequest.material),
        approvalPayload,
      ],
    );

    await audit(client, {
      actorType: "agent",
      actorRef: mcp.id,
      eventType: "proof_request_created",
      entityType: "proof_request",
      entityId: inserted.rows[0].id,
      eventData: {
        did: didRecord.did,
        scopes: uniqueScopes(input.scopes),
      },
    });

    return inserted.rows[0];
  });
}

export async function createProofRequestForWallet(input) {
  const holderWalletAddress = normalizeWallet(input.walletAddress);
  const customerContext = await getCustomerByWallet(holderWalletAddress);
  if (!customerContext?.customer?.id) {
    throw new Error("Customer account not found for wallet.");
  }

  return withTransaction(async (client) => {
    const didRecord = await findDidRecordForCustomer(client, {
      did: String(input.did || ""),
      customerId: customerContext.customer.id,
    });
    if (!didRecord) {
      throw new Error("DID not found for the connected wallet customer.");
    }
    if (normalizeWallet(didRecord.subject_wallet_address) !== holderWalletAddress) {
      throw new Error("Connected wallet does not control this DID.");
    }

    const proofRequest = await createMidnightProofRequest({
      did: didRecord.did,
      scopes: uniqueScopes(input.scopes),
      challenge: input.challenge,
      verifier: input.verifier,
      purpose: input.purpose || "selective-disclosure",
    });

    const approvalPayload = buildApprovalPayload(
      proofRequest.material,
      didRecord.subject_wallet_address,
    );

    const inserted = await client.query(
      `insert into proof_requests (
         customer_id,
         did_record_id,
         did,
         contract_address,
         network_id,
         agent_id,
         requester_wallet_address,
         holder_wallet_address,
         scopes,
         verifier,
         purpose,
         challenge,
         proof_material,
         approval_payload
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13::jsonb, $14)
       returning *`,
      [
        customerContext.customer.id,
        didRecord.id,
        didRecord.did,
        didRecord.contract_address,
        didRecord.network_id,
        didRecord.agent_id || null,
        holderWalletAddress,
        holderWalletAddress,
        JSON.stringify(uniqueScopes(input.scopes)),
        input.verifier ? String(input.verifier) : null,
        String(input.purpose || "selective-disclosure"),
        proofRequest.material.challenge,
        JSON.stringify(proofRequest.material),
        approvalPayload,
      ],
    );

    await audit(client, {
      actorType: "human",
      actorRef: holderWalletAddress,
      eventType: "proof_request_created",
      entityType: "proof_request",
      entityId: inserted.rows[0].id,
      eventData: {
        did: didRecord.did,
        scopes: uniqueScopes(input.scopes),
        source: "wallet",
      },
    });

    return inserted.rows[0];
  });
}

export async function listProofRequests(filters = {}) {
  const clauses = [];
  const params = [];
  if (filters.customerId) {
    params.push(filters.customerId);
    clauses.push(`customer_id = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    clauses.push(`request_status = $${params.length}`);
  }
  const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
  const result = await query(
    `select *
     from proof_requests
     ${where}
     order by created_at desc
     limit 100`,
    params,
  );
  return result.rows;
}

export async function getProofRequestById(id) {
  const result = await query(
    `select *
     from proof_requests
     where id = $1
     limit 1`,
    [id],
  );
  return result.rows[0] || null;
}

export async function approveProofRequestByHuman(input, deps = {}) {
  const verifySignatureFn = deps.verifySignature || verifySignature;
  const addressFromKeyFn = deps.addressFromKey || addressFromKey;
  return withTransaction(async (client) => {
    const current = (
      await client.query(
        `select *
         from proof_requests
         where id = $1
         limit 1`,
        [input.proofRequestId],
      )
    ).rows[0];

    if (!current) {
      throw new Error("Proof request not found.");
    }
    if (current.request_status !== "pending_human_approval") {
      throw new Error("Proof request is not pending human approval.");
    }

    const signerWallet = normalizeWallet(input.humanWalletAddress);
    if (signerWallet !== normalizeWallet(current.holder_wallet_address)) {
      throw new Error("Connected wallet does not match the DID holder wallet.");
    }

    const signatureEnvelope = input.holderSignature;
    if (!signatureEnvelope || typeof signatureEnvelope !== "object") {
      throw new Error("Holder signature is required.");
    }
    console.info("[proof-request] holder signature envelope", {
      proofRequestId: input.proofRequestId,
      holderWallet: signerWallet,
      dataLength: String(signatureEnvelope.data || "").length,
      dataPreview: String(signatureEnvelope.data || "").slice(0, 80),
      signatureLength: String(signatureEnvelope.signature || "").length,
      signaturePrefix: String(signatureEnvelope.signature || "").slice(0, 24),
      verifyingKey: String(signatureEnvelope.verifyingKey || ""),
      verifyingKeyLength: String(signatureEnvelope.verifyingKey || "").length,
    });
    const normalizedSignature = normalizeWalletSignatureHex(
      String(signatureEnvelope.signature || ""),
      2,
    );
    const normalizedVerifyingKeyForCrypto = normalizeWalletSignatureHex(
      String(signatureEnvelope.verifyingKey || ""),
    );
    console.info("[proof-request] normalized holder signature envelope", {
      proofRequestId: input.proofRequestId,
      signatureLength: normalizedSignature.length,
      signaturePrefix: normalizedSignature.slice(0, 24),
      verifyingKey: normalizedVerifyingKeyForCrypto,
      verifyingKeyLength: normalizedVerifyingKeyForCrypto.length,
    });
    if (String(signatureEnvelope.data || "") !== current.approval_payload) {
      throw new Error("Wallet signature payload does not match the expected proof approval payload.");
    }

    const normalizedVerifyingKey = normalizeWallet(
      String(signatureEnvelope.verifyingKey || ""),
    );

    let verified = false;
    let signatureVerificationFailed = false;
    try {
      verified = verifySignatureFn(
        normalizedVerifyingKeyForCrypto,
        new TextEncoder().encode(String(signatureEnvelope.data || "")),
        normalizedSignature,
      );
      if (!verified) {
        signatureVerificationFailed = true;
      }
    } catch {
      signatureVerificationFailed = true;
    }

    if (signatureVerificationFailed && normalizedVerifyingKey !== signerWallet) {
      throw new Error("Wallet signature verification failed.");
    }

    let derivedAddress = "";
    try {
      const rawDerivedAddress = addressFromKeyFn(normalizedVerifyingKeyForCrypto);
      derivedAddress = normalizeWallet(
        encodeDerivedWalletAddress(rawDerivedAddress, current.network_id),
      );
    } catch {
      derivedAddress = "";
    }

    if (
      derivedAddress &&
      derivedAddress !== signerWallet &&
      normalizedVerifyingKey !== signerWallet
    ) {
      throw new Error("Wallet signature verifying key does not match the holder wallet address.");
    }

    const updated = await client.query(
      `update proof_requests
       set request_status = 'proof_ready',
           holder_signature = $2::jsonb,
           human_approved_at = now(),
           human_approved_by_wallet = $3,
           updated_at = now()
       where id = $1
       returning *`,
      [
        input.proofRequestId,
        JSON.stringify(signatureEnvelope),
        signerWallet,
      ],
    );

    await audit(client, {
      actorType: "human",
      actorRef: signerWallet,
      eventType: "proof_request_human_approved",
      entityType: "proof_request",
      entityId: current.id,
      eventData: {
        did: current.did,
      },
    });

    return updated.rows[0];
  });
}

export async function rejectProofRequestByHuman(input) {
  return withTransaction(async (client) => {
    const current = (
      await client.query(
        `select *
         from proof_requests
         where id = $1
         limit 1`,
        [input.proofRequestId],
      )
    ).rows[0];

    if (!current) {
      throw new Error("Proof request not found.");
    }
    if (current.request_status !== "pending_human_approval") {
      throw new Error("Proof request is not pending human approval.");
    }

    const signerWallet = normalizeWallet(input.humanWalletAddress);
    if (signerWallet !== normalizeWallet(current.holder_wallet_address)) {
      throw new Error("Connected wallet does not match the DID holder wallet.");
    }

    const updated = await client.query(
      `update proof_requests
       set request_status = 'human_rejected',
           error_message = $2,
           updated_at = now()
       where id = $1
       returning *`,
      [
        input.proofRequestId,
        input.reason ? String(input.reason) : "Rejected by holder wallet.",
      ],
    );

    await audit(client, {
      actorType: "human",
      actorRef: signerWallet,
      eventType: "proof_request_human_rejected",
      entityType: "proof_request",
      entityId: current.id,
      eventData: {
        did: current.did,
        reason: input.reason || null,
      },
    });

    return updated.rows[0];
  });
}

export async function deleteProofRequest(input) {
  return withTransaction(async (client) => {
    const current = (
      await client.query(
        `select *
         from proof_requests
         where id = $1
         limit 1`,
        [input.proofRequestId],
      )
    ).rows[0];

    if (!current) {
      throw new Error("Proof request not found.");
    }

    await client.query(`delete from proof_requests where id = $1`, [input.proofRequestId]);

    await audit(client, {
      actorType: "admin",
      actorRef: normalizeWallet(input.adminWalletAddress),
      eventType: "proof_request_deleted",
      entityType: "proof_request",
      entityId: current.id,
      eventData: {
        did: current.did,
        previousStatus: current.request_status,
      },
    });

    return {
      ...current,
      deleted: true,
      deleted_by_wallet: normalizeWallet(input.adminWalletAddress),
    };
  });
}

export async function submitProofForRequest(input) {
  return withTransaction(async (client) => {
    const current = (
      await client.query(
        `select *
         from proof_requests
         where id = $1
         limit 1`,
        [input.proofRequestId],
      )
    ).rows[0];
    if (!current) {
      throw new Error("Proof request not found.");
    }
    if (!["proof_ready", "submitted", "verified"].includes(current.request_status)) {
      throw new Error("Proof request is not ready for submission.");
    }

    const verification = await verifyMidnightProofSubmission({
      proofRequest: {
        requestId: current.id,
        proofRequestType: "midnight-holder-proof-request",
        createdAt: current.created_at,
        expiresAt: current.created_at,
        material: current.proof_material,
      },
      submission: input.submission,
    });

    // Branch A: fully verified — cryptographic proof confirmed
    if (verification.valid === true && verification.cryptographicProofVerified === true) {
      console.log("[proof-request] submitProofForRequest: branch A — fully verified", {
        proofRequestId: input.proofRequestId,
        did: current.did,
        cryptographicProofVerified: true,
      });

      const updated = await client.query(
        `update proof_requests
         set request_status = 'verified',
             verified_at = now(),
             verification_failure_layer = null,
             proof_submission = $2::jsonb,
             verification_result = $3::jsonb,
             error_message = null,
             updated_at = now()
         where id = $1
         returning *`,
        [
          input.proofRequestId,
          JSON.stringify(input.submission),
          JSON.stringify(verification),
        ],
      );

      await audit(client, {
        actorType: "system",
        actorRef: "system",
        eventType: "proof_request_verified",
        entityType: "proof_request",
        entityId: input.proofRequestId,
        eventData: {
          did: current.did,
          verifiedAt: updated.rows[0].verified_at,
        },
      });

      return {
        success: true,
        status: "verified",
        verifiedAt: updated.rows[0].verified_at,
        proofRequest: updated.rows[0],
        verification,
      };
    }

    // Branch B: valid structure but cryptographic proof not confirmed (degraded mode)
    if (verification.valid === true && verification.cryptographicProofVerified === false) {
      console.log("[proof-request] submitProofForRequest: branch B — degraded (valid but cryptographic proof unconfirmed)", {
        proofRequestId: input.proofRequestId,
        did: current.did,
        cryptographicProofVerified: false,
      });

      const updated = await client.query(
        `update proof_requests
         set request_status = 'submitted',
             proof_submission = $2::jsonb,
             verification_result = $3::jsonb,
             updated_at = now()
         where id = $1
         returning *`,
        [
          input.proofRequestId,
          JSON.stringify(input.submission),
          JSON.stringify(verification),
        ],
      );

      return {
        success: true,
        status: "submitted",
        degraded: true,
        proofRequest: updated.rows[0],
        verification,
      };
    }

    // Branch C: verification failed — reject the proof request
    console.log("[proof-request] submitProofForRequest: branch C — rejected", {
      proofRequestId: input.proofRequestId,
      did: current.did,
      failure_layer: verification.failure_layer,
      message: verification.message,
    });

    const updated = await client.query(
      `update proof_requests
       set request_status = 'rejected',
           error_message = $2,
           verification_failure_layer = $3,
           proof_submission = $4::jsonb,
           verification_result = $5::jsonb,
           updated_at = now()
       where id = $1
       returning *`,
      [
        input.proofRequestId,
        verification.message || verification.status || "Proof verification failed.",
        verification.failure_layer || null,
        JSON.stringify(input.submission),
        JSON.stringify(verification),
      ],
    );

    return {
      success: false,
      status: "rejected",
      failure_layer: verification.failure_layer || null,
      message: verification.message || verification.status || "Proof verification failed.",
      proofRequest: updated.rows[0],
      verification,
    };
  });
}
