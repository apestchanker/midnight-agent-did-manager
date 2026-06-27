import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Witnesses<PS> = {
}

export type ImpureCircuits<PS> = {
  mint_capability_tokens(context: __compactRuntime.CircuitContext<PS>,
                         subscription_key_0: Uint8Array,
                         recipient_0: { bytes: Uint8Array },
                         coin_nonce_0: Uint8Array,
                         amount_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  consume_token_for_action(context: __compactRuntime.CircuitContext<PS>,
                           coin_0: { nonce: Uint8Array,
                                     color: Uint8Array,
                                     value: bigint,
                                     mt_index: bigint
                                   },
                           action_type_0: Uint8Array,
                           did_key_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  mint_capability_tokens(context: __compactRuntime.CircuitContext<PS>,
                         subscription_key_0: Uint8Array,
                         recipient_0: { bytes: Uint8Array },
                         coin_nonce_0: Uint8Array,
                         amount_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  consume_token_for_action(context: __compactRuntime.CircuitContext<PS>,
                           coin_0: { nonce: Uint8Array,
                                     color: Uint8Array,
                                     value: bigint,
                                     mt_index: bigint
                                   },
                           action_type_0: Uint8Array,
                           did_key_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
}

export type Circuits<PS> = {
  mint_capability_tokens(context: __compactRuntime.CircuitContext<PS>,
                         subscription_key_0: Uint8Array,
                         recipient_0: { bytes: Uint8Array },
                         coin_nonce_0: Uint8Array,
                         amount_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  consume_token_for_action(context: __compactRuntime.CircuitContext<PS>,
                           coin_0: { nonce: Uint8Array,
                                     color: Uint8Array,
                                     value: bigint,
                                     mt_index: bigint
                                   },
                           action_type_0: Uint8Array,
                           did_key_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  capability_commitments: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Uint8Array;
    [Symbol.iterator](): Iterator<[Uint8Array, Uint8Array]>
  };
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
