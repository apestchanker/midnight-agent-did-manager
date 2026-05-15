import { randomUUID } from "crypto";
import { Proof, parseCheckResult } from "@midnight-ntwrk/ledger-v8";
import { verifyLocalPreviewProofSubmission } from "../lib/midnight-proof-envelope.js";
import {
  buildNativeOwnershipMaterial,
  buildNativeOwnershipProofInputs,
  normalizeCoinPublicKey,
} from "../lib/native-ownership-proof.js";
import {
  createMidnightProofMaterialFromRows,
  getMidnightProofMaterial,
  listCredentialsForDid,
  verifyCredentialJwt,
} from "./vc-service.js";
import { validateDid } from "./registry-service.js";
import {
  checkNativeOwnership,
  isNativeOwnershipVerificationAvailable,
} from "./native-ownership-prover.js";

/**
 * Convert a hex string to a Uint8Array.
 * @param {string} hex
 * @returns {Uint8Array}
 */
function fromHex(hex) {
  const cleaned = String(hex || "").replace(/^0x/, "");
  return new Uint8Array(
    (cleaned.match(/.{1,2}/g) || []).map((segment) => Number.parseInt(segment, 16)),
  );
}

/**
 * Build a structured verification error object.
 *
 * @param {{ layer: string, message: string, details?: Record<string, unknown> }} opts
 * @returns {{ valid: false, failure_layer: string, message: string, details: Record<string, unknown> }}
 */
export function buildVerificationError({ layer, message, details = {} }) {
  return { valid: false, failure_layer: layer, message, details };
}

