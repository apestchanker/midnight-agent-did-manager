import type { AppProviders } from "../../../lib/providers";
import { APP_VERSION, CONTRACT_VERSION } from "../version";
import {
  buildOwnerSignatureDomain,
  createDeploymentSaltHex,
  createRandomOwnerSecret,
  deriveIssuerPublicKey,
  deriveOwnerSecretFromWalletSignature,
} from "./commitments";
import {
  INITIAL_ISSUER_NONCE,
  OWNER_VAULT_VERSION,
  type DidRegistryPrivateState,
} from "./types";

export function createOwnerPrivateState(
  providers: AppProviders,
  issuerSecret: Uint8Array,
  toHex: (value: Uint8Array) => string,
  ownerDerivation?: DidRegistryPrivateState["ownerDerivation"],
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
    ownerDerivation,
  };
}

export function createRandomOwnerPrivateState(
  providers: AppProviders,
  toHex: (value: Uint8Array) => string,
): DidRegistryPrivateState {
  return createOwnerPrivateState(providers, createRandomOwnerSecret(), toHex, {
    scheme: "random-secret-v1",
  });
}

export async function createWalletDerivedOwnerPrivateState(
  providers: AppProviders,
  toHex: (value: Uint8Array) => string,
  deploymentSaltHex = createDeploymentSaltHex(toHex),
): Promise<DidRegistryPrivateState & { issuerSecret: Uint8Array }> {
  if (typeof providers.connectedAPI.signData !== "function") {
    throw new Error("Connected Midnight wallet does not support signData().");
  }

  const signDomain = buildOwnerSignatureDomain({
    networkId: providers.networkId,
    deploymentSaltHex,
  });
  const signature = await providers.connectedAPI.signData(signDomain, {
    encoding: "text",
    keyType: "unshielded",
  });
  const issuerSecret = await deriveOwnerSecretFromWalletSignature(
    String(signature.signature || ""),
  );

  return createOwnerPrivateState(providers, issuerSecret, toHex, {
    scheme: "wallet-signature-sha256-v1",
    signDomain,
    deploymentSaltHex,
  }) as DidRegistryPrivateState & { issuerSecret: Uint8Array };
}

export function hasIssuerSecret(value: unknown): value is DidRegistryPrivateState & {
  issuerSecret: Uint8Array;
} {
  return !!(
    value &&
    typeof value === "object" &&
    "issuerSecret" in value &&
    (value as { issuerSecret: unknown }).issuerSecret instanceof Uint8Array &&
      (value as { issuerSecret: Uint8Array }).issuerSecret.length === 32
  );
}

export function isOwnerPrivateStateMetadata(value: unknown): value is DidRegistryPrivateState {
  return !!(
    value &&
    typeof value === "object" &&
    "networkId" in value &&
    "custodianWalletAddress" in value &&
    "issuerPublicKeyHex" in value
  );
}

export function isValidPrivateState(value: unknown): value is DidRegistryPrivateState & {
  issuerSecret: Uint8Array;
} {
  return hasIssuerSecret(value);
}

export function stripOwnerSecret(
  privateState: DidRegistryPrivateState,
): DidRegistryPrivateState {
  const { issuerSecret, ...metadata } = privateState;
  void issuerSecret;
  return metadata;
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
