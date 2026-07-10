import { describe, expect, it } from "vitest";
import { buildDidDocumentForRequest } from "../src/lib/did/request-document.js";

describe("DID request document construction", () => {
  it("generates authoritative fields and deterministic service ids", () => {
    expect(
      buildDidDocumentForRequest({
        requested_did: "did:midnight:preview:contract:agent",
        subject_wallet_address: "mn_addr_preview1holder",
        organization_name: "Matrix Labs",
        organization_disclosure: "disclosed",
        request_payload: {
          agentName: "Agent Smith",
          description: "Human review context only",
          proposedServices: [
            {
              type: "AgentEndpoint",
              serviceEndpoint: "https://agent.example.com",
            },
          ],
        },
      }),
    ).toEqual({
      id: "did:midnight:preview:contract:agent",
      controller: "mn_addr_preview1holder",
      agentName: "Agent Smith",
      organization: "Matrix Labs",
      service: [
        {
          id: "#service-1",
          type: "AgentEndpoint",
          serviceEndpoint: "https://agent.example.com",
        },
      ],
    });
  });

  it("does not publish description or invent a placeholder service", () => {
    expect(
      buildDidDocumentForRequest({
        requested_did: "did:midnight:preview:contract:agent",
        subject_wallet_address: "mn_addr_preview1holder",
        organization_name: "Matrix Labs",
        organization_disclosure: "undisclosed",
        request_payload: {
          agentName: "Agent Smith",
          description: "Private review context",
        },
      }),
    ).toEqual({
      id: "did:midnight:preview:contract:agent",
      controller: "mn_addr_preview1holder",
      agentName: "Agent Smith",
      organization: "undisclosed",
    });
  });

  it("uses request.controller when the request carries a non-empty explicit controller (ADR-002)", () => {
    const doc = buildDidDocumentForRequest({
      requested_did: "did:midnight:preview:contract:agent",
      subject_wallet_address: "mn_addr_preview1holder",
      controller: "mn_addr_preview1controller",
      organization_name: "Matrix Labs",
      organization_disclosure: "disclosed",
      request_payload: {
        agentName: "Agent Smith",
      },
    });

    expect(doc.controller).toBe("mn_addr_preview1controller");
    expect(doc.controller).not.toBe("mn_addr_preview1holder");
  });

  it("falls back to subject_wallet_address when request.controller is null/undefined (legacy row, ADR-002)", () => {
    const docWithNull = buildDidDocumentForRequest({
      requested_did: "did:midnight:preview:contract:agent",
      subject_wallet_address: "mn_addr_preview1holder",
      controller: null,
      organization_name: "Matrix Labs",
      organization_disclosure: "disclosed",
      request_payload: {
        agentName: "Agent Smith",
      },
    });
    expect(docWithNull.controller).toBe("mn_addr_preview1holder");

    const docWithUndefined = buildDidDocumentForRequest({
      requested_did: "did:midnight:preview:contract:agent",
      subject_wallet_address: "mn_addr_preview1holder",
      organization_name: "Matrix Labs",
      organization_disclosure: "disclosed",
      request_payload: {
        agentName: "Agent Smith",
      },
    });
    expect(docWithUndefined.controller).toBe("mn_addr_preview1holder");
  });
});
