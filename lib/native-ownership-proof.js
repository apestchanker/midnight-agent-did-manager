import {
  createCircuitContext,
  createConstructorContext,
  dummyContractAddress,
  proofDataIntoSerializedPreimage,
} from "@midnight-ntwrk/compact-runtime";
import {
  MidnightBech32m,
  ShieldedAddress,
  ShieldedCoinPublicKey,
} from "@midnight-ntwrk/wallet-sdk-address-format";
import { Contract as NativeOwnershipProofContract } from "../src/generated/nativeOwnershipProof.runtime.js";

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex) {
  const cleaned = String(hex || "").replace(/^0x/, "");
  return new Uint8Array(
    (cleaned.match(/.{1,2}/g) || []).map((segment) => Number.parseInt(segment, 16)),
  );
}

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

async function sha256Bytes(value) {
  const source =
    value instanceof Uint8Array
      ? value
      : new TextEncoder().encode(
          typeof value === "string" ? value : JSON.stringify(canonicalize(value)),
        );
  const digest = await globalThis.crypto.subtle.digest("SHA-256", source);
  return new Uint8Array(digest);
}

async function sha256Hex(value) {
  return bytesToHex(await sha256Bytes(value));
}

function parseDidIdentifier(did) {
  const parts = String(did || "").split(":");
  if (parts.length < 5) {
    throw new Error("Invalid DID identifier.");
  }

  return {
    method: parts[1],
    network: parts[2],
    contractAddress: parts[3],
    agentKeyHex: parts[4],
  };
}

function isHexLike(value) {
  return /^[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0;
}

function normalizeCoinPublicKey(coinPublicKey, networkId) {
  if (coinPublicKey instanceof Uint8Array) {
    return coinPublicKey;
  }

  const raw = String(coinPublicKey || "").trim();
  if (!raw) {
    throw new Error("Missing coin public key for native ownership proof.");
  }

  if (isHexLike(raw)) {
    return fromHex(raw);
  }

  if (raw.startsWith("mn_")) {
    const parsed = MidnightBech32m.parse(raw);
    if (parsed.type === "shield-cpk") {
      return ShieldedCoinPublicKey.codec.decode(networkId, parsed).data;
    }
    if (parsed.type === "shield-addr") {
      return ShieldedAddress.codec.decode(networkId, parsed).coinPublicKey.data;
    }
  }

  throw new Error(
    `Unsupported coin public key format for native ownership proof: ${raw.slice(0, 24)}`,
  );
}

function getContractInstance() {
  return new NativeOwnershipProofContract({});
}

export async function buildNativeOwnershipMaterial(input) {
  const did = String(input.did || "");
  const challenge = String(input.challenge || "");
  const holderWalletAddress = String(input.holderWalletAddress || "");
  const { contractAddress, agentKeyHex } = parseDidIdentifier(did);
  const contract = getContractInstance();

  const walletHash = await sha256Bytes(holderWalletAddress);
  const contractHash = await sha256Bytes(contractAddress);
  const didHash = await sha256Bytes(did);
  const challengeHash = await sha256Bytes(challenge);
  const agentKey = fromHex(agentKeyHex);
  const bundleCommitment = contract._ownershipCommitment_0(
    walletHash,
    agentKey,
    contractHash,
    didHash,
  );
  const holderBindingCommitment = contract._holderBindingCommitment_0(
    didHash,
    challengeHash,
    bundleCommitment,
  );

  return {
    scheme: "midnight-native-ownership-v1",
    keyLocation: "prove_ownership",
    contractAddress,
    holderWalletAddress,
    agentKeyHex,
    walletHashHex: bytesToHex(walletHash),
    contractHashHex: bytesToHex(contractHash),
    didHashHex: bytesToHex(didHash),
    challengeHashHex: bytesToHex(challengeHash),
    bundleCommitment: bytesToHex(bundleCommitment),
    holderBindingCommitment: bytesToHex(holderBindingCommitment),
  };
}

export async function buildNativeOwnershipProofInputs(input) {
  const nativeMaterial = input.nativeMaterial
    ? input.nativeMaterial
    : await buildNativeOwnershipMaterial(input);
  const { network } = parseDidIdentifier(input.did);
  const normalizedCoinPublicKey = normalizeCoinPublicKey(
    input.coinPublicKey,
    network,
  );
  const contract = getContractInstance();
  const constructorContext = createConstructorContext({}, normalizedCoinPublicKey);
  const initialState = contract.initialState(constructorContext);
  const circuitContext = createCircuitContext(
    dummyContractAddress(),
    initialState.currentZswapLocalState,
    initialState.currentContractState.data,
    initialState.currentPrivateState,
  );

  const result = contract.provableCircuits.prove_ownership(
    circuitContext,
    fromHex(nativeMaterial.walletHashHex),
    fromHex(nativeMaterial.agentKeyHex),
    fromHex(nativeMaterial.contractHashHex),
    fromHex(nativeMaterial.didHashHex),
    fromHex(nativeMaterial.challengeHashHex),
    fromHex(nativeMaterial.bundleCommitment),
    fromHex(nativeMaterial.holderBindingCommitment),
  );

  const serializedPreimage = proofDataIntoSerializedPreimage(
    result.proofData.input,
    result.proofData.output,
    result.proofData.publicTranscript,
    result.proofData.privateTranscriptOutputs,
    nativeMaterial.keyLocation,
  );

  const publicInputsHash = await sha256Hex({
    scheme: nativeMaterial.scheme,
    keyLocation: nativeMaterial.keyLocation,
    did: input.did,
    challenge: input.challenge,
    bundleCommitment: nativeMaterial.bundleCommitment,
    holderBindingCommitment: nativeMaterial.holderBindingCommitment,
    didHashHex: nativeMaterial.didHashHex,
    challengeHashHex: nativeMaterial.challengeHashHex,
  });

  return {
    nativeMaterial,
    serializedPreimage,
    publicInputsHash,
  };
}
