import { query, withTransaction } from "./db.js";
import { issueAtomicCredentials } from "./vc-service.js";
import {
  buildDid,
  createMcpKey,
  deriveAgentKey,
  normalizeWallet,
  nowIso,
  sha256Hex,
} from "./utils.js";

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

export async function createCustomer(input) {
  const result = await query(
    `insert into customers (email, display_name, status)
     values ($1, $2, coalesce($3, 'active'))
     returning *`,
    [input.email, input.displayName, input.status || "active"],
  );
  return result.rows[0];
}

export async function getCustomerByWallet(walletAddress) {
  const result = await query(
    `select
       c.*,
       cw.wallet_address as linked_wallet_address,
       cw.is_primary as linked_wallet_primary
     from customer_wallets cw
     join customers c on c.id = cw.customer_id
     where cw.wallet_address = $1
     limit 1`,
    [normalizeWallet(walletAddress)],
  );
  const customer = result.rows[0];
  if (!customer) return null;

  const [subscriptions, mcpKeys] = await Promise.all([
    query(
      `select *
       from subscriptions
       where customer_id = $1
       order by created_at desc`,
      [customer.id],
    ),
    query(
      `select id, customer_id, label, key_id, status, scopes, created_at, last_used_at, expires_at
       from mcp_keys
       where customer_id = $1
       order by created_at desc`,
      [customer.id],
    ),
  ]);

  return {
    customer,
    subscriptions: subscriptions.rows,
    mcpKeys: mcpKeys.rows,
  };
}

export async function saveAdminRegistryDeployment(input) {
  return withTransaction(async (client) => {
    const row = (
      await client.query(
        `insert into admin_registry_deployments (
           network_id,
           contract_address,
           deployer_wallet_address,
           deployer_shielded_address,
           registry_admin_wallet_address,
           issuer_wallet_address,
           deploy_tx_id,
           deploy_tx_hash,
           initialize_tx_id,
           initialize_tx_hash,
           deployment_mode,
           metadata,
           updated_at
         )
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, now())
         on conflict (contract_address)
         do update set
           network_id = excluded.network_id,
           deployer_wallet_address = excluded.deployer_wallet_address,
           deployer_shielded_address = excluded.deployer_shielded_address,
           registry_admin_wallet_address = excluded.registry_admin_wallet_address,
           issuer_wallet_address = excluded.issuer_wallet_address,
           deploy_tx_id = excluded.deploy_tx_id,
           deploy_tx_hash = excluded.deploy_tx_hash,
           initialize_tx_id = excluded.initialize_tx_id,
           initialize_tx_hash = excluded.initialize_tx_hash,
           deployment_mode = excluded.deployment_mode,
           metadata = excluded.metadata,
           updated_at = now()
         returning *`,
        [
          input.networkId,
          input.contractAddress,
          normalizeWallet(input.deployerWalletAddress),
          input.deployerShieldedAddress || null,
          input.registryAdminWalletAddress
            ? normalizeWallet(input.registryAdminWalletAddress)
            : null,
          input.issuerWalletAddress
            ? normalizeWallet(input.issuerWalletAddress)
            : null,
          input.deployTxId || null,
          input.deployTxHash || null,
          input.initializeTxId || null,
          input.initializeTxHash || null,
          input.mode || "onchain",
          JSON.stringify(input.metadata || {}),
        ],
      )
    ).rows[0];

    await audit(client, {
      actorType: "admin_wallet",
      actorRef: normalizeWallet(input.deployerWalletAddress),
      eventType: "registry_deployed",
      entityType: "registry_deployment",
      entityId: row.id,
      eventData: {
        contractAddress: input.contractAddress,
        networkId: input.networkId,
      },
    });

    return row;
  });
}

export async function listAdminRegistryDeployments(input = {}) {
  const where = [];
  const params = [];

  if (input.networkId) {
    params.push(input.networkId);
    where.push(`network_id = $${params.length}`);
  }
  if (input.deployerWalletAddress) {
    params.push(normalizeWallet(input.deployerWalletAddress));
    where.push(`deployer_wallet_address = $${params.length}`);
  }

  const result = await query(
    `select *
     from admin_registry_deployments
     ${where.length ? `where ${where.join(" and ")}` : ""}
     order by created_at desc`,
    params,
  );
  return result.rows;
}

