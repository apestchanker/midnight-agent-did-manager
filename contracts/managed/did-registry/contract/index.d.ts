import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Witnesses<PS> = {
  issuerSecret(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
}

export type ImpureCircuits<PS> = {
  request_did(context: __compactRuntime.CircuitContext<PS>,
              agent_key_0: Uint8Array,
              request_commitment_0: Uint8Array,
              proof_commitment_0: Uint8Array,
              organization_label_0: Uint8Array,
              organization_disclosure_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  issue_did(context: __compactRuntime.CircuitContext<PS>,
            agent_key_0: Uint8Array,
            did_commitment_0: Uint8Array,
            document_commitment_0: Uint8Array,
            proof_commitment_0: Uint8Array,
            organization_label_0: Uint8Array,
            organization_disclosure_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  request_update(context: __compactRuntime.CircuitContext<PS>,
                 agent_key_0: Uint8Array,
                 update_request_commitment_0: Uint8Array,
                 proof_commitment_0: Uint8Array,
                 organization_label_0: Uint8Array,
                 organization_disclosure_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  update_did(context: __compactRuntime.CircuitContext<PS>,
             agent_key_0: Uint8Array,
             did_commitment_0: Uint8Array,
             document_commitment_0: Uint8Array,
             proof_commitment_0: Uint8Array,
             organization_label_0: Uint8Array,
             organization_disclosure_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  request_revoke(context: __compactRuntime.CircuitContext<PS>,
                 agent_key_0: Uint8Array,
                 revocation_request_commitment_0: Uint8Array,
                 proof_commitment_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  revoke_did(context: __compactRuntime.CircuitContext<PS>,
             agent_key_0: Uint8Array,
             revocation_commitment_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  request_did(context: __compactRuntime.CircuitContext<PS>,
              agent_key_0: Uint8Array,
              request_commitment_0: Uint8Array,
              proof_commitment_0: Uint8Array,
              organization_label_0: Uint8Array,
              organization_disclosure_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  issue_did(context: __compactRuntime.CircuitContext<PS>,
            agent_key_0: Uint8Array,
            did_commitment_0: Uint8Array,
            document_commitment_0: Uint8Array,
            proof_commitment_0: Uint8Array,
            organization_label_0: Uint8Array,
            organization_disclosure_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  request_update(context: __compactRuntime.CircuitContext<PS>,
                 agent_key_0: Uint8Array,
                 update_request_commitment_0: Uint8Array,
                 proof_commitment_0: Uint8Array,
                 organization_label_0: Uint8Array,
                 organization_disclosure_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  update_did(context: __compactRuntime.CircuitContext<PS>,
             agent_key_0: Uint8Array,
             did_commitment_0: Uint8Array,
             document_commitment_0: Uint8Array,
             proof_commitment_0: Uint8Array,
             organization_label_0: Uint8Array,
             organization_disclosure_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  request_revoke(context: __compactRuntime.CircuitContext<PS>,
                 agent_key_0: Uint8Array,
                 revocation_request_commitment_0: Uint8Array,
                 proof_commitment_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  revoke_did(context: __compactRuntime.CircuitContext<PS>,
             agent_key_0: Uint8Array,
             revocation_commitment_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
  contract_version(): Uint8Array;
}

export type Circuits<PS> = {
  contract_version(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, Uint8Array>;
  request_did(context: __compactRuntime.CircuitContext<PS>,
              agent_key_0: Uint8Array,
              request_commitment_0: Uint8Array,
              proof_commitment_0: Uint8Array,
              organization_label_0: Uint8Array,
              organization_disclosure_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  issue_did(context: __compactRuntime.CircuitContext<PS>,
            agent_key_0: Uint8Array,
            did_commitment_0: Uint8Array,
            document_commitment_0: Uint8Array,
            proof_commitment_0: Uint8Array,
            organization_label_0: Uint8Array,
            organization_disclosure_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  request_update(context: __compactRuntime.CircuitContext<PS>,
                 agent_key_0: Uint8Array,
                 update_request_commitment_0: Uint8Array,
                 proof_commitment_0: Uint8Array,
                 organization_label_0: Uint8Array,
                 organization_disclosure_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  update_did(context: __compactRuntime.CircuitContext<PS>,
             agent_key_0: Uint8Array,
             did_commitment_0: Uint8Array,
             document_commitment_0: Uint8Array,
             proof_commitment_0: Uint8Array,
             organization_label_0: Uint8Array,
             organization_disclosure_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  request_revoke(context: __compactRuntime.CircuitContext<PS>,
                 agent_key_0: Uint8Array,
                 revocation_request_commitment_0: Uint8Array,
                 proof_commitment_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  revoke_did(context: __compactRuntime.CircuitContext<PS>,
             agent_key_0: Uint8Array,
             revocation_commitment_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  readonly initialized: boolean;
  readonly registry_admin: Uint8Array;
  readonly issuer_service: Uint8Array;
  readonly total_requests: bigint;
  readonly total_active_dids: bigint;
  status_by_agent: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): bigint;
    [Symbol.iterator](): Iterator<[Uint8Array, bigint]>
  };
  request_commitments: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Uint8Array;
    [Symbol.iterator](): Iterator<[Uint8Array, Uint8Array]>
  };
  update_request_commitments: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Uint8Array;
    [Symbol.iterator](): Iterator<[Uint8Array, Uint8Array]>
  };
  revocation_request_commitments: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Uint8Array;
    [Symbol.iterator](): Iterator<[Uint8Array, Uint8Array]>
  };
  did_commitments: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Uint8Array;
    [Symbol.iterator](): Iterator<[Uint8Array, Uint8Array]>
  };
  document_commitments: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Uint8Array;
    [Symbol.iterator](): Iterator<[Uint8Array, Uint8Array]>
  };
  proof_commitments: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Uint8Array;
    [Symbol.iterator](): Iterator<[Uint8Array, Uint8Array]>
  };
  organization_labels: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Uint8Array;
    [Symbol.iterator](): Iterator<[Uint8Array, Uint8Array]>
  };
  organization_disclosures: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): bigint;
    [Symbol.iterator](): Iterator<[Uint8Array, bigint]>
  };
  revocation_commitments: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Uint8Array;
    [Symbol.iterator](): Iterator<[Uint8Array, Uint8Array]>
  };
  readonly registry_nonce: bigint;
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>,
               owner_secret_0: Uint8Array): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
