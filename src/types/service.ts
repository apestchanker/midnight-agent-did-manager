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
  };
}

export interface RegistryDidRow {
  id: string;
  did: string;
  contract_address: string;
  network_id: string;
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
