/**
 * Pure, render-free state logic for IssuerPanel.tsx.
 *
 * Extracted so the three-level controller default chain (ADR-003) can be
 * exercised by plain vitest tests, without a React component-test
 * environment (this repo has none configured — see
 * sdd/wip/006-clarify-did-controller-metadata/meta.md Notes).
 */

/**
 * ADR-003's three-level default chain:
 *   1. record's own already-persisted controller (issued DID)
 *   2. targetController (persisted on the linked did_requests row, not yet issued)
 *   3. walletAddress (issuer's connected wallet — first-time default)
 *
 * Takes the record's controller value directly (not the whole record
 * object) so callers can list exactly the primitive values this depends
 * on — e.g. as a React effect dependency array — without needing to
 * depend on (or eslint-disable around) the entire record reference.
 */
export function computeIssuerDefaultController(
  recordController: string | null | undefined,
  targetController: string | undefined,
  walletAddress: string,
): string {
  return recordController || targetController || walletAddress || "";
}

export interface IssuerDidDocumentInput {
  existingDidDocument?: string | null;
  did?: string | null;
  networkId: string;
  contractAddress: string;
  agentId: string;
  controller: string;
  agentName?: string | null;
  organization?: string | null;
  organizationDisclosure?: "disclosed" | "undisclosed" | string | null;
  proofCommitmentHex?: string | null;
}

/**
 * Builds the default DID Document JSON string for IssuerPanel. Takes the
 * already-resolved `controller` value (see computeIssuerDefaultController)
 * instead of deriving it from targetSubjectWalletAddress/subjectWalletAddress,
 * per ADR-003.
 */
export function buildIssuerDidDocument(input: IssuerDidDocumentInput): string {
  if (input.existingDidDocument?.trim()) {
    return input.existingDidDocument;
  }
  return JSON.stringify(
    {
      id:
        input.did ||
        `did:midnight:${input.networkId}:${input.contractAddress || "contract"}:${
          input.agentId || "agent"
        }`,
      controller: input.controller || "",
      agentName: input.agentName || null,
      organization:
        input.organizationDisclosure === "disclosed"
          ? input.organization || "Matrix Labs"
          : "undisclosed",
      service: [
        {
          id: "#agent-endpoint",
          type: "AgentEndpoint",
          serviceEndpoint: "https://agent.example.com",
        },
      ],
      proofCommitment: input.proofCommitmentHex || null,
    },
    null,
    2,
  );
}
