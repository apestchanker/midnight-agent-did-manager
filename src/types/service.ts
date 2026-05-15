export interface Customer {
  id: string;
  email: string;
  display_name: string;
  status: string;
  linked_wallet_address?: string;
  linked_wallet_primary?: boolean;
}

export interface Subscription {
  id: string;
  customer_id: string;
  plan_code: string;
  status: string;
  did_quota_total: number;
  did_quota_remaining: number;
  starts_at: string;
  ends_at?: string | null;
}

export interface McpKey {
  id: string;
  customer_id: string;
  label: string;
  key_id: string;
  status: string;
  scopes: string[];
  created_at: string;
  last_used_at?: string | null;
  expires_at?: string | null;
  plainTextKey?: string;
}

export interface CustomerContext {
  customer: Customer;
  subscriptions: Subscription[];
  mcpKeys: McpKey[];
}

export interface DidRequestRow {
  id: string;
  customer_id: string;
  subscription_id?: string | null;
  mcp_key_id?: string | null;
  contract_address: string;
  network_id: string;
  agent_id?: string | null;
  requester_wallet_address: string;
  subject_wallet_address: string;
  request_status: string;
  organization_name?: string | null;
  organization_disclosure: "disclosed" | "undisclosed";
  request_payload: Record<string, unknown>;
  selective_disclosure_template: Record<string, unknown>;
  requested_did?: string | null;
  onchain_request_tx_id?: string | null;
  onchain_request_tx_hash?: string | null;
  onchain_issue_tx_id?: string | null;
  onchain_issue_tx_hash?: string | null;
  human_approved_at?: string | null;
  human_approved_by_wallet?: string | null;
  admin_decision_at?: string | null;
  admin_decision_by?: string | null;
  error_message?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProofRequestRow {
  id: string;
  customer_id: string;
  mcp_key_id?: string | null;
  did_record_id: string;
  did: string;
  contract_address: string;
  network_id: string;
  agent_id?: string | null;
  requester_wallet_address: string;
  holder_wallet_address: string;
  request_status:
    | "pending_human_approval"
    | "human_approved"
    | "human_rejected"
    | "proof_ready"
    | "submitted"
    | "verified"
    | "rejected";
  scopes: string[];
  verifier?: string | null;
  purpose: string;
  challenge: string;
  proof_material: MidnightProofMaterial;
  approval_payload: string;
  holder_signature?: Record<string, unknown> | null;
  proof_submission?: Record<string, unknown> | null;
  verification_result?: Record<string, unknown> | null;
  human_approved_at?: string | null;
  human_approved_by_wallet?: string | null;
  error_message?: string | null;
  created_at: string;
  updated_at: string;
}

export interface BootstrapResponse {
  customer: Customer;
  subscription: Subscription;
  mcpKey: McpKey;
}

export interface VerifiableCredentialRow {
  id: string;
  credential_type: string;
  disclosure_scope: string;
  issuer_id: string;
  subject_did: string;
  claims: Record<string, unknown>;
  status: string;
  issued_at: string;
  expires_at?: string | null;
  jwt: string;
}

export interface CredentialBundle {
  holder: string;
  disclosedScopes: string[];
  verifiableCredentials: string[];
  presentation: {
    "@context": string[];
    type: string[];
    holder: string;
    verifiableCredential: string[];
    proof?: Record<string, unknown>;
  };
}

export interface MidnightProofStatement {
  scope: string;
  credentialType: string;
  claimKeys: string[];
  commitment: string;
}

export interface MidnightNativeOwnershipMaterial {
  scheme: "midnight-native-ownership-v1";
  keyLocation: "prove_ownership";
  contractAddress: string;
  holderWalletAddress: string;
  agentKeyHex: string;
  walletHashHex: string;
  contractHashHex: string;
  didHashHex: string;
  challengeHashHex: string;
  bundleCommitment: string;
  holderBindingCommitment: string;
}

export interface MidnightProofMaterial {
  did: string;
  holder: string;
  network: "midnight";
  proofType: "midnight-credential-commitment";
  challenge: string;
  verifier?: string;
  purpose: string;
  disclosedScopes: string[];
  credentialCount: number;
  credentialCommitments: MidnightProofStatement[];
  bundleCommitment: string;
  holderBindingCommitment: string;
  nativeOwnership?: MidnightNativeOwnershipMaterial;
  verificationHints: {
    statusCheck: "resolve-did-and-check-active";
    issuerCheck: "verify-vc-jwt-signatures";
    holderBinding: "holder-binding-midnight-proof-required";
  };
}

export interface MidnightProofRequest {
  requestId: string;
  createdAt: string;
  expiresAt: string;
  proofRequestType: "midnight-holder-proof-request";
  material: MidnightProofMaterial;
  instructions: string[];
}

export interface MidnightProofSubmission {
  did: string;
  challenge: string;
  bundleCommitment: string;
  holderBindingCommitment: string;
  /** Coin public key from the holder's wallet (Bech32m or hex). Required for midnight-zk-proof format. */
  coinPublicKey?: string;
  proof: {
    format: string;
    proofValue: string;
    scheme?: string;
    publicInputsHash?: string;
    publicInputs?: Record<string, unknown>;
    proverUrl?: string;
    generatedBy?: string;
    generatedAt?: string;
  };
}

export interface MidnightProofVerificationPackage {
  proofRequest: MidnightProofRequest;
  submission: MidnightProofSubmission;
}

export interface MidnightProofVerificationResult {
  valid: boolean;
  status:
    | "boundary_verified_only"
    | "native_proof_verified"
    | "native_proof_unverified"
    | "preview_envelope_verified"
    | "invalid_submission"
    | "did_not_active";
  did: string;
  didActive: boolean;
  issuerCredentialsVerified: boolean;
  requestIntegrityVerified: boolean;
  cryptographicProofVerified: boolean;
  proofEnvelopeVerified?: boolean;
  submissionMatchesRequest?: boolean;
  warnings: string[];
  verificationMaterial?: {
    expectedBundleCommitment: string;
    expectedHolderBindingCommitment: string;
    verifiedScopes: string[];
    credentialCount: number;
  };
}

export interface RegistryDidRow {
  id: string;
  did: string;
  contract_address: string;
  network_id: string;
  agent_id?: string | null;
  subject_wallet_address: string;
  subject_agent_key: string;
  issuer_wallet_address: string;
  status: string;
  organization_name?: string | null;
  organization_disclosure: "disclosed" | "undisclosed";
  did_commitment?: string | null;
  document_commitment?: string | null;
  proof_commitment?: string | null;
  revocation_commitment?: string | null;
  did_document?: Record<string, unknown> | null;
  public_agent_name?: string | null;
  created_at: string;
  issued_at: string;
  updated_at: string;
  revoked_at?: string | null;
}

export interface LogEntry {
  id: string;
  ts: string;
  level: string;
  scope: string;
  message: string;
}
