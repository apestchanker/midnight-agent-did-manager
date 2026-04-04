import type { AppProviders } from "../../../lib/providers";
import type {
  DidRecord,
  DeployResult,
  IssueDidInput,
  RevokeDidInput,
  UpdateDidInput,
} from "../../types/did";
import { createWalletDidRequest, syncWalletIssuedDidStorage, syncWalletRevokedDidStorage, syncWalletUpdatedDidStorage } from "./service-sync";
import { createDidIdentifier } from "./commitments";
import { DidRegistryAPI } from "./api";
import { getSavedCompileArtifact, mergeDidMetadata, saveCompileArtifact, saveDeployment } from "./cache";
import { MANAGED_CONTRACT_BASE_PATH, type CompileResult } from "./types";
import { loadManagedContractModule } from "./runtime";

export async function compileDidRegistry(
  providers: AppProviders,
): Promise<CompileResult> {
  await loadManagedContractModule();

  saveCompileArtifact({
    managedPath: MANAGED_CONTRACT_BASE_PATH,
    checkedAt: new Date().toISOString(),
    networkId: providers.networkId,
  });

  return {
    success: true,
    message: `Managed Compact assets loaded from ${MANAGED_CONTRACT_BASE_PATH}. The app is ready to deploy on ${providers.networkId}.`,
  };
}

export async function deployDidRegistry(
  providers: AppProviders,
): Promise<DeployResult> {
  const compileData = getSavedCompileArtifact();
  if (!compileData) {
    throw new Error(
      "Managed contract assets have not been validated yet. Load the compiled contract first.",
    );
  }

  const api = await DidRegistryAPI.deploy(providers);
  const deployed = api.getDeployMetadata();
  const result: DeployResult = {
    contractAddress: api.contractAddress,
    txHash: String(deployed?.deployTxData?.public?.txHash || ""),
    txId: String(deployed?.deployTxData?.public?.txId || ""),
    txStatus: "confirmed",
    mode: "onchain",
    deployedAt: new Date().toISOString(),
    networkId: providers.networkId,
    message:
      "Contract deployed to Midnight. A random owner secret was generated, only the derived public authorization key was stored on-chain, and the owner vault was saved to Midnight private state. Export a backup before relying on this registry.",
  };

  saveDeployment({
    ...result,
    networkId: providers.networkId,
    deployedAt: result.deployedAt || new Date().toISOString(),
  });
  return result;
}

export async function requestDidWithSync(
  api: DidRegistryAPI,
  input: {
    requesterWalletAddress: string;
    agentAddress: string;
    agentName?: string;
    organization?: string;
    organizationDisclosure: "disclosed" | "undisclosed";
    didDocument: string;
  },
): Promise<DidRecord> {
  const record = await api.requestDid(input);
  const now = new Date().toISOString();
  mergeDidMetadata(api.contractAddress, input.agentAddress, {
    agentName: input.agentName,
    organization:
      input.organizationDisclosure === "disclosed"
        ? input.organization
        : undefined,
    organizationDisclosure: input.organizationDisclosure,
    didDocument: input.didDocument.trim(),
    createdAt: now,
    updatedAt: now,
    txHash: record.txHash,
    txId: record.txId,
    requestCommitmentHex: record.requestCommitmentHex,
    proofCommitmentHex: record.proofCommitmentHex,
  });

  const requestedDid = await createDidIdentifier(
    api.providers.networkId,
    api.contractAddress,
    record.agentKeyHex,
  );

  try {
    await createWalletDidRequest({
      walletAddress: input.requesterWalletAddress,
      subjectWalletAddress: input.agentAddress,
      contractAddress: api.contractAddress,
      networkId: api.providers.networkId,
      organizationName: input.organization,
      organizationDisclosure: input.organizationDisclosure,
      requestPayload: {
        agentName: input.agentName || null,
        didDocument: input.didDocument.trim(),
      },
      requestedDid,
      onchainRequestTxId: record.txId,
      onchainRequestTxHash: record.txHash,
    });
  } catch (error) {
    throw new Error(
      `The on-chain DID request was confirmed, but persistence to the DID service database failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return record;
}

export async function issueDidWithSync(
  api: DidRegistryAPI,
  input: IssueDidInput,
): Promise<DidRecord> {
  const record = await api.issueDid(input);
  try {
    await syncWalletIssuedDidStorage({
      issuerWalletAddress: api.providers.unshieldedAddress,
      subjectWalletAddress: input.agentAddress,
      contractAddress: api.contractAddress,
      networkId: api.providers.networkId,
      did: record.did || "",
      organizationName: record.organization,
      organizationDisclosure: record.organizationDisclosure || "undisclosed",
      requestPayload: {
        agentName: record.agentName || null,
        didDocument: input.didDocument.trim(),
      },
      didDocument: JSON.parse(input.didDocument),
      didCommitment: record.didCommitmentHex,
      documentCommitment: record.documentHashHex,
      proofCommitment: record.proofCommitmentHex,
      onchainIssueTxId: record.txId,
      onchainIssueTxHash: record.txHash,
    });
  } catch (error) {
    throw new Error(
      `The on-chain DID issuance was confirmed, but persistence to the DID service database failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return record;
}

export async function updateDidWithSync(
  api: DidRegistryAPI,
  input: UpdateDidInput,
): Promise<DidRecord> {
  const record = await api.updateDid(input);
  try {
    await syncWalletUpdatedDidStorage({
      did: record.did || "",
      didDocument: JSON.parse(input.didDocument),
      documentCommitment: record.documentHashHex,
      proofCommitment: record.proofCommitmentHex,
    });
  } catch (error) {
    throw new Error(
      `The on-chain DID update was confirmed, but persistence to the DID service database failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return record;
}

export async function revokeDidWithSync(
  api: DidRegistryAPI,
  input: RevokeDidInput,
): Promise<DidRecord> {
  const record = await api.revokeDid(input);
  try {
    await syncWalletRevokedDidStorage({
      did: record.did || "",
      revocationCommitment: record.revocationCommitmentHex,
    });
  } catch (error) {
    throw new Error(
      `The on-chain DID revocation was confirmed, but persistence to the DID service database failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return record;
}
