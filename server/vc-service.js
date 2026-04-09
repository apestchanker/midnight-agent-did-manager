import { createHash, randomUUID } from "crypto";
import { jwtVerify, SignJWT } from "jose";
import { buildNativeOwnershipMaterial } from "../lib/native-ownership-proof.js";
import { query, withTransaction } from "./db.js";
import { getIssuerKeys } from "./issuer-keys.js";

function vcEnvelope(input) {
  return {
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    id: input.id,
    type: ["VerifiableCredential", input.credentialType],
    issuer: input.issuer,
    validFrom: input.validFrom,
    credentialSubject: {
      id: input.subjectDid,
      ...input.claims,
    },
  };
}

async function signVcJwt(input) {
  const issuer = await getIssuerKeys();
  const jti = `urn:uuid:${randomUUID()}`;
  const now = Math.floor(Date.now() / 1000);
  const vc = vcEnvelope({
    id: jti,
    credentialType: input.credentialType,
    issuer: issuer.issuerId,
    validFrom: new Date(now * 1000).toISOString(),
    subjectDid: input.subjectDid,
    claims: input.claims,
  });

  const jwt = await new SignJWT({
    vc,
  })
    .setProtectedHeader({
      alg: "EdDSA",
      typ: "vc+jwt",
      kid: issuer.publicJwk.kid,
    })
    .setIssuer(issuer.issuerId)
    .setSubject(input.subjectDid)
    .setJti(jti)
    .setIssuedAt(now)
    .setNotBefore(now)
    .setExpirationTime(input.expiresIn || "365d")
    .sign(issuer.privateKey);

  return {
    jwt,
    jti,
    issuerId: issuer.issuerId,
  };
}

export async function issueAtomicCredentials(input) {
  const run = async (client) => {
    const templates = [];

    templates.push({
      credentialType: "AgentDidOwnershipCredential",
      disclosureScope: "ownership",
      claims: {
        walletAddress: input.subjectWalletAddress,
        agentKey: input.subjectAgentKey,
        contractAddress: input.contractAddress,
        networkId: input.networkId,
        registryStatus: input.status,
      },
    });

    if (input.profileName) {
      templates.push({
        credentialType: "AgentProfileNameCredential",
        disclosureScope: "name",
        claims: {
          name: input.profileName,
        },
      });
    }

    if (input.organizationName) {
      templates.push({
        credentialType: "AgentOrganizationCredential",
        disclosureScope: "organization",
        claims: {
          organization: input.organizationName,
          disclosure: input.organizationDisclosure || "undisclosed",
        },
      });
    }

    const issued = [];
    for (const template of templates) {
      const signed = await signVcJwt({
        credentialType: template.credentialType,
        subjectDid: input.subjectDid,
        claims: template.claims,
      });

      const result = await client.query(
        `insert into verifiable_credentials (
           did_record_id,
           request_id,
           customer_id,
           credential_type,
           disclosure_scope,
           jwt,
           issuer_id,
           subject_did,
           claims
         )
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
         returning *`,
        [
          input.didRecordId,
          input.requestId || null,
          input.customerId || null,
          template.credentialType,
          template.disclosureScope,
          signed.jwt,
          signed.issuerId,
          input.subjectDid,
          JSON.stringify(template.claims),
        ],
      );
      issued.push(result.rows[0]);
    }

    return issued;
  };

  if (input.client) {
    return run(input.client);
  }

  return withTransaction(run);
}

export async function rotateCredentialsForDid(input, deps = {}) {
  const issueAtomicCredentialsFn =
    deps.issueAtomicCredentials || issueAtomicCredentials;
  return withTransaction(async (client) => {
    const recordResult = await client.query(
      `select dr.*, req.customer_id
       from did_records dr
       left join did_requests req on req.id = dr.request_id
       where dr.did = $1
       limit 1`,
      [input.did],
    );
    const record = recordResult.rows[0];
    if (!record) {
      throw new Error("DID record not found.");
    }
    if (record.status !== "active") {
      throw new Error("Credentials can only be rotated for an active DID.");
    }

    const revoked = await client.query(
      `update verifiable_credentials
       set status = 'revoked',
           revoked_at = now()
       where did_record_id = $1
         and status = 'active'
       returning id`,
      [record.id],
    );

    const didDocument =
      record.did_document && typeof record.did_document === "object"
        ? record.did_document
        : {};

    const issued = await issueAtomicCredentialsFn({
      client,
      didRecordId: record.id,
      requestId: record.request_id || null,
      customerId: record.customer_id || null,
      subjectDid: record.did,
      subjectWalletAddress: record.subject_wallet_address,
      subjectAgentKey: record.subject_agent_key,
      contractAddress: record.contract_address,
      networkId: record.network_id,
      status: record.status,
      organizationName: record.organization_name || null,
      organizationDisclosure: record.organization_disclosure || "undisclosed",
      profileName:
        typeof didDocument.agentName === "string" ? didDocument.agentName : null,
    });

    return {
      did: record.did,
      revokedCount: revoked.rowCount || 0,
      issuedCount: issued.length,
      credentials: issued,
    };
  });
}

export async function listCredentialsForDid(did) {
  const result = await query(
    `select id, credential_type, disclosure_scope, issuer_id, subject_did, claims, status, issued_at, expires_at, jwt
     from verifiable_credentials
     where subject_did = $1
     order by issued_at asc`,
    [did],
  );
  return result.rows;
}