export async function getLatestAdminRegistryDeployment(input = {}) {
  const rows = await listAdminRegistryDeployments(input);
  return rows[0] || null;
}

async function ensureCustomerForWallet(client, walletAddress) {
  const normalizedWallet = normalizeWallet(walletAddress);
  let customer = (
    await client.query(
      `select c.*
       from customer_wallets cw
       join customers c on c.id = cw.customer_id
       where cw.wallet_address = $1
       limit 1`,
      [normalizedWallet],
    )
  ).rows[0];

  if (!customer) {
    const email = `${normalizedWallet.replace(/[^a-z0-9]/g, "")}@wallet.local`;
    customer = (
      await client.query(
        `insert into customers (email, display_name, status)
         values ($1, $2, 'active')
         returning *`,
        [email, "Wallet User"],
      )
    ).rows[0];

    await client.query(
      `insert into customer_wallets (customer_id, wallet_address, is_primary, approved_at)
       values ($1, $2, true, now())`,
      [customer.id, normalizedWallet],
    );
  }

  return customer;
}

export async function linkWallet(input) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `insert into customer_wallets (customer_id, wallet_address, is_primary, approved_at)
       values ($1, $2, coalesce($3, false), case when coalesce($4, true) then now() else null end)
       on conflict (wallet_address)
       do update set customer_id = excluded.customer_id,
                     is_primary = excluded.is_primary,
                     approved_at = excluded.approved_at
       returning *`,
      [
        input.customerId,
        normalizeWallet(input.walletAddress),
        !!input.isPrimary,
        input.autoApprove !== false,
      ],
    );
    await audit(client, {
      actorType: "customer",
      actorRef: input.customerId,
      eventType: "wallet_linked",
      entityType: "customer_wallet",
      entityId: result.rows[0].id,
      eventData: { walletAddress: normalizeWallet(input.walletAddress) },
    });
    return result.rows[0];
  });
}

export async function createSubscription(input) {
  const result = await query(
    `insert into subscriptions (customer_id, plan_code, status, did_quota_total, did_quota_remaining, ends_at)
     values ($1, $2, coalesce($3, 'active'), $4, $4, $5)
     returning *`,
    [input.customerId, input.planCode, input.status || "active", input.didQuotaTotal, input.endsAt || null],
  );
  return result.rows[0];
}

export async function createCustomerMcpKey(input) {
  return withTransaction(async (client) => {
    const material = createMcpKey();
    const result = await client.query(
      `insert into mcp_keys (customer_id, label, key_id, key_hash, status, scopes, expires_at)
       values ($1, $2, $3, $4, 'active', $5::jsonb, $6)
       returning id, customer_id, label, key_id, status, scopes, created_at, expires_at`,
      [
        input.customerId,
        input.label,
        material.keyId,
        material.keyHash,
        JSON.stringify(input.scopes || ["did.request", "did.status", "did.resolve", "did.validate"]),
        input.expiresAt || null,
      ],
    );
    await audit(client, {
      actorType: "customer",
      actorRef: input.customerId,
      eventType: "mcp_key_created",
      entityType: "mcp_key",
      entityId: result.rows[0].id,
      eventData: { label: input.label, scopes: input.scopes || null },
    });
    return {
      ...result.rows[0],
      plainTextKey: material.plainText,
    };
  });
}

