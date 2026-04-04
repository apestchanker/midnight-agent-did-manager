import type { AppProviders } from "../../../lib/providers";
import { fromHex, toHex } from "../../../lib/wallet-bridge";
import {
  decryptOwnerVaultBackup,
  deriveIssuerPublicKey,
  encryptOwnerVaultBackup,
  requireBackupPassword,
  serializeOwnerPrivateState,
  deserializeOwnerPrivateState,
} from "./commitments";
import { createRandomOwnerPrivateState, isValidPrivateState } from "./private-state";
import { getContractRuntime } from "./runtime";
import {
  INITIAL_ISSUER_NONCE,
  MANAGED_CONTRACT_BASE_PATH,
  OWNER_PRIVATE_STATE_ID,
  type DidRegistryPrivateState,
  type OwnerVaultBackupPayload,
  type OwnerVaultStatus,
} from "./types";

async function queryLedgerState(providers: AppProviders, contractAddress: string) {
  const { module } = await getContractRuntime(MANAGED_CONTRACT_BASE_PATH);
  const state = await providers.publicDataProvider.queryContractState(
    contractAddress as never,
  );
  if (!state) return null;
  return module.ledger((state as { data: unknown }).data);
}

export async function getOnChainIssuerPublicKeyHex(
  providers: AppProviders,
  contractAddress: string,
): Promise<string | undefined> {
  const ledgerState = await queryLedgerState(providers, contractAddress);
  if (!ledgerState) return undefined;
  const issuerService = ledgerState.issuer_service;
  if (issuerService instanceof Uint8Array) return toHex(issuerService);
  if (Array.isArray(issuerService)) return toHex(new Uint8Array(issuerService));
  if (typeof issuerService === "string") return issuerService.replace(/^0x/, "");
  if (
    issuerService &&
    typeof issuerService === "object" &&
    "serialize" in issuerService &&
    typeof (issuerService as { serialize: () => Uint8Array }).serialize === "function"
  ) {
    return toHex((issuerService as { serialize: () => Uint8Array }).serialize());
  }
  return undefined;
}

export async function getOnChainIssuerNonce(
  providers: AppProviders,
  contractAddress: string,
): Promise<bigint | undefined> {
  const ledgerState = await queryLedgerState(providers, contractAddress);
  if (!ledgerState) return undefined;
  return typeof ledgerState.issuer_nonce === "bigint" ? ledgerState.issuer_nonce : undefined;
}

export async function assertOwnerPrivateStateMatchesContract(
  providers: AppProviders,
  contractAddress: string,
  privateState: DidRegistryPrivateState,
): Promise<void> {
  const onChainIssuerPublicKeyHex = await getOnChainIssuerPublicKeyHex(
    providers,
    contractAddress,
  );
  if (!onChainIssuerPublicKeyHex) {
    throw new Error("Could not read the issuer authorization key from the contract state.");
  }
  const onChainIssuerNonce = await getOnChainIssuerNonce(providers, contractAddress);
  if (onChainIssuerNonce == null) {
    throw new Error("Could not read the issuer authorization nonce from the contract state.");
  }

  const localIssuerPublicKeyHex = toHex(
    deriveIssuerPublicKey(privateState.issuerSecret, onChainIssuerNonce),
  );

  if (localIssuerPublicKeyHex.toLowerCase() !== onChainIssuerPublicKeyHex.toLowerCase()) {
    throw new Error(
      "The local owner vault does not match this contract's on-chain issuer authorization key. Restore the correct backup for this registry.",
    );
  }
}

export async function ensureOwnerPrivateState(
  providers: AppProviders,
  contractAddress: string,
): Promise<DidRegistryPrivateState> {
  providers.privateStateProvider.setContractAddress(contractAddress as never);
  const existing = await providers.privateStateProvider.get(OWNER_PRIVATE_STATE_ID);
  if (isValidPrivateState(existing)) {
    await assertOwnerPrivateStateMatchesContract(providers, contractAddress, existing);
    return existing;
  }

  throw new Error(
    "Owner vault is missing from Midnight private state for this contract. Restore a vault backup before issuing, updating, or revoking DIDs.",
  );
}

