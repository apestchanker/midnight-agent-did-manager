import type { ConnectedAPI, Signature } from "@midnight-ntwrk/dapp-connector-api";

export function isWalletApprovalRejected(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  return (
    code === "4001" ||
    /reject/i.test(message) ||
    /denied/i.test(message) ||
    /declined/i.test(message) ||
    /refused/i.test(message) ||
    /cancelled/i.test(message) ||
    /canceled/i.test(message) ||
    /user aborted/i.test(message)
  );
}

export async function signProofApprovalPayload(
  api: ConnectedAPI,
  approvalPayload: string,
): Promise<Signature> {
  const signature = await api.signData(approvalPayload, {
    encoding: "text",
    keyType: "unshielded",
  });

  console.info("[proof-approval] wallet signature envelope", {
    dataLength: String(signature.data || "").length,
    dataPreview: String(signature.data || "").slice(0, 80),
    signatureLength: String(signature.signature || "").length,
    signaturePrefix: String(signature.signature || "").slice(0, 24),
    verifyingKey: String(signature.verifyingKey || ""),
    verifyingKeyLength: String(signature.verifyingKey || "").length,
  });

  return signature;
}

/**
 * Signs a wallet-session-login challenge (the canonical JSON envelope string
 * returned by POST /api/auth/nonce) so it can be exchanged for a session via
 * POST /api/auth/session. Mirrors signProofApprovalPayload's exact call shape
 * (api.signData with { encoding: "text", keyType: "unshielded" }) — the two
 * signing call sites share the same pattern by design (see technical spec
 * ADR-003: domain separation comes from the *content* of the challenge
 * string, not from a different signing mechanism).
 */
export async function signAuthChallenge(
  api: ConnectedAPI,
  challenge: string,
): Promise<Signature> {
  const signature = await api.signData(challenge, {
    encoding: "text",
    keyType: "unshielded",
  });

  console.info("[auth] wallet signature envelope", {
    dataLength: String(signature.data || "").length,
    dataPreview: String(signature.data || "").slice(0, 80),
    signatureLength: String(signature.signature || "").length,
    signaturePrefix: String(signature.signature || "").slice(0, 24),
    verifyingKey: String(signature.verifyingKey || ""),
    verifyingKeyLength: String(signature.verifyingKey || "").length,
  });

  return signature;
}
