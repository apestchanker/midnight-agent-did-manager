import { query, withTransaction } from "./db.js";
import { issueAtomicCredentials } from "./vc-service.js";
import { buildDidDocumentForRequest } from "../src/lib/did/request-document.js";
import {
  buildDid,
  createMcpKey,
  deriveAgentKey,
  generateAgentId,
  normalizeAgentId,
  normalizeWallet,
  nowIso,
  sha256Hex,
} from "./utils.js";

const DEFAULT_MCP_SCOPES = [
  "did.request",
  "did.status",
  "did.resolve",
  "did.validate",
];

const ALLOWED_MCP_SCOPES = new Set([
  ...DEFAULT_MCP_SCOPES,
  "did.credentials",
]);

const MAX_REQUEST_PAYLOAD_BYTES = 8192;
const MAX_AGENT_NAME_LENGTH = 120;
const MAX_REQUEST_DESCRIPTION_LENGTH = 1000;
const MAX_PROPOSED_SERVICES = 10;
const MAX_SERVICE_TYPE_LENGTH = 120;
const MAX_SERVICE_ENDPOINT_LENGTH = 512;
const MAX_SELECTIVE_DISCLOSURE_TEMPLATE_BYTES = 1024;
const ALLOWED_SELECTIVE_DISCLOSURE_TEMPLATE_FIELDS = new Set([
  "allowNameDisclosure",
  "allowOrganizationDisclosure",
  "allowOwnershipProofOnly",
]);

function normalizeMcpScopes(scopes) {
  const normalized = Array.isArray(scopes)
    ? scopes
        .map((scope) => String(scope || "").trim())
        .filter((scope) => ALLOWED_MCP_SCOPES.has(scope))
    : [];
  return Array.from(new Set(normalized));
}