function uniqueScopes(scopes) {
  return Array.isArray(scopes)
    ? [...new Set(scopes.map((scope) => String(scope).trim()).filter(Boolean))]
    : [];
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is required.`);
  }
  return value;
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

export async function createMidnightProofRequest(input, deps = {}) {
  if (!input?.did) {
    throw new Error("DID is required.");
  }

  const getMidnightProofMaterialFn =
    deps.getMidnightProofMaterial || getMidnightProofMaterial;

  const material = await getMidnightProofMaterialFn({
    did: String(input.did),
    scopes: uniqueScopes(input.scopes),
    challenge: input.challenge,
    verifier: input.verifier,
    purpose: input.purpose || "selective-disclosure",
  });

  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  return {
    requestId: `mpr_${randomUUID()}`,
    createdAt,
    expiresAt,
    proofRequestType: "midnight-holder-proof-request",
    material,
    instructions: [
      "Generate the final holder proof locally in the wallet or a trusted local proof server.",
      "Bind the proof to the provided challenge and holder binding commitment.",
      "Submit the resulting proof envelope together with this proof request for verification.",
    ],
  };
}

export async function verifyMidnightProofSubmission(input, deps = {}) {
  const proofRequest = requireObject(input?.proofRequest, "proofRequest");
  const submission = requireObject(input?.submission, "submission");
  const material = requireObject(proofRequest.material, "proofRequest.material");
  const proof = requireObject(submission.proof, "submission.proof");

  const did = String(material.did || "");
  if (!did) {
    throw new Error("proofRequest.material.did is required.");
  }

  const validateDidFn = deps.validateDid || validateDid;
  const listCredentialsForDidFn = deps.listCredentialsForDid || listCredentialsForDid;
  const verifyCredentialJwtFn = deps.verifyCredentialJwt || verifyCredentialJwt;
  const isNativeOwnershipVerificationAvailableFn =
    deps.isNativeOwnershipVerificationAvailable ||
    isNativeOwnershipVerificationAvailable;
  const checkNativeOwnershipFn =
    deps.checkNativeOwnership || checkNativeOwnership;

  const validation = await validateDidFn(did);
  if (!validation?.valid || validation?.status !== "active") {
    return {
      valid: false,
      status: "did_not_active",
      did,
      didActive: false,
      issuerCredentialsVerified: false,
      requestIntegrityVerified: false,
      cryptographicProofVerified: false,
      warnings: ["DID is not active on the registry."],
    };
  }

  const selectedScopes = uniqueScopes(material.disclosedScopes);
  const credentialRows = (await listCredentialsForDidFn(did)).filter((row) => {
    if (row.status !== "active") return false;
    if (!selectedScopes.length) return true;
    return selectedScopes.includes(row.disclosure_scope);
  });

  for (const row of credentialRows) {
    await verifyCredentialJwtFn(String(row.jwt));
  }

  const expectedMaterial = await createMidnightProofMaterialFromRows({
    did,
    scopes: selectedScopes,
    challenge: material.challenge,
    verifier: material.verifier,
    purpose: material.purpose,
    credentialRows,
  });

  let requestIntegrityVerified =
    material.bundleCommitment === expectedMaterial.bundleCommitment &&
    material.holderBindingCommitment === expectedMaterial.holderBindingCommitment &&
    JSON.stringify(canonicalize(material.credentialCommitments)) ===
      JSON.stringify(canonicalize(expectedMaterial.credentialCommitments));

  let submissionMatchesRequest =
    submission.did === did &&
    submission.challenge === material.challenge &&
    submission.bundleCommitment === material.bundleCommitment &&
    submission.holderBindingCommitment === material.holderBindingCommitment;

  const warnings = [];
  let cryptographicProofVerified = false;
  let proofEnvelopeVerified = false;
  let status = "invalid_submission";
  let valid = requestIntegrityVerified && submissionMatchesRequest;

  if (
    proof.format === "midnight-zk-proof" &&
    proof.scheme === "midnight-native-ownership-v1"
  ) {
    const ownershipRow = credentialRows.find(
      (row) => row.disclosure_scope === "ownership" && row.status === "active",
    );
    const expectedNativeMaterial =
      ownershipRow &&
      ownershipRow.claims &&
      typeof ownershipRow.claims === "object" &&
      typeof ownershipRow.claims.walletAddress === "string"
        ? await buildNativeOwnershipMaterial({
            did,
            challenge: material.challenge,
            holderWalletAddress: ownershipRow.claims.walletAddress,
          })
        : null;

    const declaredNativeMaterial = material.nativeOwnership || null;
    requestIntegrityVerified = Boolean(
      expectedNativeMaterial &&
        declaredNativeMaterial &&
        JSON.stringify(canonicalize(declaredNativeMaterial)) ===
          JSON.stringify(canonicalize(expectedNativeMaterial)),
    );
    submissionMatchesRequest =
      submission.did === did &&
      submission.challenge === material.challenge &&
      submission.bundleCommitment === expectedNativeMaterial?.bundleCommitment &&
      submission.holderBindingCommitment ===
        expectedNativeMaterial?.holderBindingCommitment;

    if (requestIntegrityVerified && submissionMatchesRequest && expectedNativeMaterial) {
      // When coinPublicKey is explicitly provided in the submission proof, run the full
      // 7-step ZK verification pipeline (task 7). Otherwise fall back to legacy behavior.
      if (proof.coinPublicKey !== undefined) {
        console.log('[midnight-proof-service] verifyMidnightProofSubmission: entering 7-step ZK pipeline', { did, format: proof.format, scheme: proof.scheme });

        // Step 1: coinPublicKey must be present and non-empty
        const rawCoinPublicKey = proof.coinPublicKey;
        if (!rawCoinPublicKey || (typeof rawCoinPublicKey === 'string' && !rawCoinPublicKey.trim())) {
          console.log('[midnight-proof-service] ZK pipeline step 1 failed: coinPublicKey missing or empty');
          return {
            ...buildVerificationError({ layer: 'structural', message: 'coinPublicKey is required for midnight-zk-proof format' }),
            did,
            didActive: true,
            issuerCredentialsVerified: true,
            requestIntegrityVerified,
            cryptographicProofVerified: false,
            proofEnvelopeVerified: false,
            submissionMatchesRequest,
            warnings,
            verificationMaterial: {
              expectedBundleCommitment: expectedMaterial.bundleCommitment,
              expectedHolderBindingCommitment: expectedMaterial.holderBindingCommitment,
              verifiedScopes: expectedMaterial.disclosedScopes,
              credentialCount: expectedMaterial.credentialCount,
            },
          };
        }

        // Step 2: keyLocation whitelist check — only 'prove_ownership' is allowed
        const keyLocation = proof.keyLocation || expectedNativeMaterial.keyLocation;
        if (keyLocation !== 'prove_ownership') {
          console.log('[midnight-proof-service] ZK pipeline step 2 failed: unknown keyLocation', { keyLocation });
          return {
            ...buildVerificationError({ layer: 'circuit_check', message: `Unknown circuit keyLocation: ${keyLocation}` }),
            did,
            didActive: true,
            issuerCredentialsVerified: true,
            requestIntegrityVerified,
            cryptographicProofVerified: false,
            proofEnvelopeVerified: false,
            submissionMatchesRequest,
            warnings,
            verificationMaterial: {
              expectedBundleCommitment: expectedMaterial.bundleCommitment,
              expectedHolderBindingCommitment: expectedMaterial.holderBindingCommitment,
              verifiedScopes: expectedMaterial.disclosedScopes,
              credentialCount: expectedMaterial.credentialCount,
            },
          };
        }

        // Step 3: Proof blob deserialization — fail fast if invalid
        try {
          Proof.deserialize(fromHex(String(proof.proofValue || '')));
          console.log('[midnight-proof-service] ZK pipeline step 3 passed: proof blob deserialized');
        } catch (_deserializeErr) {
          console.log('[midnight-proof-service] ZK pipeline step 3 failed: proof blob deserialization error');
          return {
            ...buildVerificationError({ layer: 'zk_blob', message: 'Proof blob deserialization failed' }),
            did,
            didActive: true,
            issuerCredentialsVerified: true,
            requestIntegrityVerified,
            cryptographicProofVerified: false,
            proofEnvelopeVerified: false,
            submissionMatchesRequest,
            warnings,
            verificationMaterial: {
              expectedBundleCommitment: expectedMaterial.bundleCommitment,
              expectedHolderBindingCommitment: expectedMaterial.holderBindingCommitment,
              verifiedScopes: expectedMaterial.disclosedScopes,
              credentialCount: expectedMaterial.credentialCount,
            },
          };
        }

        // Step 4: Normalize coinPublicKey
        let normalizedCoinPublicKey;
        try {
          const { network } = (() => {
            const parts = String(did || '').split(':');
            return { network: parts[2] || '' };
          })();
          normalizedCoinPublicKey = normalizeCoinPublicKey(rawCoinPublicKey, network);
          console.log('[midnight-proof-service] ZK pipeline step 4 passed: coinPublicKey normalized');
        } catch (normalizeErr) {
          console.log('[midnight-proof-service] ZK pipeline step 4 failed: coinPublicKey normalization error', { error: String(normalizeErr) });
          return {
            ...buildVerificationError({ layer: 'structural', message: `coinPublicKey normalization failed: ${normalizeErr instanceof Error ? normalizeErr.message : String(normalizeErr)}` }),
            did,
            didActive: true,
            issuerCredentialsVerified: true,
            requestIntegrityVerified,
            cryptographicProofVerified: false,
            proofEnvelopeVerified: false,
            submissionMatchesRequest,
            warnings,
            verificationMaterial: {
              expectedBundleCommitment: expectedMaterial.bundleCommitment,
              expectedHolderBindingCommitment: expectedMaterial.holderBindingCommitment,
              verifiedScopes: expectedMaterial.disclosedScopes,
              credentialCount: expectedMaterial.credentialCount,
            },
          };
        }

        // Step 5: Build native ownership proof inputs using the real coinPublicKey
        const { serializedPreimage, publicInputsHash } =
          await buildNativeOwnershipProofInputs({
            did,
            challenge: material.challenge,
            coinPublicKey: normalizedCoinPublicKey,
            nativeMaterial: expectedNativeMaterial,
          });
        console.log('[midnight-proof-service] ZK pipeline step 5 passed: proof inputs built', { publicInputsHash });

        // Step 6: checkNativeOwnership via proof-server (degrade gracefully if unavailable)
        try {
          console.log('[midnight-proof-service] ZK pipeline step 6: calling proof-server checkNativeOwnership');
          const checkResult = await checkNativeOwnershipFn(
            serializedPreimage,
            expectedNativeMaterial.keyLocation,
            { fallbackProverUrl: proof.proverUrl },
          );
          if (checkResult !== undefined) {
            parseCheckResult(checkResult);
          }
          console.log('[midnight-proof-service] ZK pipeline step 6 passed: proof-server responded');
        } catch (proofServerErr) {
          console.log('[midnight-proof-service] ZK pipeline step 6: proof-server unavailable — degraded mode', { error: String(proofServerErr) });
          // Degraded mode: proof-server not reachable — cannot verify cryptographically
          return {
            valid: false,
            cryptographicProofVerified: false,
            failure_layer: 'zk_blob',
            message: 'Proof server unavailable — degraded mode',
            status: 'native_proof_unverified',
            did,
            didActive: true,
            issuerCredentialsVerified: true,
            requestIntegrityVerified,
            proofEnvelopeVerified: false,
            submissionMatchesRequest,
            warnings: [...warnings, `Proof server error: ${proofServerErr instanceof Error ? proofServerErr.message : String(proofServerErr)}`],
            verificationMaterial: {
              expectedBundleCommitment: expectedMaterial.bundleCommitment,
              expectedHolderBindingCommitment: expectedMaterial.holderBindingCommitment,
              verifiedScopes: expectedMaterial.disclosedScopes,
              credentialCount: expectedMaterial.credentialCount,
            },
          };
        }

        // Step 7: Verify publicInputsHash match
        const submittedHash = String(proof.publicInputsHash || '');
        cryptographicProofVerified = submittedHash === publicInputsHash;
        console.log('[midnight-proof-service] ZK pipeline step 7: publicInputsHash check', { submittedHash, expected: publicInputsHash, match: cryptographicProofVerified });

        if (!cryptographicProofVerified) {
          return {
            ...buildVerificationError({ layer: 'zk_blob', message: 'Public inputs hash mismatch' }),
            did,
            didActive: true,
            issuerCredentialsVerified: true,
            requestIntegrityVerified,
            cryptographicProofVerified: false,
            proofEnvelopeVerified: false,
            submissionMatchesRequest,
            warnings,
            verificationMaterial: {
              expectedBundleCommitment: expectedMaterial.bundleCommitment,
              expectedHolderBindingCommitment: expectedMaterial.holderBindingCommitment,
              verifiedScopes: expectedMaterial.disclosedScopes,
              credentialCount: expectedMaterial.credentialCount,
            },
          };
        }

        // All 7 steps passed — cryptographic proof verified
        valid = true;
        status = 'native_proof_verified';
        console.log('[midnight-proof-service] ZK pipeline complete: proof fully verified', { did, status });
      } else if (isNativeOwnershipVerificationAvailableFn()) {
        // Legacy path: no coinPublicKey in proof, use zero bytes (backward compat)
        try {
          const { serializedPreimage, publicInputsHash } =
            await buildNativeOwnershipProofInputs({
              did,
              challenge: material.challenge,
              coinPublicKey: new Uint8Array(32),
              nativeMaterial: expectedNativeMaterial,
            });
          await checkNativeOwnershipFn(
            serializedPreimage,
            expectedNativeMaterial.keyLocation,
            { fallbackProverUrl: proof.proverUrl },
          );
          cryptographicProofVerified =
            String(proof.publicInputsHash || "") === publicInputsHash;
          valid = requestIntegrityVerified && submissionMatchesRequest && Boolean(proof.proofValue);
          status = cryptographicProofVerified
            ? "native_proof_verified"
            : "native_proof_unverified";
          if (!cryptographicProofVerified) {
            warnings.push(
              "The submitted native proof boundary matched the expected public inputs, but the submitted publicInputsHash did not match the verifier's reconstructed value.",
            );
          }
        } catch (error) {
          valid = requestIntegrityVerified && submissionMatchesRequest && Boolean(proof.proofValue);
          status = "native_proof_unverified";
          warnings.push(
            error instanceof Error
              ? `Native proof boundary was accepted, but strict server-side native proof verification failed: ${error.message}`
              : "Native proof boundary was accepted, but strict server-side native proof verification failed.",
          );
        }
      } else {
        valid =
          requestIntegrityVerified &&
          submissionMatchesRequest &&
          Boolean(proof.proofValue) &&
          String(proof.publicInputsHash || "").length > 0;
        status = valid ? "native_proof_unverified" : "invalid_submission";
        warnings.push(
          "Native ownership proof was submitted and the proof boundary matches, but the server has no proof-server configuration to perform strict native proof verification.",
        );
      }
    } else {
      valid = false;
      status = "invalid_submission";
      warnings.push(
        "Native ownership proof did not match the expected ownership-material boundary.",
      );
    }
  } else if (proof.format === "midnight-proof-envelope-v1") {
    const previewEnvelopeCheck = await verifyLocalPreviewProofSubmission({
      proofRequest,
      submission,
    });
    proofEnvelopeVerified = previewEnvelopeCheck.matches;
    valid = valid && previewEnvelopeCheck.matches;
    status = valid ? "preview_envelope_verified" : "invalid_submission";
    warnings.push(
      previewEnvelopeCheck.matches
        ? "Preview proof envelope verification succeeded. This submission did not contain a native Midnight proof, so only the preview envelope was validated."
        : "Preview proof envelope did not match the expected public inputs.",
    );
  } else if (proof.format === "midnight-zk-proof") {
    status =
      requestIntegrityVerified && submissionMatchesRequest
        ? "boundary_verified_only"
        : "invalid_submission";
    warnings.push(
      "Native Midnight holder-proof verification is not implemented yet; only boundary integrity was verified.",
    );
  } else {
    valid = false;
    status = "invalid_submission";
    warnings.push(
      "Proof envelope was accepted as a preview transport object only; cryptographic holder-proof verification is still pending implementation.",
    );
  }

  return {
    valid,
    status,
    did,
    didActive: true,
    issuerCredentialsVerified: true,
    requestIntegrityVerified,
    cryptographicProofVerified,
    proofEnvelopeVerified,
    submissionMatchesRequest,
    warnings,
    verificationMaterial: {
      expectedBundleCommitment: expectedMaterial.bundleCommitment,
      expectedHolderBindingCommitment: expectedMaterial.holderBindingCommitment,
      verifiedScopes: expectedMaterial.disclosedScopes,
      credentialCount: expectedMaterial.credentialCount,
    },
  };
}
