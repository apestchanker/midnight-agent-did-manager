import type { AppProviders } from "../../../lib/providers";
import type {
  DidRecord,
  DeployResult,
  IssueDidInput,
  RevokeDidInput,
  UpdateDidInput,
} from "../../types/did";
import type { CapabilityProof, TokenBalance } from "../token/token-types.js";
import type { TokenProviders } from "../token/token-witness.js";
import {
  createWalletDidRequest,
  syncWalletIssuedDidStorage,
  syncWalletRevokedDidStorage,
  syncWalletUpdatedDidStorage,
} from "./service-sync";
import { createDidIdentifier } from "./commitments";
import type { UnifiedRegistryAPI } from "../registry/unified-registry-api";
import {
  getSavedCompileArtifact,
  mergeDidMetadata,
  saveCompileArtifact,
  saveDeployment,
} from "./cache";
import { MANAGED_CONTRACT_BASE_PATH, type CompileResult } from "./types";
import { loadManagedContractModule } from "./runtime";

type AnyRegistryAPI = UnifiedRegistryAPI;

export async function compileDidRegistry(
  providers: AppProviders,
): Promise<CompileResult> {
  try {
    await loadManagedContractModule();
  } catch {
    throw new Error("DID Registry artifact not found. Run npm run compile-contract.");
  }

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


/**
 * Deploy the unified DID registry + token-gating contract (v3).
 * No separate token-gating contract needed — everything is in one contract.
 *
 * Owner decision, 2026-07-21 (see the extensive comment on the Compact
 * constructor in did_registry.compact.template — do not revert without the
 * project owner's explicit sign-off): deploy and the genesis admin token
 * mint are two separate transactions, not one atomic tx. This function only
 * performs the first (deploy) — call initializeAdmin() as a separate,
 * explicit step once this resolves. Splitting them into distinct UI actions
 * (rather than chaining them in one function) makes each transaction
 * independently retryable and easier to debug against remote infra, where
 * failures in the second step were previously indistinguishable from
 * failures in the first.
 */
export async function deployUnifiedRegistry(
  providers: AppProviders,
): Promise<DeployResult> {
  const compileData = getSavedCompileArtifact();
  if (!compileData) {
    throw new Error(
      "Managed contract assets have not been validated yet. Load the compiled contract first.",
    );
  }

  const { UnifiedRegistryAPI } = await import("../registry/unified-registry-api");
  const api = await UnifiedRegistryAPI.deploy(providers);
  const deployed = api.getDeployMetadata();

  const result: DeployResult = {
    contractAddress: api.contractAddress,
    txHash: String(deployed?.public?.txHash || ""),
    txId: String(deployed?.public?.txId || ""),
    txStatus: "confirmed",
    mode: "onchain",
    deployedAt: new Date().toISOString(),
    networkId: providers.networkId,
    message:
      "Unified DID registry deployed to Midnight. Token gating and DID operations share this single contract. No admin token exists yet — run Initialize Admin as a separate step.",
  };

  saveDeployment({
    ...result,
    networkId: providers.networkId,
    deployedAt: result.deployedAt || new Date().toISOString(),
  });
  return result;
}

/**
 * Second step of the two-transaction admin bootstrap (see
 * deployUnifiedRegistry() above and the owner decision it references): mints
 * the genesis admin token to the caller's wallet on an already-deployed
 * contract. Rejoins the contract by address rather than reusing a live
 * UnifiedRegistryAPI instance, so this can be called as its own action any
 * time after deploy — including in a later session, or as a retry after a
 * prior attempt failed — not only immediately after deploy() resolves.
 */
export async function initializeAdmin(
  providers: AppProviders,
  contractAddress: string,
): Promise<{ initializeTxHash: string; initializeTxId?: string }> {
  const { UnifiedRegistryAPI } = await import("../registry/unified-registry-api");
  const api = await UnifiedRegistryAPI.join(providers, contractAddress);
  const adminRegistration = await api.registerInitialAdmin();
  return {
    initializeTxHash: adminRegistration.txHash,
    initializeTxId: adminRegistration.txId,
  };
}

export async function requestDidWithSync(
  api: AnyRegistryAPI,
  input: {
    requesterWalletAddress: string;
    agentId: string;
    subjectWalletAddress: string;
    controller?: string;
    agentName?: string;
    organization?: string;
    organizationDisclosure: "disclosed" | "undisclosed";
    didDocument: string;
    capabilityProof?: CapabilityProof;
  },
): Promise<DidRecord> {
  const record = await api.requestDid(input);
  const now = new Date().toISOString();
  mergeDidMetadata(api.contractAddress, input.agentId, {
    subjectWalletAddress: input.subjectWalletAddress,
    controller: input.controller,
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
    record.didKeyHex || record.agentKeyHex,
  );

  try {
    await createWalletDidRequest({
      walletAddress: input.requesterWalletAddress,
      agentId: input.agentId,
      subjectWalletAddress: input.subjectWalletAddress,
      contractAddress: api.contractAddress,
      networkId: api.providers.networkId,
      organizationName: input.organization,
      organizationDisclosure: input.organizationDisclosure,
      requestPayload: {
        agentId: input.agentId,
        agentName: input.agentName || null,
        didDocument: input.didDocument.trim(),
      },
      requestedDid,
      onchainRequestTxId: record.txId,
      onchainRequestTxHash: record.txHash,
      controller: input.controller,
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
  api: AnyRegistryAPI,
  input: IssueDidInput,
): Promise<DidRecord> {
  const record = await api.issueDid(input);
  try {
    await syncWalletIssuedDidStorage({
      issuerWalletAddress: api.providers.unshieldedAddress,
      agentId: input.agentId,
      subjectWalletAddress: input.subjectWalletAddress || "",
      contractAddress: api.contractAddress,
      networkId: api.providers.networkId,
      did: record.did || "",
      organizationName: record.organization,
      organizationDisclosure: record.organizationDisclosure || "undisclosed",
      requestPayload: {
        agentId: input.agentId,
        agentName: record.agentName || null,
        didDocument: input.didDocument.trim(),
      },
      didDocument: JSON.parse(input.didDocument),
      didCommitment: record.didCommitmentHex,
      documentCommitment: record.documentHashHex,
      proofCommitment: record.proofCommitmentHex,
      onchainIssueTxId: record.txId,
      onchainIssueTxHash: record.txHash,
      controller: input.controller,
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

/**
 * Returns the current token balance for the user (REQ-12).
 * Reads from the local private state — no on-chain query needed.
 */
export function getTokenBalance(tokenProviders: TokenProviders): TokenBalance {
  return tokenProviders.stateManager.getBalance();
}

export async function updateDidWithSync(
  api: AnyRegistryAPI,
  input: UpdateDidInput & { capabilityProof?: CapabilityProof },
): Promise<DidRecord> {
  const record = await api.updateDid(input);
  try {
    await syncWalletUpdatedDidStorage({
      did: record.did || "",
      didDocument: JSON.parse(input.didDocument),
      documentCommitment: record.documentHashHex,
      proofCommitment: record.proofCommitmentHex,
      controller: input.controller,
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
  api: AnyRegistryAPI,
  input: RevokeDidInput & { capabilityProof?: CapabilityProof },
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
