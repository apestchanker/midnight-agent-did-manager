import {
  authenticateMcpKey,
  createDidRequest,
  getCustomerContextById,
  getDidRequestById,
  listDidRequests,
  resolveDid,
  validateDid,
} from "./registry-service.js";
import {
  getCredentialBundle,
  getIssuerDescriptor,
  listCredentialsForDid,
} from "./vc-service.js";
import { createMcpServer } from "./mcp-core.js";

export function createDidMcpApp() {
  return createMcpServer({
    authenticateMcpKey,
    createDidRequest,
    getCustomerContextById,
    getDidRequestById,
    listDidRequests,
    resolveDid,
    validateDid,
    getIssuerDescriptor,
    getCredentialBundle,
    listCredentialsForDid,
  });
}
