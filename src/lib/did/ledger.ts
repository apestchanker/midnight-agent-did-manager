import type { RegistryAccess, RegistrySummary } from "../../types/did";
import { createAgentKey } from "./commitments";

export function toRecordHex(
  value: unknown,
  toHex: (value: Uint8Array) => string,
): string | undefined {
  if (value == null) return undefined;
  if (value instanceof Uint8Array) return toHex(value);
  if (Array.isArray(value)) return toHex(new Uint8Array(value));
  if (typeof value === "string") return value.replace(/^0x/, "");
  if (
    typeof value === "object" &&
    value !== null &&
    "serialize" in value &&
    typeof (value as { serialize: () => Uint8Array }).serialize === "function"
  ) {
    return toHex((value as { serialize: () => Uint8Array }).serialize());
  }

  return undefined;
}

function bytesEqualHex(
  value: unknown,
  targetHex: string,
  toHex: (value: Uint8Array) => string,
): boolean {
  const hex = toRecordHex(value, toHex);
  return !!hex && hex.toLowerCase() === targetHex.toLowerCase();
}

export function mapLookupByHexKey(
  value: unknown,
  keyHex: string,
  fromHex: (value: string) => Uint8Array,
  toHex: (value: Uint8Array) => string,
): unknown | undefined {
  const keyBytes = fromHex(keyHex);

  if (
    value &&
    typeof value === "object" &&
    "member" in value &&
    "lookup" in value &&
    typeof (value as { member: (key: Uint8Array) => boolean }).member === "function" &&
    typeof (value as { lookup: (key: Uint8Array) => unknown }).lookup === "function"
  ) {
    const compactMap = value as {
      member: (key: Uint8Array) => boolean;
      lookup: (key: Uint8Array) => unknown;
    };
    if (!compactMap.member(keyBytes)) return undefined;
    return compactMap.lookup(keyBytes);
  }

  if (
    value &&
    typeof value === "object" &&
    Symbol.iterator in value &&
    typeof (value as Iterable<[unknown, unknown]>)[Symbol.iterator] === "function"
  ) {
    for (const [entryKey, entryValue] of value as Iterable<[unknown, unknown]>) {
      if (bytesEqualHex(entryKey, keyHex, toHex)) {
        return entryValue;
      }
    }
  }

  return undefined;
}

export function bigintishToNumber(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

export function statusCodeToDidStatus(statusCode: number) {
  switch (statusCode) {
    case 1:
      return "pending_issuance" as const;
    case 2:
      return "active" as const;
    case 3:
      return "revoked" as const;
    case 4:
      return "pending_update" as const;
    case 5:
      return "pending_revocation" as const;
    default:
      return "pending_issuance" as const;
  }
}

export function countStatuses(mapValue: unknown, targetStatus: number): number {
  if (
    !mapValue ||
    typeof mapValue !== "object" ||
    !(Symbol.iterator in mapValue) ||
    typeof (mapValue as Iterable<[unknown, unknown]>)[Symbol.iterator] !== "function"
  ) {
    return 0;
  }
  let count = 0;
  for (const [, value] of mapValue as Iterable<[unknown, unknown]>) {
    if (bigintishToNumber(value) === targetStatus) {
      count += 1;
    }
  }
  return count;
}

export function deriveRegistrySummary(
  ledgerState: Record<string, unknown>,
  contractAddress: string,
  networkId: string,
): RegistrySummary {
  return {
    contractAddress,
    networkId,
    mode: "onchain",
    totalRequests: bigintishToNumber(ledgerState.total_requests),
    totalActiveDids: bigintishToNumber(ledgerState.total_active_dids),
    totalRevokedDids: countStatuses(ledgerState.status_by_agent, 3),
    lastUpdatedAt: new Date().toISOString(),
  };
}

export async function deriveRegistryAccess(
  ledgerState: Record<string, unknown>,
  contractAddress: string,
  walletAddress: string,
  toHex: (value: Uint8Array) => string,
): Promise<RegistryAccess> {
  const walletKeyHex = toHex(await createAgentKey(walletAddress));
  const registryAdminKeyHex = toRecordHex(ledgerState.registry_admin, toHex);
  const issuerServiceKeyHex = toRecordHex(ledgerState.issuer_service, toHex);

  return {
    contractAddress,
    isRegistryAdmin:
      !!registryAdminKeyHex &&
      registryAdminKeyHex.toLowerCase() === walletKeyHex.toLowerCase(),
    isIssuer:
      !!issuerServiceKeyHex &&
      issuerServiceKeyHex.toLowerCase() === walletKeyHex.toLowerCase(),
    registryAdminKeyHex,
    issuerServiceKeyHex,
  };
}