export async function getCredentialBundle(input) {
  const params = [input.did];
  let where = `subject_did = $1 and status = 'active'`;

  if (input.scopes?.length) {
    params.push(input.scopes);
    where += ` and disclosure_scope = any($2::text[])`;
  }

  const result = await query(
    `select id, credential_type, disclosure_scope, issuer_id, subject_did, claims, status, issued_at, expires_at, jwt
     from verifiable_credentials
     where ${where}
     order by issued_at asc`,
    params,
  );

  const verifiableCredentials = result.rows.map((row) => row.jwt);
  return {
    holder: input.did,
    disclosedScopes: input.scopes || [],
    verifiableCredentials,
    presentation: {
      "@context": ["https://www.w3.org/ns/credentials/v2"],
      type: ["VerifiablePresentation"],
      holder: input.did,
      verifiableCredential: verifiableCredentials,
    },
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = canonicalize(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeScopes(scopes) {
  return Array.isArray(scopes)
    ? [...new Set(scopes.map((scope) => String(scope).trim()).filter(Boolean))]
    : [];
}

function buildCredentialCommitment(row) {
  const claimObject =
    row?.claims && typeof row.claims === "object" && !Array.isArray(row.claims)
      ? row.claims
      : {};
  const normalizedClaims = canonicalize(claimObject);
  const commitmentPayload = JSON.stringify({
    subjectDid: row.subject_did,
    issuerId: row.issuer_id,
    disclosureScope: row.disclosure_scope,
    credentialType: row.credential_type,
    claims: normalizedClaims,
  });

  return {
    scope: row.disclosure_scope,
    credentialType: row.credential_type,
    claimKeys: Object.keys(normalizedClaims),
    commitment: sha256Hex(commitmentPayload),
  };
}

export async function createMidnightProofMaterialFromRows(input) {
  const scopes = normalizeScopes(input.scopes);
  const filteredRows = input.credentialRows.filter((row) => {
    if (row.status !== "active") return false;
    if (!scopes.length) return true;
    return scopes.includes(row.disclosure_scope);
  });
  const credentialCommitments = filteredRows.map(buildCredentialCommitment);
  const commitmentList = credentialCommitments.map((item) => item.commitment);
  const challenge = String(input.challenge || randomUUID());
  const verifier = input.verifier ? String(input.verifier) : undefined;
  const purpose = String(input.purpose || "did-authentication");
  const bundleCommitment = sha256Hex(
    JSON.stringify({
      did: input.did,
      scopes,
      commitments: commitmentList,
    }),
  );
  const holderBindingCommitment = sha256Hex(
    JSON.stringify({
      holder: input.did,
      challenge,
      verifier: verifier || "",
      purpose,
      bundleCommitment,
    }),
  );
  const ownershipRow = filteredRows.find(
    (row) =>
      row.disclosure_scope === "ownership" &&
      row.claims &&
      typeof row.claims === "object" &&
      typeof row.claims.walletAddress === "string" &&
      typeof row.claims.agentKey === "string" &&
      typeof row.claims.contractAddress === "string",
  );

  const material = {
    did: input.did,
    holder: input.did,
    network: "midnight",
    proofType: "midnight-credential-commitment",
    challenge,
    ...(verifier ? { verifier } : {}),
    purpose,
    disclosedScopes: scopes,
    credentialCount: credentialCommitments.length,
    credentialCommitments,
    bundleCommitment,
    holderBindingCommitment,
    verificationHints: {
      statusCheck: "resolve-did-and-check-active",
      issuerCheck: "verify-vc-jwt-signatures",
      holderBinding: "holder-binding-midnight-proof-required",
    },
  };

  if (ownershipRow) {
    material.nativeOwnership = await buildNativeOwnershipMaterial({
      did: input.did,
      challenge,
      holderWalletAddress: ownershipRow.claims.walletAddress,
    });
  }

  return material;
}

export async function getMidnightProofMaterial(input) {
  const credentialRows = await listCredentialsForDid(input.did);
  return createMidnightProofMaterialFromRows({
    ...input,
    credentialRows,
  });
}

export async function verifyCredentialJwt(jwt) {
  const issuer = await getIssuerKeys();
  const result = await jwtVerify(jwt, issuer.publicKey, {
    issuer: issuer.issuerId,
  });
  return {
    header: result.protectedHeader,
    payload: result.payload,
    issuer: issuer.issuerId,
    publicJwk: issuer.publicJwk,
  };
}

export async function verifyPresentation(input) {
  const presentation = input?.presentation;
  if (!presentation || typeof presentation !== "object") {
    throw new Error("Presentation payload is required.");
  }

  const holder = String(presentation.holder || "");
  const credentials = Array.isArray(presentation.verifiableCredential)
    ? presentation.verifiableCredential
    : [];

  if (!holder) {
    throw new Error("Presentation holder is required.");
  }

  const verifiedCredentials = [];
  for (const jwt of credentials) {
    const verified = await verifyCredentialJwt(String(jwt));
    if (verified.payload.sub !== holder) {
      throw new Error("Credential subject does not match presentation holder.");
    }
    verifiedCredentials.push(verified);
  }

  return {
    valid: true,
    holder,
    credentialCount: verifiedCredentials.length,
    verifiedCredentials,
    warning:
      "Presentation structure is W3C-aligned, but holder-bound proof is not implemented yet. Verification currently relies on the embedded VC signatures and holder/subject matching.",
  };
}

export async function getIssuerDescriptor() {
  const issuer = await getIssuerKeys();
  return {
    id: issuer.issuerId,
    publicJwk: issuer.publicJwk,
    proofFormat: "vc+jwt",
    algorithm: "EdDSA",
  };
}