export async function bootstrapDemoCustomer(input) {
  return withTransaction(async (client) => {
    const email =
      input.email || `${normalizeWallet(input.walletAddress).replace(/[^a-z0-9]/g, "")}@demo.local`;
    const displayName = input.displayName || "Wallet Customer";

    let customer = (
      await client.query(
        `select c.*
         from customer_wallets cw
         join customers c on c.id = cw.customer_id
         where cw.wallet_address = $1
         limit 1`,
        [normalizeWallet(input.walletAddress)],
      )
    ).rows[0];

    if (!customer) {
      customer = (
        await client.query(
          `insert into customers (email, display_name, status)
           values ($1, $2, 'active')
           returning *`,
          [email, displayName],
        )
      ).rows[0];

      await client.query(
        `insert into customer_wallets (customer_id, wallet_address, is_primary, approved_at)
         values ($1, $2, true, now())`,
        [customer.id, normalizeWallet(input.walletAddress)],
      );
    }

    let subscription = (
      await client.query(
        `select *
         from subscriptions
         where customer_id = $1
         order by created_at desc
         limit 1`,
        [customer.id],
      )
    ).rows[0];

    if (!subscription) {
      subscription = (
        await client.query(
          `insert into subscriptions (customer_id, plan_code, status, did_quota_total, did_quota_remaining)
           values ($1, $2, 'active', $3, $3)
           returning *`,
          [customer.id, input.planCode || "demo-bundle", input.didQuotaTotal || 5],
        )
      ).rows[0];
    }

    const mcpKey = await createCustomerMcpKey({
      customerId: customer.id,
      label: input.mcpLabel || "demo-agent-key",
      scopes: ["did.request", "did.status", "did.resolve", "did.validate"],
    });

    await audit(client, {
      actorType: "system",
      actorRef: "bootstrap",
      eventType: "demo_customer_bootstrapped",
      entityType: "customer",
      entityId: customer.id,
      eventData: { walletAddress: normalizeWallet(input.walletAddress) },
    });

    return {
      customer,
      subscription,
      mcpKey,
    };
  });
}

export async function authenticateMcpKey(plainTextKey) {
  const keyHash = sha256Hex(String(plainTextKey || ""));
  const result = await query(
    `select mk.*, c.email, c.display_name
     from mcp_keys mk
     join customers c on c.id = mk.customer_id
     where mk.key_hash = $1 and mk.status = 'active' and (mk.expires_at is null or mk.expires_at > now())`,
    [keyHash],
  );
  const row = result.rows[0];
  if (!row) return null;
  await query(`update mcp_keys set last_used_at = now() where id = $1`, [row.id]);
  return row;
}

async function getActiveSubscriptionForCustomer(client, customerId) {
  const result = await client.query(
    `select *
     from subscriptions
     where customer_id = $1
       and status = 'active'
       and did_quota_remaining > 0
       and (ends_at is null or ends_at > now())
     order by created_at desc
     limit 1`,
    [customerId],
  );
  return result.rows[0] || null;
}

function buildSelectiveDisclosureTemplate(input) {
  return (
    input.selectiveDisclosureTemplate || {
      allowNameDisclosure: true,
      allowOrganizationDisclosure: input.organizationDisclosure === "disclosed",
      allowOwnershipProofOnly: true,
    }
  );
}

