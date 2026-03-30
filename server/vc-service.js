import { randomUUID } from "crypto";
import { jwtVerify, SignJWT } from "jose";
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
