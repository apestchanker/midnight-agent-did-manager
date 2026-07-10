import { describe, expect, it } from "vitest";
import {
  agentControllerReducer,
  buildRequestDidDocument,
  computeDefaultController,
} from "../src/lib/did/request-form-state";

describe("computeDefaultController (REQ-02 S01)", () => {
  it("defaults to the connected wallet address", () => {
    expect(computeDefaultController("mn_addr_preview1wallet")).toBe(
      "mn_addr_preview1wallet",
    );
  });

  it("defaults to empty string when no wallet is connected", () => {
    expect(computeDefaultController("")).toBe("");
  });
});

describe("agentControllerReducer — controller/agentAddress state independence (REQ-01 S02, REQ-06 S02)", () => {
  const initial = {
    agentAddress: "mn_addr_preview1agent",
    controller: "mn_addr_preview1wallet",
  };

  it("SET_CONTROLLER updates controller without touching agentAddress", () => {
    const next = agentControllerReducer(initial, {
      type: "SET_CONTROLLER",
      value: "mn_addr_preview1editedcontroller",
    });
    expect(next.controller).toBe("mn_addr_preview1editedcontroller");
    expect(next.agentAddress).toBe(initial.agentAddress);
  });

  it("SET_AGENT_ADDRESS updates agentAddress without touching controller", () => {
    const next = agentControllerReducer(initial, {
      type: "SET_AGENT_ADDRESS",
      value: "mn_addr_preview1editedagent",
    });
    expect(next.agentAddress).toBe("mn_addr_preview1editedagent");
    expect(next.controller).toBe(initial.controller);
  });

  it("SYNC_CONTROLLER_DEFAULT (walletAddress prop change) leaves agentAddress untouched", () => {
    const next = agentControllerReducer(initial, {
      type: "SYNC_CONTROLLER_DEFAULT",
      value: "mn_addr_preview1newwallet",
    });
    expect(next.controller).toBe("mn_addr_preview1newwallet");
    expect(next.agentAddress).toBe(initial.agentAddress);
  });

  it("SYNC_AGENT_ADDRESS_FROM_PROP (initialAgentAddress prop change) leaves controller untouched", () => {
    const next = agentControllerReducer(initial, {
      type: "SYNC_AGENT_ADDRESS_FROM_PROP",
      value: "mn_addr_preview1propagent",
    });
    expect(next.agentAddress).toBe("mn_addr_preview1propagent");
    expect(next.controller).toBe(initial.controller);
  });

  it("chained SET_AGENT_ADDRESS then SET_CONTROLLER never lets one clobber the other", () => {
    const afterAgent = agentControllerReducer(initial, {
      type: "SET_AGENT_ADDRESS",
      value: "mn_addr_preview1step1",
    });
    const afterController = agentControllerReducer(afterAgent, {
      type: "SET_CONTROLLER",
      value: "mn_addr_preview1step2",
    });
    expect(afterController.agentAddress).toBe("mn_addr_preview1step1");
    expect(afterController.controller).toBe("mn_addr_preview1step2");
  });
});

describe("buildRequestDidDocument (REQ-01, REQ-02)", () => {
  it("uses the controller value — not agentAddress — for the document's controller field", () => {
    const doc = JSON.parse(
      buildRequestDidDocument({
        controller: "mn_addr_preview1controller",
        agentName: "Agent Smith",
        organization: "Acme",
        organizationDisclosure: "disclosed",
      }),
    );
    expect(doc.controller).toBe("mn_addr_preview1controller");
    expect(doc.agentName).toBe("Agent Smith");
    expect(doc.organization).toBe("Acme");
  });

  it("keeps organization undisclosed unless organizationDisclosure is 'disclosed'", () => {
    const doc = JSON.parse(
      buildRequestDidDocument({
        controller: "mn_addr_preview1controller",
        agentName: "",
        organization: "Acme",
        organizationDisclosure: "undisclosed",
      }),
    );
    expect(doc.organization).toBe("undisclosed");
  });

  it("defaults controller to empty string when omitted", () => {
    const doc = JSON.parse(
      buildRequestDidDocument({
        controller: "",
        agentName: "",
        organization: "",
        organizationDisclosure: "undisclosed",
      }),
    );
    expect(doc.controller).toBe("");
  });

  it("always includes a single deterministic agent-endpoint service entry", () => {
    const doc = JSON.parse(
      buildRequestDidDocument({
        controller: "mn_addr_preview1controller",
        agentName: "Agent Smith",
        organization: "",
        organizationDisclosure: "undisclosed",
      }),
    );
    expect(doc.service).toEqual([
      {
        id: "#agent-endpoint",
        type: "AgentEndpoint",
        serviceEndpoint: "https://agent.example.com",
      },
    ]);
  });
});