async function createOrUpdateDidRequestRecord(client, input) {
  const requesterWallet = normalizeWallet(input.requesterWalletAddress);
  const subjectWallet = normalizeWallet(
    input.subjectWalletAddress || input.requesterWalletAddress,
  );
  const requestedDid =
    input.requestedDid ||
    buildDid({
      networkId: input.networkId,
      contractAddress: input.contractAddress,
      walletAddress: subjectWallet,
    });
  const organizationDisclosure =
    input.organizationDisclosure === "disclosed" ? "disclosed" : "undisclosed";
  const requestPayload = JSON.stringify(input.requestPayload || {});
  const selectiveDisclosureTemplate = JSON.stringify(
    buildSelectiveDisclosureTemplate(input),
  );

  if (input.updateExistingPending) {
    const existing = (
      await client.query(
        `select *
         from did_requests
         where contract_address = $1
           and subject_wallet_address = $2
           and request_status in ('pending_human_approval', 'pending_admin_review')
         order by created_at desc
         limit 1`,
        [input.contractAddress, subjectWallet],
      )
    ).rows[0];

    if (existing) {
      const updated = (
        await client.query(
          `update did_requests
           set requester_wallet_address = $2,
               network_id = $3,
               organization_name = $4,
               organization_disclosure = $5,
               request_payload = $6::jsonb,
               selective_disclosure_template = $7::jsonb,
               requested_did = $8,
               onchain_request_tx_id = $9,
               onchain_request_tx_hash = $10,
               updated_at = now()
           where id = $1
           returning *`,
          [
            existing.id,
            requesterWallet,
            input.networkId,
            input.organizationName || null,
            organizationDisclosure,
            requestPayload,
            selectiveDisclosureTemplate,
            requestedDid,
            input.onchainRequestTxId || null,
            input.onchainRequestTxHash || null,
          ],
        )
      ).rows[0];

      return { row: updated, subjectWallet, requestedDid, created: false };
    }
  }

  const result = await client.query(
    `insert into did_requests (
       customer_id,
       subscription_id,
       mcp_key_id,
       contract_address,
       network_id,
       requester_wallet_address,
       subject_wallet_address,
       request_status,
       organization_name,
       organization_disclosure,
       request_payload,
       selective_disclosure_template,
       requested_did,
       onchain_request_tx_id,
       onchain_request_tx_hash,
       human_approved_at,
       human_approved_by_wallet
     )
     values (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13, $14, $15, $16, $17
     )
     returning *`,
    [
      input.customerId,
      input.subscriptionId || null,
      input.mcpKeyId || null,
      input.contractAddress,
      input.networkId,
      requesterWallet,
      subjectWallet,
      input.requestStatus,
      input.organizationName || null,
      organizationDisclosure,
      requestPayload,
      selectiveDisclosureTemplate,
      requestedDid,
      input.onchainRequestTxId || null,
      input.onchainRequestTxHash || null,
      input.humanApprovedAt || null,
      input.humanApprovedByWallet || null,
    ],
  );

  return { row: result.rows[0], subjectWallet, requestedDid, created: true };
}

function defaultClaimsManifest(input) {
  return (
    input.claimsManifest || {
      supportsPartialDisclosure: true,
      claims: ["ownership", "name", "organization"],
    }
  );
}

async function upsertIssuedDidRecord(client, input) {
  const issuerWallet = normalizeWallet(input.issuerWalletAddress);
  const subjectWallet = normalizeWallet(input.subjectWalletAddress);
  const customer = await ensureCustomerForWallet(client, subjectWallet);
  const agentKey = deriveAgentKey(subjectWallet);
  const organizationName =
    input.organizationDisclosure === "disclosed"
      ? input.organizationName || null
      : null;
  const organizationDisclosure =
    input.organizationDisclosure === "disclosed" ? "disclosed" : "undisclosed";
  const claimsManifest = JSON.stringify(defaultClaimsManifest(input));
  const didDocument = JSON.stringify(input.didDocument || {});

  let record = (
    await client.query(
      `select *
       from did_records
       where did = $1
       limit 1`,
      [input.did],
    )
  ).rows[0];

  if (!record) {
    record = (
      await client.query(
        `insert into did_records (
           request_id,
           did,
           contract_address,
           network_id,
           subject_wallet_address,
           subject_agent_key,
           issuer_wallet_address,
           status,
           organization_name,
           organization_disclosure,
           did_commitment,
           document_commitment,
           proof_commitment,
           did_document,
           claims_manifest,
           issued_at,
           updated_at
         )
         values (
           $1, $2, $3, $4, $5, $6, $7, 'active', $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, now(), now()
         )
         returning *`,
        [
          input.requestId || null,
          input.did,
          input.contractAddress,
          input.networkId,
          subjectWallet,
          agentKey,
          issuerWallet,
          organizationName,
          organizationDisclosure,
          input.didCommitment || null,
          input.documentCommitment || null,
          input.proofCommitment || null,
          didDocument,
          claimsManifest,
        ],
      )
    ).rows[0];

    await issueAtomicCredentials({
      client,
      didRecordId: record.id,
      requestId: input.requestId || null,
      customerId: input.customerId || customer.id,
      subjectDid: input.did,
      subjectWalletAddress: subjectWallet,
      subjectAgentKey: agentKey,
      contractAddress: input.contractAddress,
      networkId: input.networkId,
      status: "active",
      organizationName,
      organizationDisclosure,
      profileName:
        typeof input.requestPayload?.agentName === "string"
          ? input.requestPayload.agentName
          : null,
    });
  } else {
    record = (
      await client.query(
        `update did_records
         set issuer_wallet_address = $2,
             status = 'active',
             organization_name = $3,
             organization_disclosure = $4,
             did_commitment = $5,
             document_commitment = $6,
             proof_commitment = $7,
             did_document = $8::jsonb,
             claims_manifest = $9::jsonb,
             updated_at = now(),
             revoked_at = null
         where id = $1
         returning *`,
        [
          record.id,
          issuerWallet,
          organizationName,
          organizationDisclosure,
          input.didCommitment || null,
          input.documentCommitment || null,
          input.proofCommitment || null,
          didDocument,
          claimsManifest,
        ],
      )
    ).rows[0];
  }

  return { record, customerId: customer.id, agentKey, issuerWallet };
}

