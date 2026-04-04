import type { AppProviders } from "../../lib/providers";
import type {
  DidRecord,
  IssueDidInput,
  RegistryAccess,
  RegistrySummary,
  RevokeDidInput,
  UpdateDidInput,
} from "../types/did";
import { DidRegistryAPI } from "./did/api";
import {
  compileDidRegistry,
  deployDidRegistry,
  issueDidWithSync,
  requestDidWithSync,
  revokeDidWithSync,
  updateDidWithSync,
} from "./did/app-api";
import {
  getSavedCompileArtifact,
  getSavedContractAddress,
  getSavedDeployment,
} from "./did/cache";
import {
  exportOwnerVaultBackup,
  getOwnerVaultStatus,
  restoreOwnerVaultBackup,
} from "./did/vault";

async function joinDidRegistryApi(
  providers: AppProviders,
  contractAddress: string,
): Promise<DidRegistryAPI> {
  return DidRegistryAPI.join(providers, contractAddress);
}

export { DidRegistryAPI };
export {
  compileDidRegistry,
  deployDidRegistry,
  exportOwnerVaultBackup,
  getOwnerVaultStatus,
  getSavedCompileArtifact,
  getSavedContractAddress,
  getSavedDeployment,
  restoreOwnerVaultBackup,
};
export type { OwnerVaultStatus } from "./did/types";

export async function requestDid(
  providers: AppProviders,
  input: {
    contractAddress: string;
    requesterWalletAddress: string;
    agentAddress: string;
    agentName?: string;
    organization?: string;
    organizationDisclosure: "disclosed" | "undisclosed";
    didDocument: string;
  },
): Promise<DidRecord> {
  const api = await joinDidRegistryApi(providers, input.contractAddress);
  return requestDidWithSync(api, {
    requesterWalletAddress: input.requesterWalletAddress,
    agentAddress: input.agentAddress,
    agentName: input.agentName,
    organization: input.organization,
    organizationDisclosure: input.organizationDisclosure,
    didDocument: input.didDocument,
  });
}

export async function issueDid(
  providers: AppProviders,
  input: IssueDidInput,
): Promise<DidRecord> {
  const api = await joinDidRegistryApi(providers, input.contractAddress);
  return issueDidWithSync(api, input);
}

export async function updateDid(
  providers: AppProviders,
  input: UpdateDidInput,
): Promise<DidRecord> {
  const api = await joinDidRegistryApi(providers, input.contractAddress);
  return updateDidWithSync(api, input);
}

export async function revokeDid(
  providers: AppProviders,
  input: RevokeDidInput,
): Promise<DidRecord> {
  const api = await joinDidRegistryApi(providers, input.contractAddress);
  return revokeDidWithSync(api, input);
}

export async function fetchDidRecord(
  providers: AppProviders,
  contractAddress: string,
  agentAddress: string,
): Promise<DidRecord | null> {
  const api = await joinDidRegistryApi(providers, contractAddress);
  return api.fetchDidRecord(agentAddress);
}

export async function fetchRegistrySummary(
  providers: AppProviders,
  contractAddress: string,
): Promise<RegistrySummary | null> {
  const api = await joinDidRegistryApi(providers, contractAddress);
  return api.fetchRegistrySummary();
}

export async function fetchRegistryAccess(
  providers: AppProviders,
  contractAddress: string,
  walletAddress: string,
): Promise<RegistryAccess | null> {
  const api = await joinDidRegistryApi(providers, contractAddress);
  return api.fetchRegistryAccess(walletAddress);
}
