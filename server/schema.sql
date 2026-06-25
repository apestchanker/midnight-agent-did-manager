create extension if not exists pgcrypto;

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  display_name text not null,
  status text not null default 'active' check (status in ('active', 'suspended', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists customer_wallets (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  wallet_address text not null unique,
  is_primary boolean not null default false,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  plan_code text not null,
  status text not null default 'active' check (status in ('active', 'paused', 'expired')),
  did_quota_total integer not null check (did_quota_total >= 0),
  did_quota_remaining integer not null check (did_quota_remaining >= 0),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists mcp_keys (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  label text not null,
  key_id text not null unique,
  key_hash text not null unique,
  contract_address text,
  network_id text,
  status text not null default 'active' check (status in ('active', 'revoked', 'expired')),
  scopes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz
);

create table if not exists did_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  subscription_id uuid references subscriptions(id) on delete set null,
  mcp_key_id uuid references mcp_keys(id) on delete set null,
  contract_address text not null,
  network_id text not null,
  agent_id text,
  requester_wallet_address text not null,
  subject_wallet_address text not null,
  request_status text not null default 'pending_human_approval'
    check (
      request_status in (
        'pending_human_approval',
        'human_approved',
        'human_rejected',
        'pending_admin_review',
        'issued',
        'admin_rejected',
        'revocation_requested',
        'revoked',
        'update_requested',
        'updated'
      )
    ),
  organization_name text,
  organization_disclosure text not null default 'undisclosed'
    check (organization_disclosure in ('disclosed', 'undisclosed')),
  request_payload jsonb not null default '{}'::jsonb,
  selective_disclosure_template jsonb not null default '{}'::jsonb,
  requested_did text,
  onchain_request_tx_id text,
  onchain_request_tx_hash text,
  onchain_issue_tx_id text,
  onchain_issue_tx_hash text,
  human_approved_at timestamptz,
  human_approved_by_wallet text,
  admin_decision_at timestamptz,
  admin_decision_by text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists did_records (
  id uuid primary key default gen_random_uuid(),
  request_id uuid unique references did_requests(id) on delete cascade,
  did text not null unique,
  contract_address text not null,
  network_id text not null,
  agent_id text,
  subject_wallet_address text not null,
  subject_agent_key text not null,
  issuer_wallet_address text not null,
  status text not null check (status in ('active', 'revoked')),
  organization_name text,
  organization_disclosure text not null default 'undisclosed'
    check (organization_disclosure in ('disclosed', 'undisclosed')),
  did_commitment text,
  document_commitment text,
  proof_commitment text,
  revocation_commitment text,
  did_document jsonb not null default '{}'::jsonb,
  claims_manifest jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  issued_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz
);

alter table if exists did_requests add column if not exists agent_id text;
alter table if exists did_records add column if not exists agent_id text;
alter table if exists mcp_keys add column if not exists contract_address text;
alter table if exists mcp_keys add column if not exists network_id text;
update did_requests
set agent_id = lower(coalesce(agent_id, subject_wallet_address))
where agent_id is null;
update did_records
set agent_id = lower(coalesce(agent_id, subject_wallet_address))
where agent_id is null;

create index if not exists idx_customer_wallets_customer_id on customer_wallets(customer_id);
create index if not exists idx_subscriptions_customer_id on subscriptions(customer_id);
create index if not exists idx_mcp_keys_customer_id on mcp_keys(customer_id);
create index if not exists idx_did_requests_customer_id on did_requests(customer_id);
create index if not exists idx_did_requests_subject_wallet on did_requests(subject_wallet_address);
create index if not exists idx_did_requests_agent_id on did_requests(agent_id);
create index if not exists idx_did_requests_status on did_requests(request_status);
create index if not exists idx_did_records_subject_wallet on did_records(subject_wallet_address);
create index if not exists idx_did_records_agent_id on did_records(agent_id);
create index if not exists idx_did_records_contract_address on did_records(contract_address);

create table if not exists admin_registry_deployments (
  id uuid primary key default gen_random_uuid(),
  network_id text not null,
  contract_address text not null unique,
  deployer_wallet_address text not null,
  deployer_shielded_address text,
  registry_admin_wallet_address text,
  issuer_wallet_address text,
  deploy_tx_id text,
  deploy_tx_hash text,
  initialize_tx_id text,
  initialize_tx_hash text,
  deployment_mode text not null default 'onchain'
    check (deployment_mode in ('onchain', 'local-fallback')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_admin_registry_deployments_network on admin_registry_deployments(network_id, created_at desc);
create index if not exists idx_admin_registry_deployments_deployer on admin_registry_deployments(deployer_wallet_address, created_at desc);

create table if not exists verifiable_credentials (
  id uuid primary key default gen_random_uuid(),
  did_record_id uuid not null references did_records(id) on delete cascade,
  request_id uuid references did_requests(id) on delete set null,
  customer_id uuid references customers(id) on delete set null,
  credential_type text not null,
  disclosure_scope text not null,
  jwt text not null unique,
  issuer_id text not null,
  subject_did text not null,
  claims jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'revoked')),
  issued_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz
);

create index if not exists idx_verifiable_credentials_did_record_id on verifiable_credentials(did_record_id);
create index if not exists idx_verifiable_credentials_subject_did on verifiable_credentials(subject_did);
create index if not exists idx_verifiable_credentials_type on verifiable_credentials(credential_type);

create table if not exists proof_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  mcp_key_id uuid references mcp_keys(id) on delete set null,
  did_record_id uuid not null references did_records(id) on delete cascade,
  did text not null,
  contract_address text not null,
  network_id text not null,
  agent_id text,
  requester_wallet_address text not null,
  holder_wallet_address text not null,
  request_status text not null default 'pending_human_approval'
    check (
      request_status in (
        'pending_human_approval',
        'human_approved',
        'human_rejected',
        'proof_ready',
        'submitted',
        'verified',
        'rejected'
      )
    ),
  scopes jsonb not null default '[]'::jsonb,
  verifier text,
  purpose text not null default 'selective-disclosure',
  challenge text not null,
  proof_material jsonb not null default '{}'::jsonb,
  approval_payload text not null,
  holder_signature jsonb,
  proof_submission jsonb,
  verification_result jsonb,
  human_approved_at timestamptz,
  human_approved_by_wallet text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_proof_requests_customer_id on proof_requests(customer_id);
create index if not exists idx_proof_requests_did on proof_requests(did);
create index if not exists idx_proof_requests_status on proof_requests(request_status);

-- Migration: add verification audit columns (idempotent — safe to run multiple times)
-- New audit event type: proof_request_verified (inserted into audit_events when a proof is fully verified)
alter table proof_requests add column if not exists verified_at timestamptz null;
alter table proof_requests add column if not exists verification_failure_layer text null;

create table if not exists audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_type text not null,
  actor_ref text not null,
  event_type text not null,
  entity_type text not null,
  entity_id text not null,
  event_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_events_entity on audit_events(entity_type, entity_id);