export async function createDidRequest(input) {
  return withTransaction(async (client) => {
    const mcp = await authenticateMcpKey(input.mcpKey);
    if (!mcp) {
      throw new Error("Invalid or expired MCP key.");
    }

    const subscription = await getActiveSubscriptionForCustomer(client, mcp.customer_id);
    if (!subscription) {
      throw new Error("No active DID subscription with remaining quota for this customer.");
    }

    const { row, subjectWallet, requestedDid } =
      await createOrUpdateDidRequestRecord(client, {
        customerId: mcp.customer_id,
        subscriptionId: subscription.id,
        mcpKeyId: mcp.id,
        contractAddress: input.contractAddress,
        networkId: input.networkId,
        requesterWalletAddress: input.requesterWalletAddress,
        subjectWalletAddress: input.subjectWalletAddress,
        requestStatus: "pending_human_approval",
        organizationName: input.organizationName,
        organizationDisclosure: input.organizationDisclosure,
        requestPayload: input.requestPayload,
        selectiveDisclosureTemplate: input.selectiveDisclosureTemplate,
        requestedDid: input.onchainRequestTxId ? undefined : undefined,
        onchainRequestTxId: input.onchainRequestTxId,
        onchainRequestTxHash: input.onchainRequestTxHash,
        updateExistingPending: false,
      });

    await audit(client, {
      actorType: "agent_mcp",
      actorRef: mcp.id,
      eventType: "did_requested",
      entityType: "did_request",
      entityId: row.id,
      eventData: {
        subjectWallet,
        requestedDid,
      },
    });

    return row;
  });
}

export async function createWalletDidRequest(input) {
  return withTransaction(async (client) => {
    const walletAddress = normalizeWallet(input.walletAddress);
    const customer = await ensureCustomerForWallet(client, walletAddress);
    const { row, subjectWallet, requestedDid } =
      await createOrUpdateDidRequestRecord(client, {
        customerId: customer.id,
        contractAddress: input.contractAddress,
        networkId: input.networkId,
        requesterWalletAddress: walletAddress,
        subjectWalletAddress: input.subjectWalletAddress || walletAddress,
        requestStatus: "pending_admin_review",
        organizationName: input.organizationName,
        organizationDisclosure: input.organizationDisclosure,
        requestPayload: input.requestPayload,
        selectiveDisclosureTemplate: input.selectiveDisclosureTemplate,
        requestedDid: input.requestedDid,
        onchainRequestTxId: input.onchainRequestTxId,
        onchainRequestTxHash: input.onchainRequestTxHash,
        humanApprovedAt: "now",
        humanApprovedByWallet: walletAddress,
        updateExistingPending: true,
      });

    if (row.human_approved_at == null) {
      await client.query(
        `update did_requests
         set human_approved_at = now(),
             human_approved_by_wallet = $2
         where id = $1`,
        [row.id, walletAddress],
      );
    }

    await audit(client, {
      actorType: "wallet_user",
      actorRef: walletAddress,
      eventType: "wallet_did_requested",
      entityType: "did_request",
      entityId: row.id,
      eventData: {
        subjectWallet,
        requestedDid,
      },
    });

    return row;
  });
}