export function createDeploymentOwnerPrivateState(providers: AppProviders) {
  return createRandomOwnerPrivateState(providers, toHex);
}

export async function getOwnerVaultStatus(
  providers: AppProviders,
  contractAddress: string,
): Promise<OwnerVaultStatus> {
  if (!contractAddress.trim()) {
    return {
      hasLocalVault: false,
      contractAddress,
      matchesOnChain: null,
    };
  }

  providers.privateStateProvider.setContractAddress(contractAddress as never);
  const existing = await providers.privateStateProvider.get(OWNER_PRIVATE_STATE_ID);
  const onChainIssuerPublicKeyHex = await getOnChainIssuerPublicKeyHex(
    providers,
    contractAddress,
  );
  const onChainIssuerNonce = await getOnChainIssuerNonce(providers, contractAddress);

  if (!isValidPrivateState(existing)) {
    return {
      hasLocalVault: false,
      contractAddress,
      onChainIssuerPublicKeyHex,
      matchesOnChain: null,
    };
  }

  const localIssuerPublicKeyHex = toHex(
    deriveIssuerPublicKey(
      existing.issuerSecret,
      onChainIssuerNonce ?? INITIAL_ISSUER_NONCE,
    ),
  );

  return {
    hasLocalVault: true,
    contractAddress,
    createdAt:
      ("createdAt" in existing && typeof existing.createdAt === "string"
        ? existing.createdAt
        : undefined) ||
      ("derivedAt" in (existing as Record<string, unknown>) &&
      typeof (existing as { derivedAt?: string }).derivedAt === "string"
        ? (existing as { derivedAt?: string }).derivedAt
        : undefined),
    custodianWalletAddress:
      "custodianWalletAddress" in existing &&
      typeof existing.custodianWalletAddress === "string"
        ? existing.custodianWalletAddress
        : undefined,
    localIssuerPublicKeyHex,
    onChainIssuerPublicKeyHex,
    matchesOnChain: onChainIssuerPublicKeyHex
      ? localIssuerPublicKeyHex.toLowerCase() === onChainIssuerPublicKeyHex.toLowerCase()
      : null,
  };
}

export async function exportOwnerVaultBackup(
  providers: AppProviders,
  contractAddress: string,
  backupPassword: string,
): Promise<string> {
  const privateState = await ensureOwnerPrivateState(providers, contractAddress);
  const payload: OwnerVaultBackupPayload = {
    kind: "midnight-did-owner-vault-backup",
    version: "v1",
    contractAddress,
    networkId: providers.networkId,
    exportedAt: new Date().toISOString(),
    privateState: serializeOwnerPrivateState(privateState, toHex),
  };

  const encrypted = await encryptOwnerVaultBackup(
    payload,
    requireBackupPassword(backupPassword),
  );
  return JSON.stringify(encrypted, null, 2);
}

export async function restoreOwnerVaultBackup(
  providers: AppProviders,
  contractAddress: string,
  serializedBackup: string,
  backupPassword: string,
): Promise<OwnerVaultStatus> {
  const payload = await decryptOwnerVaultBackup(
    serializedBackup,
    requireBackupPassword(backupPassword),
  );

  if (payload.contractAddress.trim() !== contractAddress.trim()) {
    throw new Error(
      `This backup belongs to ${payload.contractAddress}, not ${contractAddress}.`,
    );
  }

  if (payload.networkId !== providers.networkId) {
    throw new Error(
      `This backup targets network ${payload.networkId}, but the connected wallet is on ${providers.networkId}.`,
    );
  }

  const privateState = deserializeOwnerPrivateState(payload.privateState, fromHex);
  if (!isValidPrivateState(privateState)) {
    throw new Error("The owner vault backup payload is invalid.");
  }

  await assertOwnerPrivateStateMatchesContract(
    providers,
    contractAddress,
    privateState,
  );

  providers.privateStateProvider.setContractAddress(contractAddress as never);
  await providers.privateStateProvider.set(OWNER_PRIVATE_STATE_ID, privateState);
  return getOwnerVaultStatus(providers, contractAddress);
}

