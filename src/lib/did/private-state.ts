import type { AppProviders } from "../../../lib/providers";
import { APP_VERSION, CONTRACT_VERSION } from "../version";
import { deriveIssuerPublicKey, createRandomOwnerSecret } from "./commitments";
import {
  INITIAL_ISSUER_NONCE,
  OWNER_VAULT_VERSION,
  type DidRegistryPrivateState,
} from "./types";

export function createOwnerPrivateState(
  providers: AppProviders,
  issuerSecret: Uint8Array,
  toHex: (value: Uint8Array) => string,
): DidRegistryPrivateState {
  const issuerPublicKey = deriveIssuerPublicKey(issuerSecret, INITIAL_ISSUER_NONCE);
  return {
    issuerSecret,
    createdAt: new Date().toISOString(),
    vaultVersion: OWNER_VAULT_VERSION,
    contractVersion: CONTRACT_VERSION,
    appVersion: APP_VERSION,
    networkId: providers.networkId,
    custodianWalletAddress: providers.unshieldedAddress,
    issuerPublicKeyHex: toHex(issuerPublicKey),
  };
}

export function createRandomOwnerPrivateState(
  providers: AppProviders,
  toHex: (value: Uint8Array) => string,
): DidRegistryPrivateState {
  return createOwnerPrivateState(providers, createRandomOwnerSecret(), toHex);
}

export function isValidPrivateState(value: unknown): value is DidRegistryPrivateState {
  return !!(
    value &&
    typeof value === "object" &&
    "issuerSecret" in value &&
    (value as { issuerSecret: unknown }).issuerSecret instanceof Uint8Array &&
    (value as { issuerSecret: Uint8Array }).issuerSecret.length === 32
  );
}

export function createWitnesses() {
  return {
    issuerSecret: (context: { privateState: unknown }) => {
      if (!isValidPrivateState(context.privateState)) {
        throw new Error(
          "Owner witness secret is missing from Midnight private state for this contract.",
        );
      }
      return [context.privateState, context.privateState.issuerSecret] as [
        DidRegistryPrivateState,
        Uint8Array,
      ];
    },
  };
}

