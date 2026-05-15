import type { AppProviders } from "../../lib/providers";
import { toHex } from "../../lib/wallet-bridge";
import { buildNativeOwnershipProofInputs } from "../../lib/native-ownership-proof.js";
import type { MidnightProofSubmission, ProofRequestRow } from "../types/service";
import { createProofVerificationPackage } from "./proof-request";

export async function createNativeOwnershipProofPackage(
  providers: AppProviders,
  row: ProofRequestRow,
): Promise<{
  proofRequest: ReturnType<typeof createProofVerificationPackage>["proofRequest"];
  submission: MidnightProofSubmission;
}> {
  if (!row.proof_material.nativeOwnership) {
    throw new Error("Native ownership proof is not available for this request.");
  }

  const coinPublicKey = providers.walletProvider.getCoinPublicKey();
  const proofRequest = createProofVerificationPackage(row).proofRequest;
  const { nativeMaterial, serializedPreimage, publicInputsHash } =
    await buildNativeOwnershipProofInputs({
      did: row.did,
      challenge: row.challenge,
      coinPublicKey,
      nativeMaterial: row.proof_material.nativeOwnership,
    });

  const proofBytes = await providers.circuitProvingProvider.prove(
    serializedPreimage,
    nativeMaterial.keyLocation,
  );

  return {
    proofRequest,
    submission: {
      did: row.did,
      challenge: row.challenge,
      bundleCommitment: nativeMaterial.bundleCommitment,
      holderBindingCommitment: nativeMaterial.holderBindingCommitment,
      coinPublicKey,
      proof: {
        format: "midnight-zk-proof",
        scheme: nativeMaterial.scheme,
        proofValue: toHex(proofBytes),
        publicInputsHash,
        publicInputs: {
          scheme: nativeMaterial.scheme,
          keyLocation: nativeMaterial.keyLocation,
          walletHashHex: nativeMaterial.walletHashHex,
          contractHashHex: nativeMaterial.contractHashHex,
          didHashHex: nativeMaterial.didHashHex,
          challengeHashHex: nativeMaterial.challengeHashHex,
        },
        proverUrl:
          providers.proofProviderSource === "configured_env"
            ? providers.configuredProverServerUrl
            : providers.proverServerUrl,
        generatedBy: "connected-wallet-proof-provider",
        generatedAt: new Date().toISOString(),
      },
    },
  };
}
