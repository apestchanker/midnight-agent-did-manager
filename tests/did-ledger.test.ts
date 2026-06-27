import { describe, expect, it } from "vitest";
import {
  countStatuses,
  deriveRegistryAccess,
  deriveRegistrySummary,
  mapLookupByHexKey,
} from "../src/lib/did/ledger";

function toHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(value: string): Uint8Array {
  const normalized = value.replace(/^0x/, "");
  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < normalized.length; index += 2) {
    bytes[index / 2] = Number.parseInt(normalized.slice(index, index + 2), 16);
  }
  return bytes;
}

function adminRoleTag(): Uint8Array {
  const tag = new Uint8Array(32);
  new TextEncoder().encode("ADMIN").forEach((byte, index) => {
    tag[index] = byte;
  });
  return tag;
}

describe("did ledger helpers", () => {
  it("derives registry summary counts from ledger state", () => {
    const ledgerState = {
      total_requests: 4n,
      total_active_dids: 2n,
      party_status: new Map([
        ["a", 2n],
        ["b", 3n],
        ["c", 3n],
      ]),
    };

    expect(countStatuses(ledgerState.party_status, 3)).toBe(2);
    expect(
      deriveRegistrySummary(ledgerState, "contract123", "preprod"),
    ).toMatchObject({
      contractAddress: "contract123",
      networkId: "preprod",
      totalActiveDids: 2,
      totalRevokedDids: 2,
    });
  });

  it("looks up compact-map-like entries by hex-serialized key", () => {
    const keyHex = "abcd";
    const value = new Map<Uint8Array, string>([[fromHex(keyHex), "found"]]);

    expect(mapLookupByHexKey(value, keyHex, fromHex, toHex)).toBe("found");
  });

  it("derives access flags from ledger keys", async () => {
    const adminKey = fromHex("11".repeat(32));
    const adminKeyHex = toHex(adminKey);
    const { persistentHash, CompactTypeVector, Bytes32Descriptor } = await import(
      "@midnight-ntwrk/compact-runtime"
    );
    const roleKey = persistentHash(
      new CompactTypeVector(2, Bytes32Descriptor),
      [adminKey, adminRoleTag()],
    );

    const access = await deriveRegistryAccess(
      {
        initial_admin: { bytes: adminKey },
        role_by_key: new Map([[roleKey, true]]),
      },
      "contract123",
      adminKeyHex,
      toHex,
    );

    expect(access).toMatchObject({
      contractAddress: "contract123",
      isRegistryAdmin: true,
      registryAdminKeyHex: adminKeyHex,
    });
  });

  it("rejects non-32-byte wallet keys before compact hashing", async () => {
    await expect(
      deriveRegistryAccess(
        { role_by_key: new Map() },
        "contract123",
        "abcd",
        toHex,
      ),
    ).rejects.toThrow("Expected a 32-byte wallet public key");
  });
});
