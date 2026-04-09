export interface NativeOwnershipMaterial {
  scheme: "midnight-native-ownership-v1";
  keyLocation: "prove_ownership";
  contractAddress: string;
  holderWalletAddress: string;
  agentKeyHex: string;
  walletHashHex: string;
  contractHashHex: string;
  didHashHex: string;
  challengeHashHex: string;
  bundleCommitment: string;
  holderBindingCommitment: string;
}

export function buildNativeOwnershipMaterial(input: {
  did: string;
  challenge: string;
  holderWalletAddress: string;
}): Promise<NativeOwnershipMaterial>;

export function buildNativeOwnershipProofInputs(input: {
  did: string;
  challenge: string;
  coinPublicKey: string | Uint8Array;
  nativeMaterial?: NativeOwnershipMaterial;
}): Promise<{
  nativeMaterial: NativeOwnershipMaterial;
  serializedPreimage: Uint8Array;
  publicInputsHash: string;
}>;

