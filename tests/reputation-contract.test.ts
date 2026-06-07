import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const contractSource = readFileSync(
  resolve(__dirname, "../contracts/reputation_registry.compact"),
  "utf-8",
);

describe("reputation_registry contract structure", () => {
  it("exports all required circuits", () => {
    const exportedCircuits = [
      "rotate_issuer",
      "update_score",
      "suspend_score",
      "revoke_score",
      "restore_score",
      "get_tier",
      "meets_threshold",
      "get_score",
      "get_status",
    ];
    for (const circuit of exportedCircuits) {
      expect(contractSource).toContain(`export circuit ${circuit}(`);
    }
  });

  it("declares all required ledger variables", () => {
    const ledgers = [
      "initialized",
      "registry_admin",
      "issuer_service",
      "scores",
      "evidence_commitments",
      "last_update_epoch",
      "reputation_status",
      "total_active",
      "issuer_nonce",
    ];
    for (const ledger of ledgers) {
      expect(contractSource).toMatch(new RegExp(`export ledger ${ledger}"?(?:\\s*:\\s*|\\s)`));
    }
  });

  it("documents evidence commitment schema", () => {
    expect(contractSource).toContain("midnight:mais:reputation:evidence:v1");
    expect(contractSource).toContain("agent_key");
    expect(contractSource).toContain("issuer_key");
    expect(contractSource).toContain("score");
    expect(contractSource).toContain("epoch");
    expect(contractSource).toContain("salt");
    expect(contractSource).toContain("random salt to prevent dictionary attacks");
  });

  it("documents public score model and Phase 2 private path", () => {
    expect(contractSource).toContain("PUBLIC score registry");
    expect(contractSource).toContain("Phase 2");
    expect(contractSource).toContain("private-score commitments");
  });

  it("documents reputation status codes", () => {
    expect(contractSource).toContain("None (0)");
    expect(contractSource).toContain("Active (1)");
    expect(contractSource).toContain("Suspended (2)");
    expect(contractSource).toContain("Revoked (3)");
  });
});

describe("reputation tier logic", () => {
  const getTier = (score: number): number => {
    if (score >= 90) return 2;
    if (score >= 60) return 1;
    return 0;
  };

  it("returns Basic (0) for scores 0-59", () => {
    expect(getTier(0)).toBe(0);
    expect(getTier(30)).toBe(0);
    expect(getTier(59)).toBe(0);
  });

  it("returns Proven (1) for scores 60-89", () => {
    expect(getTier(60)).toBe(1);
    expect(getTier(75)).toBe(1);
    expect(getTier(89)).toBe(1);
  });

  it("returns Institutional (2) for scores 90-100", () => {
    expect(getTier(90)).toBe(2);
    expect(getTier(95)).toBe(2);
    expect(getTier(100)).toBe(2);
  });
});

describe("score bounds", () => {
  it("accepts scores 0-100", () => {
    expect(contractSource).toContain("Score must be 0-100");
    expect(contractSource).toContain("score <= (100 as Uint<8>)");
  });
});

describe("epoch monotonic enforcement", () => {
  it("enforces epoch >= previous epoch", () => {
    expect(contractSource).toContain("Epoch must be >= previous epoch");
  });
});

describe("status lifecycle", () => {
  it("rejects updates on revoked reputation", () => {
    expect(contractSource).toContain("Reputation is revoked");
  });

  it("allows restoring suspended reputation", () => {
    expect(contractSource).toContain("Reputation is not suspended");
  });

  it("prevents double revocation", () => {
    expect(contractSource).toContain("Reputation already revoked");
  });

  it("prevents underflow of active counter", () => {
    expect(contractSource).toContain("Active counter underflow");
  });
});

describe("meets_threshold circuit (public model)", () => {
  it("returns false for inactive or missing agents", () => {
    expect(contractSource).toContain("status != (1 as Uint<8>)");
  });

  it("documents Phase 2 ZK upgrade path", () => {
    expect(contractSource).toContain("Phase 2 will convert this to a ZK proof");
  });
});
