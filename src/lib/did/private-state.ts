import { DID_SUBJECT_NONCE_PREFIX, type DidSlotPrivateState } from "./types";

export async function getDefaultSubjectNonce(): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(DID_SUBJECT_NONCE_PREFIX);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(hash);
}

export function createDidSlotPrivateState(params: {
  networkId: string;
  contractAddress: string;
  subjectNonce?: Uint8Array;
}): DidSlotPrivateState {
  return {
    subjectNonce: params.subjectNonce
      ? Array.from(params.subjectNonce)
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("")
      : "",
    createdAt: new Date().toISOString(),
    networkId: params.networkId,
    contractAddress: params.contractAddress,
  };
}

export function isValidDidSlotState(value: unknown): value is DidSlotPrivateState {
  return (
    !!value &&
    typeof value === "object" &&
    "subjectNonce" in value &&
    "networkId" in value &&
    "contractAddress" in value
  );
}
