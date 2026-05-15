import type {
  MidnightProofRequest,
  MidnightProofSubmission,
  ProofRequestRow,
} from "../types/service";

// Internal type for the { proofRequest, submission } package used locally before assembleVP.
// Exported for WorkflowPanel which builds the package before calling assembleVP.
export interface MidnightProofVerificationPackage {
  proofRequest: MidnightProofRequest;
  submission: MidnightProofSubmission;
}

export function toMidnightProofRequest(row: ProofRequestRow): MidnightProofRequest {
  return {
    requestId: row.id,
    createdAt: row.created_at,
    expiresAt: row.updated_at,
    proofRequestType: "midnight-holder-proof-request",
    material: row.proof_material,
    instructions: [
      "Generate the final holder proof locally in the wallet or a trusted local proof server.",
      "Bind the proof to the provided challenge and holder binding commitment.",
      "Submit the resulting proof envelope together with this proof request for verification.",
    ],
  };
}

export function createProofSubmissionTemplate(
  row: ProofRequestRow,
): MidnightProofSubmission {
  const nativeOwnership = row.proof_material.nativeOwnership;
  return {
    did: row.did,
    challenge: row.challenge,
    bundleCommitment:
      nativeOwnership?.bundleCommitment || row.proof_material.bundleCommitment,
    holderBindingCommitment:
      nativeOwnership?.holderBindingCommitment ||
      row.proof_material.holderBindingCommitment,
    proof: {
      format: nativeOwnership ? "midnight-zk-proof" : "midnight-proof-envelope-v1",
      scheme: nativeOwnership
        ? "midnight-native-ownership-v1"
        : "preview-local-binding-v1",
      proofValue: nativeOwnership
        ? "GENERATE_LOCALLY_OR_PASTE_NATIVE_PROOF_HERE"
        : "GENERATE_LOCALLY_OR_PASTE_PREVIEW_PROOF_HERE",
      publicInputsHash: "GENERATE_LOCALLY_OR_PASTE_NATIVE_PUBLIC_INPUTS_HASH_HERE",
      publicInputs: nativeOwnership
        ? {
            scheme: nativeOwnership.scheme,
            keyLocation: nativeOwnership.keyLocation,
            didHashHex: nativeOwnership.didHashHex,
            challengeHashHex: nativeOwnership.challengeHashHex,
            walletHashHex: nativeOwnership.walletHashHex,
            contractHashHex: nativeOwnership.contractHashHex,
          }
        : undefined,
      generatedBy: "wallet-or-local-proof-server",
    },
  };
}

export function createProofVerificationPackage(
  row: ProofRequestRow,
): MidnightProofVerificationPackage {
  return {
    proofRequest: toMidnightProofRequest(row),
    submission: createProofSubmissionTemplate(row),
  };
}

export function createPreviewProofVerificationPackage(
  row: ProofRequestRow,
): MidnightProofVerificationPackage {
  return {
    proofRequest: toMidnightProofRequest(row),
    submission: {
      did: row.did,
      challenge: row.challenge,
      bundleCommitment: row.proof_material.bundleCommitment,
      holderBindingCommitment: row.proof_material.holderBindingCommitment,
      proof: {
        format: "midnight-proof-envelope-v1",
        scheme: "preview-local-binding-v1",
        proofValue: "GENERATE_LOCALLY_OR_PASTE_PREVIEW_PROOF_HERE",
        generatedBy: "wallet-or-local-proof-server",
      },
    },
  };
}
