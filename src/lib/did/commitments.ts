import {
  Bytes32Descriptor,
  CompactTypeVector,
  persistentHash,
} from "@midnight-ntwrk/compact-runtime";

async function sha256Bytes(value: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(hash);
}

function normalizeAgentId(agentId: string): string {
  return agentId.trim().toLowerCase();
}

export async function createAgentKey(agentId: string): Promise<Uint8Array> {
  return sha256Bytes(normalizeAgentId(agentId));
}

function padBytes(value: Uint8Array, length: number): Uint8Array {
  const output = new Uint8Array(length);
  output.set(value.slice(0, length));
  return output;
}

export function randomBytes(length: number): Uint8Array {
  const output = new Uint8Array(length);
  crypto.getRandomValues(output);
  return output;
}

export function createDeploymentSaltHex(toHex: (value: Uint8Array) => string): string {
  return toHex(randomBytes(32));
}

export function deriveDidKey(
  controllerPublicKeyBytes: Uint8Array,
  subjectNonce: Uint8Array,
  registrySalt: Uint8Array,
): Uint8Array {
  return persistentHash(
    new CompactTypeVector(4, Bytes32Descriptor),
    [
      padBytes(new TextEncoder().encode("didmn:did:v1"), 32),
      registrySalt,
      controllerPublicKeyBytes,
      subjectNonce,
    ],
  );
}


export async function createRequestCommitment(input: {
  contractAddress: string;
  agentId: string;
  agentName?: string;
  organization?: string;
  organizationDisclosure: "disclosed" | "undisclosed";
  didDocument: string;
}): Promise<Uint8Array> {
  return sha256Bytes(
    JSON.stringify({
      contractAddress: input.contractAddress.trim(),
      agentId: normalizeAgentId(input.agentId),
      agentName: (input.agentName || "").trim(),
      organization: (input.organization || "").trim(),
      organizationDisclosure: input.organizationDisclosure,
      didDocument: input.didDocument.trim(),
    }),
  );
}

export async function createProofCommitment(input: {
  networkId: string;
  contractAddress: string;
  agentId: string;
  agentName?: string;
  organization?: string;
  organizationDisclosure: "disclosed" | "undisclosed";
  didDocument: string;
}): Promise<Uint8Array> {
  return sha256Bytes(
    [
      input.networkId,
      input.contractAddress.trim(),
      normalizeAgentId(input.agentId),
      (input.agentName || "").trim(),
      (input.organization || "").trim(),
      input.organizationDisclosure,
      input.didDocument.trim(),
    ].join(":"),
  );
}

export function encodeFixedBytes(value: string, length: number): Uint8Array {
  const bytes = new TextEncoder().encode(value.trim());
  const output = new Uint8Array(length);
  output.set(bytes.slice(0, length));
  return output;
}

export function decodeFixedBytes(value: unknown): string | undefined {
  const bytes =
    value instanceof Uint8Array
      ? value
      : Array.isArray(value)
        ? new Uint8Array(value)
        : null;
  if (!bytes) return undefined;
  const end = bytes.findIndex((item) => item === 0);
  const sliced = end === -1 ? bytes : bytes.slice(0, end);
  const decoded = new TextDecoder().decode(sliced).trim();
  return decoded || undefined;
}

export function disclosureFlag(
  disclosure: "disclosed" | "undisclosed" | undefined,
): bigint {
  return disclosure === "disclosed" ? 1n : 0n;
}

export function disclosureFromValue(value: unknown): "disclosed" | "undisclosed" {
  return typeof value === "bigint" ? (value === 1n ? "disclosed" : "undisclosed") : Number(value) === 1 ? "disclosed" : "undisclosed";
}

export async function createDidIdentifier(
  networkId: string,
  contractAddress: string,
  agentKeyHex: string,
): Promise<string> {
  return `did:midnight:${networkId}:${contractAddress}:${agentKeyHex}`;
}

export async function createDidCommitment(input: {
  did: string;
  contractAddress: string;
  agentId: string;
}): Promise<Uint8Array> {
  return sha256Bytes(
    JSON.stringify({
      did: input.did,
      contractAddress: input.contractAddress.trim(),
      agentId: normalizeAgentId(input.agentId),
    }),
  );
}

export async function createDocumentCommitment(didDocument: string): Promise<Uint8Array> {
  return sha256Bytes(didDocument.trim());
}

export async function createLifecycleProofCommitment(input: {
  action: "issue_did" | "update_did";
  networkId: string;
  contractAddress: string;
  agentId: string;
  did: string;
  didDocument: string;
}): Promise<Uint8Array> {
  return sha256Bytes(
    JSON.stringify({
      action: input.action,
      networkId: input.networkId,
      contractAddress: input.contractAddress.trim(),
      agentId: normalizeAgentId(input.agentId),
      did: input.did,
      didDocument: input.didDocument.trim(),
    }),
  );
}

export async function createRevocationCommitment(input: {
  networkId: string;
  contractAddress: string;
  agentId: string;
  did: string;
  reason: string;
}): Promise<Uint8Array> {
  return sha256Bytes(
    JSON.stringify({
      action: "revoke_did",
      networkId: input.networkId,
      contractAddress: input.contractAddress.trim(),
      agentId: normalizeAgentId(input.agentId),
      did: input.did,
      reason: input.reason.trim(),
    }),
  );
}
