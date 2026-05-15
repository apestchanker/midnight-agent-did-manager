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
  createMidnightProofRequest,
  verifyMidnightProofSubmission,
  verifyUnifiedVP,
} from "./midnight-proof-service.js";
import {
  createProofRequestForAgent,
  getProofRequestById,
  listProofRequests,
} from "./proof-request-service.js";
import {
  getCredentialBundle,
  getIssuerDescriptor,
  getMidnightProofMaterial,
  listCredentialsForDid,
  rotateCredentialsForDid,
} from "./vc-service.js";
import { createMcpServer } from "./mcp-core.js";

export function createDidMcpApp() {
  return createMcpServer({
    authenticateMcpKey,
    createDidRequest,
    createProofRequestForAgent,
    getCustomerContextById,
    getDidRequestById,
    getProofRequestById,
    listDidRequests,
    listProofRequests,
    resolveDid,
    validateDid,
    getIssuerDescriptor,
    getCredentialBundle,
    getMidnightProofMaterial,
    createMidnightProofRequest,
    listCredentialsForDid,
    rotateCredentialsForDid,
    verifyMidnightProofSubmission,
    verifyUnifiedVP,
  });
}