export async function approveDidRequestByHuman(input) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `update did_requests
       set request_status = 'pending_admin_review',
           human_approved_at = now(),
           human_approved_by_wallet = $2,
           updated_at = now()
       where id = $1
         and request_status = 'pending_human_approval'
       returning *`,
      [input.requestId, normalizeWallet(input.humanWalletAddress)],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("DID request not found or not pending human approval.");
    }
    await audit(client, {
      actorType: "human_wallet",
      actorRef: normalizeWallet(input.humanWalletAddress),
      eventType: "did_request_human_approved",
      entityType: "did_request",
      entityId: row.id,
      eventData: {},
    });
    return row;
  });
}

export async function rejectDidRequestByHuman(input) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `update did_requests
       set request_status = 'human_rejected',
           human_approved_at = now(),
           human_approved_by_wallet = $2,
           error_message = $3,
           updated_at = now()
       where id = $1
         and request_status = 'pending_human_approval'
       returning *`,
      [input.requestId, normalizeWallet(input.humanWalletAddress), input.reason || "Rejected by human approver"],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("DID request not found or not pending human approval.");
    }
    await audit(client, {
      actorType: "human_wallet",
      actorRef: normalizeWallet(input.humanWalletAddress),
      eventType: "did_request_human_rejected",
      entityType: "did_request",
      entityId: row.id,
      eventData: { reason: input.reason || null },
    });
    return row;
  });
}

export async function issueApprovedDidRequest(input) {
  return withTransaction(async (client) => {
    const requestResult = await client.query(
      `select *
       from did_requests
       where id = $1
       for update`,
      [input.requestId],
    );
    const request = requestResult.rows[0];
    if (!request) {
      throw new Error("DID request not found.");
    }
    if (request.request_status !== "pending_admin_review") {
      throw new Error("DID request is not pending admin review.");
    }
    const subscriptionResult = request.subscription_id
      ? await client.query(
          `select did_quota_remaining
           from subscriptions
           where id = $1
           for update`,
          [request.subscription_id],
        )
      : { rows: [] };
    const subscription = subscriptionResult.rows[0] || null;
    if (
      request.subscription_id &&
      subscription?.did_quota_remaining !== null &&
      subscription?.did_quota_remaining <= 0
    ) {
      throw new Error("No DID quota remaining for the linked subscription.");
    }

    const issuerWallet = normalizeWallet(input.issuerWalletAddress);
    const subjectWallet = normalizeWallet(request.subject_wallet_address);
    const agentKey = deriveAgentKey(subjectWallet);
    const requestedDid =
      request.requested_did ||
      buildDid({
        networkId: request.network_id,
        contractAddress: request.contract_address,
        walletAddress: subjectWallet,
      });
    const didDocument = input.didDocument || {};
    const didCommitment = sha256Hex(JSON.stringify({ did: requestedDid, subjectWallet }));
    const documentCommitment = sha256Hex(JSON.stringify(didDocument));
    const proofCommitment = sha256Hex(
      JSON.stringify({
        did: requestedDid,
        issuerWallet,
        selectiveDisclosureTemplate: request.selective_disclosure_template,
      }),
    );

    if (request.subscription_id) {
      await client.query(
        `update subscriptions
         set did_quota_remaining = did_quota_remaining - 1,
             updated_at = now()
         where id = $1`,
        [request.subscription_id],
      );
    }

    const { record } = await upsertIssuedDidRecord(client, {
      requestId: request.id,
      customerId: request.customer_id,
      issuerWalletAddress: issuerWallet,
      subjectWalletAddress: subjectWallet,
      did: requestedDid,
      contractAddress: request.contract_address,
      networkId: request.network_id,
      organizationName: request.organization_name,
      organizationDisclosure: request.organization_disclosure,
      requestPayload: request.request_payload,
      didDocument,
      didCommitment: input.didCommitment || didCommitment,
      documentCommitment: input.documentCommitment || documentCommitment,
      proofCommitment: input.proofCommitment || proofCommitment,
      claimsManifest: input.claimsManifest,
    });

    const requestUpdateResult = await client.query(
      `update did_requests
       set request_status = 'issued',
           admin_decision_at = now(),
           admin_decision_by = $2,
           onchain_issue_tx_id = $3,
           onchain_issue_tx_hash = $4,
           requested_did = $5,
           updated_at = now()
       where id = $1
       returning *`,
      [
        request.id,
        issuerWallet,
        input.onchainIssueTxId || null,
        input.onchainIssueTxHash || null,
        requestedDid,
      ],
    );

    await audit(client, {
      actorType: "admin",
      actorRef: issuerWallet,
      eventType: "did_issued",
      entityType: "did_record",
      entityId: record.id,
      eventData: {
        requestId: request.id,
        did: requestedDid,
      },
    });

    return {
      request: requestUpdateResult.rows[0],
      record,
    };
  });
}

