import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Witnesses<PS> = {
}

export type ImpureCircuits<PS> = {
  prove_ownership(context: __compactRuntime.CircuitContext<PS>,
                  wallet_hash_0: Uint8Array,
                  agent_key_0: Uint8Array,
                  contract_hash_0: Uint8Array,
                  did_hash_public_0: Uint8Array,
                  challenge_hash_public_0: Uint8Array,
                  bundle_commitment_public_0: Uint8Array,
                  holder_binding_commitment_public_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  prove_ownership(context: __compactRuntime.CircuitContext<PS>,
                  wallet_hash_0: Uint8Array,
                  agent_key_0: Uint8Array,
                  contract_hash_0: Uint8Array,
                  did_hash_public_0: Uint8Array,
                  challenge_hash_public_0: Uint8Array,
                  bundle_commitment_public_0: Uint8Array,
                  holder_binding_commitment_public_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
}

export type Circuits<PS> = {
  prove_ownership(context: __compactRuntime.CircuitContext<PS>,
                  wallet_hash_0: Uint8Array,
                  agent_key_0: Uint8Array,
                  contract_hash_0: Uint8Array,
                  did_hash_public_0: Uint8Array,
                  challenge_hash_public_0: Uint8Array,
                  bundle_commitment_public_0: Uint8Array,
                  holder_binding_commitment_public_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  readonly proof_domain: Uint8Array;
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
