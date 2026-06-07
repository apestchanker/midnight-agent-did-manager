import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Witnesses<PS> = {
  issuerSecret(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
}

export type ImpureCircuits<PS> = {
  rotate_issuer(context: __compactRuntime.CircuitContext<PS>,
                new_issuer_service_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  update_score(context: __compactRuntime.CircuitContext<PS>,
               agent_key_0: Uint8Array,
               new_score_0: bigint,
               evidence_commitment_0: Uint8Array,
               epoch_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  suspend_score(context: __compactRuntime.CircuitContext<PS>,
                agent_key_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  revoke_score(context: __compactRuntime.CircuitContext<PS>,
               agent_key_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  restore_score(context: __compactRuntime.CircuitContext<PS>,
                agent_key_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  get_tier(context: __compactRuntime.CircuitContext<PS>, agent_key_0: Uint8Array): __compactRuntime.CircuitResults<PS, bigint>;
  meets_threshold(context: __compactRuntime.CircuitContext<PS>,
                  agent_key_0: Uint8Array,
                  floor_0: bigint): __compactRuntime.CircuitResults<PS, boolean>;
  get_score(context: __compactRuntime.CircuitContext<PS>,
            agent_key_0: Uint8Array): __compactRuntime.CircuitResults<PS, bigint>;
  get_status(context: __compactRuntime.CircuitContext<PS>,
             agent_key_0: Uint8Array): __compactRuntime.CircuitResults<PS, bigint>;
}

export type ProvableCircuits<PS> = {
  rotate_issuer(context: __compactRuntime.CircuitContext<PS>,
                new_issuer_service_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  update_score(context: __compactRuntime.CircuitContext<PS>,
               agent_key_0: Uint8Array,
               new_score_0: bigint,
               evidence_commitment_0: Uint8Array,
               epoch_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  suspend_score(context: __compactRuntime.CircuitContext<PS>,
                agent_key_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  revoke_score(context: __compactRuntime.CircuitContext<PS>,
               agent_key_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  restore_score(context: __compactRuntime.CircuitContext<PS>,
                agent_key_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  get_tier(context: __compactRuntime.CircuitContext<PS>, agent_key_0: Uint8Array): __compactRuntime.CircuitResults<PS, bigint>;
  meets_threshold(context: __compactRuntime.CircuitContext<PS>,
                  agent_key_0: Uint8Array,
                  floor_0: bigint): __compactRuntime.CircuitResults<PS, boolean>;
  get_score(context: __compactRuntime.CircuitContext<PS>,
            agent_key_0: Uint8Array): __compactRuntime.CircuitResults<PS, bigint>;
  get_status(context: __compactRuntime.CircuitContext<PS>,
             agent_key_0: Uint8Array): __compactRuntime.CircuitResults<PS, bigint>;
}

export type PureCircuits = {
}

export type Circuits<PS> = {
  rotate_issuer(context: __compactRuntime.CircuitContext<PS>,
                new_issuer_service_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  update_score(context: __compactRuntime.CircuitContext<PS>,
               agent_key_0: Uint8Array,
               new_score_0: bigint,
               evidence_commitment_0: Uint8Array,
               epoch_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  suspend_score(context: __compactRuntime.CircuitContext<PS>,
                agent_key_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  revoke_score(context: __compactRuntime.CircuitContext<PS>,
               agent_key_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  restore_score(context: __compactRuntime.CircuitContext<PS>,
                agent_key_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  get_tier(context: __compactRuntime.CircuitContext<PS>, agent_key_0: Uint8Array): __compactRuntime.CircuitResults<PS, bigint>;
  meets_threshold(context: __compactRuntime.CircuitContext<PS>,
                  agent_key_0: Uint8Array,
                  floor_0: bigint): __compactRuntime.CircuitResults<PS, boolean>;
  get_score(context: __compactRuntime.CircuitContext<PS>,
            agent_key_0: Uint8Array): __compactRuntime.CircuitResults<PS, bigint>;
  get_status(context: __compactRuntime.CircuitContext<PS>,
             agent_key_0: Uint8Array): __compactRuntime.CircuitResults<PS, bigint>;
}

export type Ledger = {
  readonly initialized: boolean;
  readonly registry_admin: Uint8Array;
  readonly issuer_service: Uint8Array;
  scores: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): bigint;
    [Symbol.iterator](): Iterator<[Uint8Array, bigint]>
  };
  evidence_commitments: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Uint8Array;
    [Symbol.iterator](): Iterator<[Uint8Array, Uint8Array]>
  };
  last_update_epoch: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): bigint;
    [Symbol.iterator](): Iterator<[Uint8Array, bigint]>
  };
  reputation_status: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): bigint;
    [Symbol.iterator](): Iterator<[Uint8Array, bigint]>
  };
  readonly total_active: bigint;
  readonly issuer_nonce: bigint;
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
               owner_public_key_0: Uint8Array): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