export async function syncWalletIssuedDid(input) {
  return withTransaction(async (client) => {
    const issuerWallet = normalizeWallet(input.issuerWalletAddress);
    const subjectWallet = normalizeWallet(input.subjectWalletAddress);
    const customer = await ensureCustomerForWallet(client, subjectWallet);
    const agentKey = deriveAgentKey(subjectWallet);
    const request = (
      await client.query(
        `select *
         from did_requests
         where contract_address = $1
           and subject_wallet_address = $2
         order by created_at desc
         limit 1`,
        [input.contractAddress, subjectWallet],
      )
    ).rows[0];

    const { record } = await upsertIssuedDidRecord(client, {
      requestId: request?.id || null,
      customerId: customer.id,
      issuerWalletAddress: issuerWallet,
      subjectWalletAddress: subjectWallet,
      did: input.did,
      contractAddress: input.contractAddress,
      networkId: input.networkId,
      organizationName: input.organizationName,
      organizationDisclosure: input.organizationDisclosure,
      requestPayload: input.requestPayload,
      didDocument: input.didDocument,
      didCommitment: input.didCommitment,
      documentCommitment: input.documentCommitment,
      proofCommitment: input.proofCommitment,
      claimsManifest: input.claimsManifest,
    });

    if (request) {
      await client.query(
        `update did_requests
         set request_status = 'issued',
             requested_did = $2,
             onchain_issue_tx_id = $3,
             onchain_issue_tx_hash = $4,
             admin_decision_at = now(),
             admin_decision_by = $5,
             updated_at = now()
         where id = $1`,
        [
          request.id,
          input.did,
          input.onchainIssueTxId || null,
          input.onchainIssueTxHash || null,
          issuerWallet,
        ],
      );
    }

    return { request, record };
  });
}

export async function syncWalletUpdatedDid(input) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `update did_records
       set did_document = $2::jsonb,
           document_commitment = $3,
           proof_commitment = $4,
           updated_at = now()
       where did = $1
       returning *`,
      [
        input.did,
        JSON.stringify(input.didDocument || {}),
        input.documentCommitment || null,
        input.proofCommitment || null,
      ],
    );
    if (!result.rows[0]) {
      throw new Error("DID record not found for update sync.");
    }
    return result.rows[0];
  });
}

export async function syncWalletRevokedDid(input) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `update did_records
       set status = 'revoked',
           revocation_commitment = $2,
           revoked_at = now(),
           updated_at = now()
       where did = $1
       returning *`,
      [input.did, input.revocationCommitment || null],
    );
    if (!result.rows[0]) {
      throw new Error("DID record not found for revoke sync.");
    }

    return result.rows[0];
  });
}

export async function getPersistedDidState(input) {
  const walletAddress = normalizeWallet(input.walletAddress);
  const request = (
    await query(
      `select *
       from did_requests
       where contract_address = $1
         and subject_wallet_address = $2
       order by created_at desc
       limit 1`,
      [input.contractAddress, walletAddress],
    )
  ).rows[0] || null;

  const record = (
    await query(
      `select *
       from did_records
       where contract_address = $1
         and subject_wallet_address = $2
       order by issued_at desc
       limit 1`,
      [input.contractAddress, walletAddress],
    )
  ).rows[0] || null;

  return { request, record };
}