function assertPlainObject(value, fieldName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${fieldName} must be a JSON object.`);
  }
}

function jsonByteLength(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function assertMaxJsonBytes(value, fieldName, maxBytes) {
  const bytes = jsonByteLength(value);
  if (bytes > maxBytes) {
    throw new Error(`${fieldName} must be ${maxBytes} bytes or smaller.`);
  }
}

function normalizeProposedServices(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > MAX_PROPOSED_SERVICES) {
    throw new Error(
      `requestPayload.proposedServices must be an array with at most ${MAX_PROPOSED_SERVICES} entries.`,
    );
  }

  return value.map((service, index) => {
    const fieldName = `requestPayload.proposedServices[${index}]`;
    assertPlainObject(service, fieldName);
    const unsupportedFields = Object.keys(service).filter(
      (key) => key !== "type" && key !== "serviceEndpoint",
    );
    if (unsupportedFields.length) {
      throw new Error(`${fieldName}.${unsupportedFields[0]} is not supported.`);
    }
    if (typeof service.type !== "string" || service.type.trim().length === 0) {
      throw new Error(`${fieldName}.type is required.`);
    }
    if (service.type.length > MAX_SERVICE_TYPE_LENGTH) {
      throw new Error(
        `${fieldName}.type must be ${MAX_SERVICE_TYPE_LENGTH} characters or fewer.`,
      );
    }
    if (
      typeof service.serviceEndpoint !== "string" ||
      service.serviceEndpoint.trim().length === 0
    ) {
      throw new Error(`${fieldName}.serviceEndpoint is required.`);
    }
    if (service.serviceEndpoint.length > MAX_SERVICE_ENDPOINT_LENGTH) {
      throw new Error(
        `${fieldName}.serviceEndpoint must be ${MAX_SERVICE_ENDPOINT_LENGTH} characters or fewer.`,
      );
    }
    return {
      type: service.type.trim(),
      serviceEndpoint: service.serviceEndpoint.trim(),
    };
  });
}

function normalizeRequestPayload(value) {
  const payload = value || {};
  assertPlainObject(payload, "requestPayload");
  assertMaxJsonBytes(payload, "requestPayload", MAX_REQUEST_PAYLOAD_BYTES);
  const unsupportedFields = Object.keys(payload).filter(
    (key) => !["agentName", "description", "proposedServices"].includes(key),
  );
  if (unsupportedFields.length) {
    throw new Error(`requestPayload.${unsupportedFields[0]} is not supported.`);
  }

  if (typeof payload.agentName !== "string" || payload.agentName.trim().length === 0) {
    throw new Error("requestPayload.agentName is required.");
  }
  if (payload.agentName.length > MAX_AGENT_NAME_LENGTH) {
    throw new Error(
      `requestPayload.agentName must be ${MAX_AGENT_NAME_LENGTH} characters or fewer.`,
    );
  }
  if (
    payload.description != null &&
    (typeof payload.description !== "string" ||
      payload.description.length > MAX_REQUEST_DESCRIPTION_LENGTH)
  ) {
    throw new Error(
      `requestPayload.description must be a string of ${MAX_REQUEST_DESCRIPTION_LENGTH} characters or fewer.`,
    );
  }
  return {
    agentName: payload.agentName.trim(),
    ...(typeof payload.description === "string" && payload.description.trim()
      ? { description: payload.description.trim() }
      : {}),
    ...(payload.proposedServices != null
      ? { proposedServices: normalizeProposedServices(payload.proposedServices) }
      : {}),
  };
}

function normalizeSelectiveDisclosureTemplate(value) {
  if (value == null) return undefined;
  assertPlainObject(value, "selectiveDisclosureTemplate");
  assertMaxJsonBytes(
    value,
    "selectiveDisclosureTemplate",
    MAX_SELECTIVE_DISCLOSURE_TEMPLATE_BYTES,
  );

  for (const [key, fieldValue] of Object.entries(value)) {
    if (!ALLOWED_SELECTIVE_DISCLOSURE_TEMPLATE_FIELDS.has(key)) {
      throw new Error(`selectiveDisclosureTemplate.${key} is not supported.`);
    }
    if (typeof fieldValue !== "boolean") {
      throw new Error(`selectiveDisclosureTemplate.${key} must be a boolean.`);
    }
  }

  return value;
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

  const [subscriptions, actionTokenGrants, mcpKeys] = await Promise.all([
    query(
      `select *
       from subscriptions
       where customer_id = $1
       order by created_at desc`,
      [customer.id],
    ),
    query(
      `select *
       from action_token_grants
       where customer_id = $1
       order by created_at desc`,
      [customer.id],
    ),
    query(
      `select id, customer_id, label, key_id, contract_address, network_id, status, scopes, created_at, last_used_at, expires_at
       from mcp_keys
       where customer_id = $1
       order by created_at desc`,
      [customer.id],
    ),
  ]);

  return {
    customer,
    subscriptions: subscriptions.rows,
    actionTokenGrants: actionTokenGrants.rows,
    mcpKeys: mcpKeys.rows,
  };
}

export async function getCustomerContextById(customerId) {
  const customerResult = await query(
    `select *
     from customers
     where id = $1
     limit 1`,
    [customerId],
  );
  const customer = customerResult.rows[0];
  if (!customer) return null;

  const [subscriptions, actionTokenGrants, mcpKeys] = await Promise.all([
    query(
      `select *
       from subscriptions
       where customer_id = $1
       order by created_at desc`,
      [customer.id],
    ),
    query(
      `select *
       from action_token_grants
       where customer_id = $1
       order by created_at desc`,
      [customer.id],
    ),
    query(
      `select id, customer_id, label, key_id, contract_address, network_id, status, scopes, created_at, last_used_at, expires_at
       from mcp_keys
       where customer_id = $1
       order by created_at desc`,
      [customer.id],
    ),
  ]);

  return {
    customer,
    subscriptions: subscriptions.rows,
    actionTokenGrants: actionTokenGrants.rows,
    mcpKeys: mcpKeys.rows,
  };
}

async function resolveCustomerForActionTokenGrant(client, input) {
  const customerId = String(input.customerId || "").trim();
  if (customerId) {
    const row = (
      await client.query(`select * from customers where id = $1 limit 1`, [customerId])
    ).rows[0];
    if (!row) throw new Error("Customer not found for action token grant.");
    return row;
  }

  const ref = String(input.customerRef || "").trim();
  if (!ref) {
    throw new Error("customerId or customerRef is required for action token grant.");
  }

  const normalizedRef = normalizeWallet(ref);
  const row = (
    await client.query(
      `select c.*
       from customers c
       left join customer_wallets cw on cw.customer_id = c.id
       where c.email = $1
          or c.id::text = $1
          or cw.wallet_address = $2
       order by c.created_at desc
       limit 1`,
      [ref, normalizedRef],
    )
  ).rows[0];

  if (!row) {
    throw new Error("Customer not found for action token grant.");
  }
  return row;
}

export async function recordActionTokenGrant(input) {
  return withTransaction(async (client) => {
    const customer = await resolveCustomerForActionTokenGrant(client, input);
    const creditsGranted = Number(input.creditsGranted);
    const creditsUsed = Number(input.creditsUsed || 0);
    if (!Number.isInteger(creditsGranted) || creditsGranted < 0) {
      throw new Error("creditsGranted must be a non-negative integer.");
    }
    if (!Number.isInteger(creditsUsed) || creditsUsed < 0 || creditsUsed > creditsGranted) {
      throw new Error("creditsUsed must be a non-negative integer not greater than creditsGranted.");
    }

    const row = (
      await client.query(
        `insert into action_token_grants (
           customer_id,
           subscription_id,
           token_contract_address,
           network_id,
           recipient_shielded_address,
           subscription_key_hex,
           credits_granted,
           credits_used,
           mint_tx_hash,
           mint_tx_id,
           status
         )
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, coalesce($11, 'active'))
         returning *`,
        [
          customer.id,
          input.subscriptionId || null,
          String(input.tokenContractAddress || "").trim(),
          String(input.networkId || "").trim(),
          String(input.recipientShieldedAddress || "").trim(),
          input.subscriptionKeyHex ? String(input.subscriptionKeyHex).trim().toLowerCase() : null,
          creditsGranted,
          creditsUsed,
          input.mintTxHash || null,
          input.mintTxId || null,
          input.status || "active",
        ],
      )
    ).rows[0];

    await audit(client, {
      actorType: "admin",
      actorRef: input.actorRef || "action-token-panel",
      eventType: "action_token_grant_recorded",
      entityType: "action_token_grant",
      entityId: row.id,
      eventData: {
        customerId: customer.id,
        creditsGranted,
        tokenContractAddress: row.token_contract_address,
        networkId: row.network_id,
        mintTxHash: row.mint_tx_hash,
      },
    });

    return row;
  });
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

async function getCurrentRegistryDeploymentForMcpKey(client, input = {}) {
  const where = [];
  const params = [];

  if (input.networkId) {
    params.push(input.networkId);
    where.push(`network_id = $${params.length}`);
  }

  const deployment = (
    await client.query(
      `select *
       from admin_registry_deployments
       ${where.length ? `where ${where.join(" and ")}` : ""}
       order by updated_at desc, created_at desc
       limit 1`,
      params,
    )
  ).rows[0];

  if (!deployment?.contract_address || !deployment?.network_id) {
    throw new Error("Create or select a deployed registry before issuing an MCP key.");
  }

  return deployment;
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

async function getPrimaryWalletForCustomer(client, customerId) {
  const row = (
    await client.query(
      `select wallet_address
       from customer_wallets
       where customer_id = $1
         and approved_at is not null
       order by is_primary desc, approved_at desc, created_at desc
       limit 1`,
      [customerId],
    )
  ).rows[0];

  if (!row?.wallet_address) {
    throw new Error(
      "The authenticated MCP key is not linked to an approved customer wallet.",
    );
  }

  return normalizeWallet(row.wallet_address);
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
    return createCustomerMcpKeyInTransaction(client, input);
  });
}

async function createCustomerMcpKeyInTransaction(client, input) {
  const material = createMcpKey();
  const scopes = normalizeMcpScopes(input.scopes);
  const effectiveScopes = scopes.length ? scopes : DEFAULT_MCP_SCOPES;
  const deployment = await getCurrentRegistryDeploymentForMcpKey(client, {
    networkId: input.networkId,
  });
  const result = await client.query(
    `insert into mcp_keys (
       customer_id,
       label,
       key_id,
       key_hash,
       contract_address,
       network_id,
       status,
       scopes,
       expires_at
     )
     values ($1, $2, $3, $4, $5, $6, 'active', $7::jsonb, $8)
     returning id, customer_id, label, key_id, contract_address, network_id, status, scopes, created_at, expires_at`,
    [
      input.customerId,
      input.label,
      material.keyId,
      material.keyHash,
      deployment.contract_address,
      deployment.network_id,
      JSON.stringify(effectiveScopes),
      input.expiresAt || null,
    ],
  );
  await audit(client, {
    actorType: "customer",
    actorRef: input.customerId,
    eventType: "mcp_key_created",
    entityType: "mcp_key",
    entityId: result.rows[0].id,
    eventData: {
      label: input.label,
      scopes: effectiveScopes,
      contractAddress: deployment.contract_address,
      networkId: deployment.network_id,
    },
  });
  return {
    ...result.rows[0],
    plainTextKey: material.plainText,
  };
}

export async function updateCustomerMcpKeyScopes(input) {
  return withTransaction(async (client) => {
    const scopes = normalizeMcpScopes(input.scopes);
    if (scopes.length === 0) {
      throw new Error("At least one MCP scope must be selected.");
    }
    const result = await client.query(
      `update mcp_keys
       set scopes = $3::jsonb
       where id = $1
         and customer_id = $2
       returning id, customer_id, label, key_id, contract_address, network_id, status, scopes, created_at, last_used_at, expires_at`,
      [input.keyId, input.customerId, JSON.stringify(scopes)],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("MCP key not found.");
    }
    await audit(client, {
      actorType: "customer",
      actorRef: input.customerId,
      eventType: "mcp_key_scopes_updated",
      entityType: "mcp_key",
      entityId: row.id,
      eventData: { keyId: row.key_id, scopes },
    });
    return row;
  });
}

export async function revokeCustomerMcpKey(input) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `update mcp_keys
       set status = 'revoked'
       where id = $1
         and customer_id = $2
         and status = 'active'
       returning id, customer_id, label, key_id, contract_address, network_id, status, scopes, created_at, last_used_at, expires_at`,
      [input.keyId, input.customerId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("MCP key not found or already inactive.");
    }
    await audit(client, {
      actorType: "customer",
      actorRef: input.customerId,
      eventType: "mcp_key_revoked",
      entityType: "mcp_key",
      entityId: row.id,
      eventData: { keyId: row.key_id, label: row.label },
    });
    return row;
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

    const mcpKey = await createCustomerMcpKeyInTransaction(client, {
      customerId: customer.id,
      label: input.mcpLabel || "demo-agent-key",
      scopes: ["did.request", "did.status", "did.resolve", "did.validate"],
      networkId: input.networkId,
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
  const controller = input.controller || requesterWallet;
  const agentId = normalizeAgentId(input.agentId || generateAgentId());
  const requestedDid =
    input.requestedDid ||
    buildDid({
      networkId: input.networkId,
      contractAddress: input.contractAddress,
      agentId,
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
           and agent_id = $2
           and request_status in ('pending_human_approval', 'pending_admin_review')
         order by created_at desc
         limit 1`,
        [input.contractAddress, agentId],
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
               agent_id = $11,
               controller = coalesce($12, controller),
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
            agentId,
            input.controller || null,
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
       agent_id,
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
       human_approved_by_wallet,
       controller
     )
     values (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14, $15, $16, $17, $18, $19
     )
     returning *`,
    [
      input.customerId,
      input.subscriptionId || null,
      input.mcpKeyId || null,
      input.contractAddress,
      input.networkId,
      agentId,
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
      controller,
    ],
  );

  return { row: result.rows[0], subjectWallet, requestedDid, agentId, created: true };
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
  const agentId = normalizeAgentId(input.agentId);
  const agentKey = deriveAgentKey(agentId);
  const controller = input.controller || null;
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
           agent_id,
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
           controller,
           issued_at,
           updated_at
         )
         values (
           $1, $2, $3, $4, $5, $6, $7, $8, 'active', $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb, $16, now(), now()
         )
         returning *`,
        [
          input.requestId || null,
          input.did,
          input.contractAddress,
          input.networkId,
          agentId,
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
          controller,
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
             agent_id = $10,
             controller = coalesce($11, controller),
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
          agentId,
          controller,
        ],
      )
    ).rows[0];
  }

  return { record, customerId: customer.id, agentKey, agentId, issuerWallet };
}

