import type { DidRequestRow } from "../../types/service";

export function buildDidDocumentForRequest(
  request: Pick<
    DidRequestRow,
    | "requested_did"
    | "subject_wallet_address"
    | "organization_name"
    | "organization_disclosure"
    | "request_payload"
  >,
): Record<string, unknown>;