export async function rejectDidRequestByAdmin(input) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `update did_requests
       set request_status = 'admin_rejected',
           admin_decision_at = now(),
           admin_decision_by = $2,
           error_message = $3,
           updated_at = now()
       where id = $1
         and request_status in ('pending_admin_review', 'human_approved')
       returning *`,
      [input.requestId, normalizeWallet(input.adminWalletAddress), input.reason || "Rejected by admin"],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("DID request not found or not pending admin review.");
    }
    await audit(client, {
      actorType: "admin",
      actorRef: normalizeWallet(input.adminWalletAddress),
      eventType: "did_request_admin_rejected",
      entityType: "did_request",
      entityId: row.id,
      eventData: { reason: input.reason || null },
    });
    return row;
  });
}

export async function getDidRequestById(requestId) {
  const result = await query(`select * from did_requests where id = $1`, [requestId]);
  return result.rows[0] || null;
}

export async function listDidRequests(filters = {}) {
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
     from did_requests
     ${where}
     order by created_at desc
     limit 100`,
    params,
  );
  return result.rows;
}

export async function listRegistryDidRecords(contractAddress) {
  const normalizedContract = String(contractAddress || "").trim();
  if (!normalizedContract) {
    return [];
  }

  const result = await query(
    `select
       dr.id,
       dr.did,
       dr.contract_address,
       dr.network_id,
       dr.subject_wallet_address,
       dr.subject_agent_key,
       dr.issuer_wallet_address,
       dr.status,
       dr.organization_name,
       dr.organization_disclosure,
       dr.did_commitment,
       dr.document_commitment,
       dr.proof_commitment,
       dr.revocation_commitment,
       dr.did_document,
       dr.created_at,
       dr.issued_at,
       dr.updated_at,
       dr.revoked_at
     from did_records dr
     where dr.contract_address = $1
     order by dr.updated_at desc, dr.issued_at desc`,
    [normalizedContract],
  );

  return result.rows.map((row) => ({
    ...row,
    public_agent_name:
      row.did_document && typeof row.did_document === "object"
        ? row.did_document.agentName || null
        : null,
  }));
}

export async function resolveDid(did) {
  const result = await query(
    `select *
     from did_records
     where did = $1
     limit 1`,
    [did],
  );
  const record = result.rows[0];
  if (!record) return null;
  const serviceBase = process.env.DID_SERVICE_PUBLIC_BASE_URL || "http://localhost:8787";
  return {
    did: record.did,
    didDocument: {
      "@context": [
        "https://www.w3.org/ns/did/v1",
      ],
      id: record.did,
      controller: record.did,
      service: [
        {
          id: `${record.did}#resolver`,
          type: "DIDResolution",
          serviceEndpoint: `${serviceBase}/api/dids/resolve?did=${encodeURIComponent(record.did)}`,
        },
        {
          id: `${record.did}#credentials`,
          type: "VerifiableCredentialRepository",
          serviceEndpoint: `${serviceBase}/api/vcs/by-did?did=${encodeURIComponent(record.did)}`,
        },
      ],
      organization:
        record.organization_disclosure === "disclosed"
          ? record.organization_name
          : "undisclosed",
    },
    didDocumentMetadata: {
      created: record.created_at,
      updated: record.updated_at,
      deactivated: record.status === "revoked",
    },
    didResolutionMetadata: {
      contentType: "application/did+json",
    },
    registry: {
      contractAddress: record.contract_address,
      networkId: record.network_id,
      status: record.status,
      subjectWalletAddress: record.subject_wallet_address,
      issuerWalletAddress: record.issuer_wallet_address,
      didCommitment: record.did_commitment,
      documentCommitment: record.document_commitment,
      proofCommitment: record.proof_commitment,
      revocationCommitment: record.revocation_commitment,
    },
  };
}

export async function validateDid(did) {
  const resolved = await resolveDid(did);
  if (!resolved) {
    return {
      did,
      valid: false,
      reason: "DID not found",
    };
  }
  return {
    did,
    valid: resolved.registry.status === "active",
    status: resolved.registry.status,
    subjectWalletAddress: resolved.registry.subjectWalletAddress,
    issuerWalletAddress: resolved.registry.issuerWalletAddress,
    contractAddress: resolved.registry.contractAddress,
    networkId: resolved.registry.networkId,
  };
}