export async function createDidRequest(input) {
  return withTransaction(async (client) => {
    const mcp = await authenticateMcpKey(input.mcpKey);
    if (!mcp) {
      throw new Error("Invalid or expired MCP key.");
    }
    if (!mcp.contract_address || !mcp.network_id) {
      throw new Error("MCP key is not bound to a registry contract. Reissue the MCP key from the platform.");
    }

    const subscription = await getActiveSubscriptionForCustomer(client, mcp.customer_id);
    if (!subscription) {
      throw new Error("No active DID subscription with remaining quota for this customer.");
    }
    const holderWallet = await getPrimaryWalletForCustomer(client, mcp.customer_id);
    const requestPayload = normalizeRequestPayload(input.requestPayload);
    const selectiveDisclosureTemplate = normalizeSelectiveDisclosureTemplate(
      input.selectiveDisclosureTemplate,
    );

    const { row, subjectWallet, requestedDid } =
      await createOrUpdateDidRequestRecord(client, {
        customerId: mcp.customer_id,
        subscriptionId: subscription.id,
        mcpKeyId: mcp.id,
        contractAddress: mcp.contract_address,
        networkId: mcp.network_id,
        requesterWalletAddress: holderWallet,
        agentId: input.agentId,
        // Today the subject wallet is the MCP owner's approved wallet. Later the
        // human approval step can expose this as an editable owned-address choice.
        subjectWalletAddress: holderWallet,
        // controller is server-derived for the MCP flow — the caller never
        // supplies it (see platformGeneratedDidFields in server/mcp-core.js).
        controller: holderWallet,
        requestStatus: "pending_human_approval",
        organizationName: input.organizationName,
        organizationDisclosure: input.organizationDisclosure,
        requestPayload,
        selectiveDisclosureTemplate,
        requestedDid: null,
        onchainRequestTxId: null,
        onchainRequestTxHash: null,
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
        agentId: input.agentId,
        subjectWalletAddress: input.subjectWalletAddress || walletAddress,
        controller: input.controller,
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

// Shared by approveDidRequestByHuman/rejectDidRequestByHuman: the human step
// only ever applies to requests still in 'pending_human_approval' (created
// via the MCP-driven createDidRequest flow, where subject_wallet_address is
// always the same wallet the request was made for) — so the wallet
// authorized to approve/reject is the request's subject_wallet_address.
// Generalizes the ownership-assertion pattern already used by
// approveProofRequestByHuman/rejectProofRequestByHuman
// (server/proof-request-service.js), which compares the acting wallet
// against holder_wallet_address the same way.
async function assertActingWalletOwnsDidRequest(client, requestId, actingWalletAddress) {
  const current = (
    await client.query(`select * from did_requests where id = $1 limit 1`, [requestId])
  ).rows[0];
  if (!current) {
    throw new Error("DID request not found or not pending human approval.");
  }
  const actingWallet = normalizeWallet(actingWalletAddress);
  if (!actingWallet || actingWallet !== normalizeWallet(current.subject_wallet_address)) {
    throw new Error("Connected wallet does not match the DID request's subject wallet.");
  }
  return current;
}

export async function approveDidRequestByHuman(input) {
  return withTransaction(async (client) => {
    await assertActingWalletOwnsDidRequest(client, input.requestId, input.humanWalletAddress);

    const result = await client.query(
      `update did_requests
       set request_status = 'pending_admin_review',
           human_approved_at = now(),
           human_approved_by_wallet = $2,
           requested_did = coalesce($3, requested_did),
           onchain_request_tx_id = coalesce($4, onchain_request_tx_id),
           onchain_request_tx_hash = coalesce($5, onchain_request_tx_hash),
           updated_at = now()
       where id = $1
         and request_status = 'pending_human_approval'
       returning *`,
      [
        input.requestId,
        normalizeWallet(input.humanWalletAddress),
        input.requestedDid || null,
        input.onchainRequestTxId || null,
        input.onchainRequestTxHash || null,
      ],
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
    await assertActingWalletOwnsDidRequest(client, input.requestId, input.humanWalletAddress);

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
  // Defensive check: issueApprovedDidRequest is only reachable in production
  // through the { admin: true } requireSession tier (server/index.js), so
  // route-level gating is what actually enforces "only an admin session may
  // call this" — but the service layer must never silently accept an
  // empty/undefined acting wallet even if a future caller forgets to gate
  // the route, since this value is what gets recorded as admin_decision_by
  // and the audit-trail actorRef.
  const issuerWalletGuard = normalizeWallet(input.issuerWalletAddress);
  if (!issuerWalletGuard) {
    throw new Error("An issuer wallet address is required to issue a DID request.");
  }
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
    if (request.request_status === "issued") {
      const existingRecord = (
        await client.query(
          `select *
           from did_records
           where request_id = $1
              or did = $2
           order by updated_at desc
           limit 1`,
          [request.id, request.requested_did || null],
        )
      ).rows[0];

      return {
        request,
        record: existingRecord || null,
      };
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
    const agentId = normalizeAgentId(request.agent_id);
    if (!agentId) {
      throw new Error("DID request is missing agent_id.");
    }
    const agentKey = deriveAgentKey(agentId);
    const requestedDid =
      request.requested_did ||
      buildDid({
        networkId: request.network_id,
        contractAddress: request.contract_address,
        agentId,
      });
    const didDocument = buildDidDocumentForRequest({
      ...request,
      requested_did: requestedDid,
    });
    if (
      input.didDocument &&
      JSON.stringify(input.didDocument) !== JSON.stringify(didDocument)
    ) {
      throw new Error(
        "Issued DID document does not match the platform-generated document for this request.",
      );
    }
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
      agentId,
      subjectWalletAddress: subjectWallet,
      did: requestedDid,
      contractAddress: request.contract_address,
      networkId: request.network_id,
      organizationName: request.organization_name,
      organizationDisclosure: request.organization_disclosure,
      requestPayload: request.request_payload,
      controller: request.controller,
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
           onchain_request_tx_id = coalesce($3, onchain_request_tx_id),
           onchain_request_tx_hash = coalesce($4, onchain_request_tx_hash),
           onchain_issue_tx_id = $5,
           onchain_issue_tx_hash = $6,
           requested_did = $7,
           updated_at = now()
       where id = $1
       returning *`,
      [
        request.id,
        issuerWallet,
        input.onchainRequestTxId || null,
        input.onchainRequestTxHash || null,
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
    const agentId = normalizeAgentId(input.agentId);
    if (!agentId) {
      throw new Error("Agent ID is required for DID sync.");
    }
    const agentKey = deriveAgentKey(agentId);
    const request = (
      await client.query(
        `select *
         from did_requests
         where contract_address = $1
           and agent_id = $2
         order by created_at desc
         limit 1`,
        [input.contractAddress, agentId],
      )
    ).rows[0];

    const { record } = await upsertIssuedDidRecord(client, {
      requestId: request?.id || null,
      customerId: customer.id,
      issuerWalletAddress: issuerWallet,
      agentId,
      subjectWalletAddress: subjectWallet,
      did: input.did,
      contractAddress: input.contractAddress,
      networkId: input.networkId,
      organizationName: input.organizationName,
      organizationDisclosure: input.organizationDisclosure,
      requestPayload: input.requestPayload,
      controller: input.controller,
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
           controller = coalesce($5, controller),
           updated_at = now()
       where did = $1
       returning *`,
      [
        input.did,
        JSON.stringify(input.didDocument || {}),
        input.documentCommitment || null,
        input.proofCommitment || null,
        input.controller || null,
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
  const agentId = normalizeAgentId(input.agentId);
  if (!agentId) {
    throw new Error("Agent ID is required.");
  }
  const request = (
    await query(
      `select *
       from did_requests
       where contract_address = $1
         and agent_id = $2
       order by created_at desc
       limit 1`,
      [input.contractAddress, agentId],
    )
  ).rows[0] || null;

  const record = (
    await query(
      `select *
       from did_records
       where contract_address = $1
         and agent_id = $2
       order by issued_at desc
       limit 1`,
      [input.contractAddress, agentId],
    )
  ).rows[0] || null;

  return { request, record };
}

export async function rejectDidRequestByAdmin(input) {
  // Defensive check — same rationale as issueApprovedDidRequest: reachable
  // in production only through the { admin: true } requireSession tier, but
  // the service layer must never silently accept an empty/undefined acting
  // wallet, since it's what gets recorded as admin_decision_by and the
  // audit-trail actorRef.
  const adminWalletGuard = normalizeWallet(input.adminWalletAddress);
  if (!adminWalletGuard) {
    throw new Error("An admin wallet address is required to reject a DID request.");
  }
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
       dr.agent_id,
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
       dr.controller,
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
      controller: record.controller || record.did,
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
