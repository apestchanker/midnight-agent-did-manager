import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Witnesses<PS> = {
}

export type ImpureCircuits<PS> = {
  mint_capability_tokens(context: __compactRuntime.CircuitContext<PS>,
                         coin_0: { nonce: Uint8Array,
                                   color: Uint8Array,
                                   value: bigint
                                 },
                         subscription_key_0: Uint8Array,
                         recipient_0: { bytes: Uint8Array },
                         coin_nonce_0: Uint8Array,
                         amount_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  gated_self_register_did(context: __compactRuntime.CircuitContext<PS>,
                          coin_0: { nonce: Uint8Array,
                                    color: Uint8Array,
                                    value: bigint
                                  },
                          subject_nonce_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  request_update_did(context: __compactRuntime.CircuitContext<PS>,
                     coin_0: { nonce: Uint8Array,
                               color: Uint8Array,
                               value: bigint
                             },
                     subject_nonce_0: Uint8Array,
                     doc_commitment_0: Uint8Array,
                     cap_commitment_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  issue_did(context: __compactRuntime.CircuitContext<PS>,
            coin_0: { nonce: Uint8Array, color: Uint8Array, value: bigint },
            did_key_0: Uint8Array,
            did_commitment_0: Uint8Array,
            doc_commitment_0: Uint8Array,
            proof_commitment_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  grant_role(context: __compactRuntime.CircuitContext<PS>,
             coin_0: { nonce: Uint8Array, color: Uint8Array, value: bigint },
             did_key_0: Uint8Array,
             role_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  revoke_role(context: __compactRuntime.CircuitContext<PS>,
              coin_0: { nonce: Uint8Array, color: Uint8Array, value: bigint },
              did_key_0: Uint8Array,
              role_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  rotate_admin_tokens(context: __compactRuntime.CircuitContext<PS>,
                      coin_0: { nonce: Uint8Array,
                                color: Uint8Array,
                                value: bigint
                              },
                      new_recipient_0: { bytes: Uint8Array },
                      new_coin_nonce_0: Uint8Array,
                      new_supply_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  revoke_did(context: __compactRuntime.CircuitContext<PS>,
             coin_0: { nonce: Uint8Array, color: Uint8Array, value: bigint },
             did_key_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  mint_capability_tokens(context: __compactRuntime.CircuitContext<PS>,
                         coin_0: { nonce: Uint8Array,
                                   color: Uint8Array,
                                   value: bigint
                                 },
                         subscription_key_0: Uint8Array,
                         recipient_0: { bytes: Uint8Array },
                         coin_nonce_0: Uint8Array,
                         amount_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  gated_self_register_did(context: __compactRuntime.CircuitContext<PS>,
                          coin_0: { nonce: Uint8Array,
                                    color: Uint8Array,
                                    value: bigint
                                  },
                          subject_nonce_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  request_update_did(context: __compactRuntime.CircuitContext<PS>,
                     coin_0: { nonce: Uint8Array,
                               color: Uint8Array,
                               value: bigint
                             },
                     subject_nonce_0: Uint8Array,
                     doc_commitment_0: Uint8Array,
                     cap_commitment_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  issue_did(context: __compactRuntime.CircuitContext<PS>,
            coin_0: { nonce: Uint8Array, color: Uint8Array, value: bigint },
            did_key_0: Uint8Array,
            did_commitment_0: Uint8Array,
            doc_commitment_0: Uint8Array,
            proof_commitment_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  grant_role(context: __compactRuntime.CircuitContext<PS>,
             coin_0: { nonce: Uint8Array, color: Uint8Array, value: bigint },
             did_key_0: Uint8Array,
             role_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  revoke_role(context: __compactRuntime.CircuitContext<PS>,
              coin_0: { nonce: Uint8Array, color: Uint8Array, value: bigint },
              did_key_0: Uint8Array,
              role_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  rotate_admin_tokens(context: __compactRuntime.CircuitContext<PS>,
                      coin_0: { nonce: Uint8Array,
                                color: Uint8Array,
                                value: bigint
                              },
                      new_recipient_0: { bytes: Uint8Array },
                      new_coin_nonce_0: Uint8Array,
                      new_supply_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  revoke_did(context: __compactRuntime.CircuitContext<PS>,
             coin_0: { nonce: Uint8Array, color: Uint8Array, value: bigint },
             did_key_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
  contract_version(): Uint8Array;
}

export type Circuits<PS> = {
  mint_capability_tokens(context: __compactRuntime.CircuitContext<PS>,
                         coin_0: { nonce: Uint8Array,
                                   color: Uint8Array,
                                   value: bigint
                                 },
                         subscription_key_0: Uint8Array,
                         recipient_0: { bytes: Uint8Array },
                         coin_nonce_0: Uint8Array,
                         amount_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  gated_self_register_did(context: __compactRuntime.CircuitContext<PS>,
                          coin_0: { nonce: Uint8Array,
                                    color: Uint8Array,
                                    value: bigint
                                  },
                          subject_nonce_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  request_update_did(context: __compactRuntime.CircuitContext<PS>,
                     coin_0: { nonce: Uint8Array,
                               color: Uint8Array,
                               value: bigint
                             },
                     subject_nonce_0: Uint8Array,
                     doc_commitment_0: Uint8Array,
                     cap_commitment_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  issue_did(context: __compactRuntime.CircuitContext<PS>,
            coin_0: { nonce: Uint8Array, color: Uint8Array, value: bigint },
            did_key_0: Uint8Array,
            did_commitment_0: Uint8Array,
            doc_commitment_0: Uint8Array,
            proof_commitment_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  grant_role(context: __compactRuntime.CircuitContext<PS>,
             coin_0: { nonce: Uint8Array, color: Uint8Array, value: bigint },
             did_key_0: Uint8Array,
             role_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  revoke_role(context: __compactRuntime.CircuitContext<PS>,
              coin_0: { nonce: Uint8Array, color: Uint8Array, value: bigint },
              did_key_0: Uint8Array,
              role_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  rotate_admin_tokens(context: __compactRuntime.CircuitContext<PS>,
                      coin_0: { nonce: Uint8Array,
                                color: Uint8Array,
                                value: bigint
                              },
                      new_recipient_0: { bytes: Uint8Array },
                      new_coin_nonce_0: Uint8Array,
                      new_supply_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  revoke_did(context: __compactRuntime.CircuitContext<PS>,
             coin_0: { nonce: Uint8Array, color: Uint8Array, value: bigint },
             did_key_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  contract_version(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, Uint8Array>;
}

export type Ledger = {
  valid_colors: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<[Uint8Array, boolean]>
  };
  used_capability_nullifiers: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<[Uint8Array, boolean]>
  };
  readonly registry_salt: Uint8Array;
  readonly admin_registered: boolean;
  readonly initial_admin: { bytes: Uint8Array };
  did_controller: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): { bytes: Uint8Array };
    [Symbol.iterator](): Iterator<[Uint8Array, { bytes: Uint8Array }]>
  };
  role_by_key: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<[Uint8Array, boolean]>
  };
  party_status: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): bigint;
    [Symbol.iterator](): Iterator<[Uint8Array, bigint]>
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
  update_cap_commitments: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Uint8Array;
    [Symbol.iterator](): Iterator<[Uint8Array, Uint8Array]>
  };
  revocation_commitments: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Uint8Array;
    [Symbol.iterator](): Iterator<[Uint8Array, Uint8Array]>
  };
  readonly total_active_dids: bigint;
  readonly registry_nonce: bigint;
  did_token_color: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Uint8Array;
    [Symbol.iterator](): Iterator<[Uint8Array, Uint8Array]>
  };
  readonly admin_token_color: Uint8Array;
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
               salt_0: Uint8Array,
               admin_recipient_0: { bytes: Uint8Array },
               admin_coin_nonce_0: Uint8Array,
               admin_supply_0: bigint): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
