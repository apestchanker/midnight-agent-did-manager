/**
 * Pure, render-free state logic for RequestForm.tsx.
 *
 * Extracted so the controller/agentAddress independence contract (REQ-01
 * Scenario 02, REQ-06 Scenario 02) and the default-population chain
 * (REQ-02) can be exercised by plain vitest tests, without a React
 * component-test environment (this repo has none configured — see
 * sdd/wip/006-clarify-did-controller-metadata/meta.md Notes).
 */

/** REQ-02 Scenario 01: controller defaults to the operator's connected wallet. */
export function computeDefaultController(walletAddress: string): string {
  return walletAddress || "";
}

export interface AgentControllerState {
  agentAddress: string;
  controller: string;
}

export type AgentControllerAction =
  | { type: "SET_AGENT_ADDRESS"; value: string }
  | { type: "SET_CONTROLLER"; value: string }
  | { type: "SYNC_AGENT_ADDRESS_FROM_PROP"; value: string }
  | { type: "SYNC_CONTROLLER_DEFAULT"; value: string };

/**
 * Reducer backing RequestForm's agentAddress/controller state. Each action
 * touches exactly one of the two fields — this is the mechanism that
 * guarantees REQ-01 Scenario 02 ("editing agentAddress does not change
 * controller, and vice versa") and REQ-06 Scenario 02 at the state layer.
 */
export function agentControllerReducer(
  state: AgentControllerState,
  action: AgentControllerAction,
): AgentControllerState {
  switch (action.type) {
    case "SET_AGENT_ADDRESS":
    case "SYNC_AGENT_ADDRESS_FROM_PROP":
      return { ...state, agentAddress: action.value };
    case "SET_CONTROLLER":
    case "SYNC_CONTROLLER_DEFAULT":
      return { ...state, controller: action.value };
    default:
      return state;
  }
}

export interface RequestDidDocumentInput {
  controller: string;
  agentName: string;
  organization: string;
  organizationDisclosure: "disclosed" | "undisclosed";
}

/**
 * Builds the default DID Document JSON string for RequestForm. Deliberately
 * takes `controller`, never `agentAddress` — this is what proves the
 * document's declared `controller` field is independent of the agent's
 * subject wallet address (REQ-01).
 */
export function buildRequestDidDocument(input: RequestDidDocumentInput): string {
  return JSON.stringify(
    {
      id: "",
      controller: input.controller || "",
      agentName: input.agentName || "",
      organization:
        input.organizationDisclosure === "disclosed"
          ? input.organization || ""
          : "undisclosed",
      service: [
        {
          id: "#agent-endpoint",
          type: "AgentEndpoint",
          serviceEndpoint: "https://agent.example.com",
        },
      ],
    },
    null,
    2,
  );
}
