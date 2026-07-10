import { describe, expect, it } from "vitest";
import {
  buildIssuerDidDocument,
  computeIssuerDefaultController,
} from "../src/lib/did/issuer-panel-state";

describe("computeIssuerDefaultController — three-level default chain (ADR-003)", () => {
  it("priority 1: uses record.controller when present, regardless of targetController/walletAddress", () => {
    expect(
      computeIssuerDefaultController(
        "mn_addr_preview1recordcontroller",
        "mn_addr_preview1targetcontroller",
        "mn_addr_preview1wallet",
      ),
    ).toBe("mn_addr_preview1recordcontroller");
  });

  it("priority 2: falls back to targetController when record.controller is absent (no record)", () => {
    expect(
      computeIssuerDefaultController(
        undefined,
        "mn_addr_preview1targetcontroller",
        "mn_addr_preview1wallet",
      ),
    ).toBe("mn_addr_preview1targetcontroller");
  });

  it("priority 2: falls back to targetController when record.controller is null", () => {
    expect(
      computeIssuerDefaultController(
        null,
        "mn_addr_preview1targetcontroller",
        "mn_addr_preview1wallet",
      ),
    ).toBe("mn_addr_preview1targetcontroller");
  });

  it("priority 3: falls back to walletAddress (first-time default) when both record.controller and targetController are absent", () => {
    expect(
      computeIssuerDefaultController(null, undefined, "mn_addr_preview1wallet"),
    ).toBe("mn_addr_preview1wallet");
    expect(
      computeIssuerDefaultController("", "", "mn_addr_preview1wallet"),
    ).toBe("mn_addr_preview1wallet");
  });

  it("returns empty string when no level of the chain has a value", () => {
    expect(computeIssuerDefaultController(null, undefined, "")).toBe("");
  });
});

describe("buildIssuerDidDocument", () => {
  it("returns the existing didDocument verbatim when the record already has one", () => {
    expect(
      buildIssuerDidDocument({
        existingDidDocument: '{"id":"already-set"}',
        networkId: "preprod",
        contractAddress: "c1",
        agentId: "a1",
        controller: "ignored-because-existing-doc-wins",
      }),
    ).toBe('{"id":"already-set"}');
  });

  it("builds a fresh document using the resolved controller value, not subjectWalletAddress", () => {
    const doc = JSON.parse(
      buildIssuerDidDocument({
        networkId: "preprod",
        contractAddress: "contract1",
        agentId: "agent1",
        controller: "mn_addr_preview1controller",
      }),
    );
    expect(doc.controller).toBe("mn_addr_preview1controller");
    expect(doc.id).toBe("did:midnight:preprod:contract1:agent1");
  });

  it("uses record.did as the document id when present", () => {
    const doc = JSON.parse(
      buildIssuerDidDocument({
        did: "did:midnight:preprod:contract1:agent1",
        networkId: "preprod",
        contractAddress: "contract1",
        agentId: "agent1",
        controller: "mn_addr_preview1controller",
      }),
    );
    expect(doc.id).toBe("did:midnight:preprod:contract1:agent1");
  });

  it("marks organization undisclosed unless organizationDisclosure is 'disclosed'", () => {
    const doc = JSON.parse(
      buildIssuerDidDocument({
        networkId: "preprod",
        contractAddress: "contract1",
        agentId: "agent1",
        controller: "c",
        organization: "Acme",
        organizationDisclosure: "undisclosed",
      }),
    );
    expect(doc.organization).toBe("undisclosed");
  });

  it("discloses organization when organizationDisclosure is 'disclosed'", () => {
    const doc = JSON.parse(
      buildIssuerDidDocument({
        networkId: "preprod",
        contractAddress: "contract1",
        agentId: "agent1",
        controller: "c",
        organization: "Acme",
        organizationDisclosure: "disclosed",
      }),
    );
    expect(doc.organization).toBe("Acme");
  });
});
