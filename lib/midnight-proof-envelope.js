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

function stableJson(value) {
  return JSON.stringify(canonicalize(value));
}

function bytesToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(value) {
  const input = typeof value === "string" ? value : stableJson(value);
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(digest);
}

export function buildProofEnvelopePublicInputs({ proofRequest, submission }) {
  return {
    requestId: proofRequest.requestId,
    did: proofRequest.material.did,
    holder: proofRequest.material.holder,
    proofType: proofRequest.material.proofType,
    purpose: proofRequest.material.purpose,
    verifier: proofRequest.material.verifier || null,
    disclosedScopes: proofRequest.material.disclosedScopes,
    credentialCount: proofRequest.material.credentialCount,
    challenge: submission.challenge,
    bundleCommitment: submission.bundleCommitment,
    holderBindingCommitment: submission.holderBindingCommitment,
  };
}

export async function createLocalPreviewProofSubmission({
  proofRequest,
  submission,
  generatedBy = "browser-local-preview-prover",
}) {
  const publicInputs = buildProofEnvelopePublicInputs({ proofRequest, submission });
  const publicInputsHash = await sha256Hex(publicInputs);
  const proofValue = await sha256Hex({
    scheme: "preview-local-binding-v1",
    publicInputsHash,
    holder: proofRequest.material.holder,
    proofType: proofRequest.material.proofType,
  });

  return {
    ...submission,
    proof: {
      format: "midnight-proof-envelope-v1",
      scheme: "preview-local-binding-v1",
      proofValue,
      publicInputsHash,
      generatedBy,
      generatedAt: new Date().toISOString(),
    },
  };
}

export async function verifyLocalPreviewProofSubmission({ proofRequest, submission }) {
  const proof = submission?.proof || {};
  if (
    proof.format !== "midnight-proof-envelope-v1" ||
    proof.scheme !== "preview-local-binding-v1"
  ) {
    return {
      matches: false,
      reason: "not_preview_envelope",
    };
  }

  const publicInputs = buildProofEnvelopePublicInputs({ proofRequest, submission });
  const expectedPublicInputsHash = await sha256Hex(publicInputs);
  const expectedProofValue = await sha256Hex({
    scheme: "preview-local-binding-v1",
    publicInputsHash: expectedPublicInputsHash,
    holder: proofRequest.material.holder,
    proofType: proofRequest.material.proofType,
  });

  return {
    matches:
      proof.publicInputsHash === expectedPublicInputsHash &&
      proof.proofValue === expectedProofValue,
    reason:
      proof.publicInputsHash === expectedPublicInputsHash &&
      proof.proofValue === expectedProofValue
        ? null
        : "preview_envelope_mismatch",
    expectedPublicInputsHash,
    expectedProofValue,
  };
}
