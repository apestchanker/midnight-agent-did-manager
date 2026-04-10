import { randomUUID } from "crypto";
import { verifyLocalPreviewProofSubmission } from "../lib/midnight-proof-envelope.js";
import {
  buildNativeOwnershipMaterial,
  buildNativeOwnershipProofInputs,
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
      if (isNativeOwnershipVerificationAvailableFn()) {
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
