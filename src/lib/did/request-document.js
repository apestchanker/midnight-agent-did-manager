export function buildDidDocumentForRequest(request) {
  const payload =
    request.request_payload &&
    typeof request.request_payload === "object" &&
    !Array.isArray(request.request_payload)
      ? request.request_payload
      : {};
  const proposedServices = Array.isArray(payload.proposedServices)
    ? payload.proposedServices
    : [];
  const didDocument = {
    id: request.requested_did || "",
    controller: request.subject_wallet_address,
    agentName:
      typeof payload.agentName === "string" && payload.agentName.trim()
        ? payload.agentName.trim()
        : "Agent",
    organization:
      request.organization_disclosure === "disclosed"
        ? request.organization_name
        : "undisclosed",
  };

  if (proposedServices.length) {
    didDocument.service = proposedServices.map((service, index) => ({
      id: `#service-${index + 1}`,
      type: service.type,
      serviceEndpoint: service.serviceEndpoint,
    }));
  }

  return didDocument;
}
