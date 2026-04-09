import * as __compactRuntime from '@midnight-ntwrk/compact-runtime';
__compactRuntime.checkRuntimeVersion('0.15.0');

const _descriptor_0 = new __compactRuntime.CompactTypeBytes(32);

const _descriptor_1 = new __compactRuntime.CompactTypeVector(5, _descriptor_0);

const _descriptor_2 = new __compactRuntime.CompactTypeVector(4, _descriptor_0);

const _descriptor_3 = new __compactRuntime.CompactTypeUnsignedInteger(18446744073709551615n, 8);

const _descriptor_4 = __compactRuntime.CompactTypeBoolean;

class _Either_0 {
  alignment() {
    return _descriptor_4.alignment().concat(_descriptor_0.alignment().concat(_descriptor_0.alignment()));
  }
  fromValue(value_0) {
    return {
      is_left: _descriptor_4.fromValue(value_0),
      left: _descriptor_0.fromValue(value_0),
      right: _descriptor_0.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_4.toValue(value_0.is_left).concat(_descriptor_0.toValue(value_0.left).concat(_descriptor_0.toValue(value_0.right)));
  }
}

const _descriptor_5 = new _Either_0();

const _descriptor_6 = new __compactRuntime.CompactTypeUnsignedInteger(340282366920938463463374607431768211455n, 16);

class _ContractAddress_0 {
  alignment() {
    return _descriptor_0.alignment();
  }
  fromValue(value_0) {
    return {
      bytes: _descriptor_0.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_0.toValue(value_0.bytes);
  }
}

const _descriptor_7 = new _ContractAddress_0();

const _descriptor_8 = new __compactRuntime.CompactTypeUnsignedInteger(255n, 1);

export class Contract {
  witnesses;
  constructor(...args_0) {
    if (args_0.length !== 1) {
      throw new __compactRuntime.CompactError(`Contract constructor: expected 1 argument, received ${args_0.length}`);
    }
    const witnesses_0 = args_0[0];
    if (typeof(witnesses_0) !== 'object') {
      throw new __compactRuntime.CompactError('first (witnesses) argument to Contract constructor is not an object');
    }
    this.witnesses = witnesses_0;
    this.circuits = {
      prove_ownership: (...args_1) => {
        if (args_1.length !== 8) {
          throw new __compactRuntime.CompactError(`prove_ownership: expected 8 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const wallet_hash_0 = args_1[1];
        const agent_key_0 = args_1[2];
        const contract_hash_0 = args_1[3];
        const did_hash_public_0 = args_1[4];
        const challenge_hash_public_0 = args_1[5];
        const bundle_commitment_public_0 = args_1[6];
        const holder_binding_commitment_public_0 = args_1[7];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.currentQueryContext != undefined)) {
          __compactRuntime.typeError('prove_ownership',
                                     'argument 1 (as invoked from Typescript)',
                                     'native_ownership_proof.compact line 46 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(wallet_hash_0.buffer instanceof ArrayBuffer && wallet_hash_0.BYTES_PER_ELEMENT === 1 && wallet_hash_0.length === 32)) {
          __compactRuntime.typeError('prove_ownership',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'native_ownership_proof.compact line 46 char 1',
                                     'Bytes<32>',
                                     wallet_hash_0)
        }
        if (!(agent_key_0.buffer instanceof ArrayBuffer && agent_key_0.BYTES_PER_ELEMENT === 1 && agent_key_0.length === 32)) {
          __compactRuntime.typeError('prove_ownership',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'native_ownership_proof.compact line 46 char 1',
                                     'Bytes<32>',
                                     agent_key_0)
        }
        if (!(contract_hash_0.buffer instanceof ArrayBuffer && contract_hash_0.BYTES_PER_ELEMENT === 1 && contract_hash_0.length === 32)) {
          __compactRuntime.typeError('prove_ownership',
                                     'argument 3 (argument 4 as invoked from Typescript)',
                                     'native_ownership_proof.compact line 46 char 1',
                                     'Bytes<32>',
                                     contract_hash_0)
        }
        if (!(did_hash_public_0.buffer instanceof ArrayBuffer && did_hash_public_0.BYTES_PER_ELEMENT === 1 && did_hash_public_0.length === 32)) {
          __compactRuntime.typeError('prove_ownership',
                                     'argument 4 (argument 5 as invoked from Typescript)',
                                     'native_ownership_proof.compact line 46 char 1',
                                     'Bytes<32>',
                                     did_hash_public_0)
        }
        if (!(challenge_hash_public_0.buffer instanceof ArrayBuffer && challenge_hash_public_0.BYTES_PER_ELEMENT === 1 && challenge_hash_public_0.length === 32)) {
          __compactRuntime.typeError('prove_ownership',
                                     'argument 5 (argument 6 as invoked from Typescript)',
                                     'native_ownership_proof.compact line 46 char 1',
                                     'Bytes<32>',
                                     challenge_hash_public_0)
        }
        if (!(bundle_commitment_public_0.buffer instanceof ArrayBuffer && bundle_commitment_public_0.BYTES_PER_ELEMENT === 1 && bundle_commitment_public_0.length === 32)) {
          __compactRuntime.typeError('prove_ownership',
                                     'argument 6 (argument 7 as invoked from Typescript)',
                                     'native_ownership_proof.compact line 46 char 1',
                                     'Bytes<32>',
                                     bundle_commitment_public_0)
        }
        if (!(holder_binding_commitment_public_0.buffer instanceof ArrayBuffer && holder_binding_commitment_public_0.BYTES_PER_ELEMENT === 1 && holder_binding_commitment_public_0.length === 32)) {
          __compactRuntime.typeError('prove_ownership',
                                     'argument 7 (argument 8 as invoked from Typescript)',
                                     'native_ownership_proof.compact line 46 char 1',
                                     'Bytes<32>',
                                     holder_binding_commitment_public_0)
        }
        const context = { ...contextOrig_0, gasCost: __compactRuntime.emptyRunningCost() };
        const partialProofData = {
          input: {
            value: _descriptor_0.toValue(wallet_hash_0).concat(_descriptor_0.toValue(agent_key_0).concat(_descriptor_0.toValue(contract_hash_0).concat(_descriptor_0.toValue(did_hash_public_0).concat(_descriptor_0.toValue(challenge_hash_public_0).concat(_descriptor_0.toValue(bundle_commitment_public_0).concat(_descriptor_0.toValue(holder_binding_commitment_public_0))))))),
            alignment: _descriptor_0.alignment().concat(_descriptor_0.alignment().concat(_descriptor_0.alignment().concat(_descriptor_0.alignment().concat(_descriptor_0.alignment().concat(_descriptor_0.alignment().concat(_descriptor_0.alignment()))))))
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = this._prove_ownership_0(context,
                                                 partialProofData,
                                                 wallet_hash_0,
                                                 agent_key_0,
                                                 contract_hash_0,
                                                 did_hash_public_0,
                                                 challenge_hash_public_0,
                                                 bundle_commitment_public_0,
                                                 holder_binding_commitment_public_0);
        partialProofData.output = { value: [], alignment: [] };
        return { result: result_0, context: context, proofData: partialProofData, gasCost: context.gasCost };
      }
    };
    this.impureCircuits = { prove_ownership: this.circuits.prove_ownership };
    this.provableCircuits = { prove_ownership: this.circuits.prove_ownership };
  }
  initialState(...args_0) {
    if (args_0.length !== 1) {
      throw new __compactRuntime.CompactError(`Contract state constructor: expected 1 argument (as invoked from Typescript), received ${args_0.length}`);
    }
    const constructorContext_0 = args_0[0];
    if (typeof(constructorContext_0) !== 'object') {
      throw new __compactRuntime.CompactError(`Contract state constructor: expected 'constructorContext' in argument 1 (as invoked from Typescript) to be an object`);
    }
    if (!('initialZswapLocalState' in constructorContext_0)) {
      throw new __compactRuntime.CompactError(`Contract state constructor: expected 'initialZswapLocalState' in argument 1 (as invoked from Typescript)`);
    }
    if (typeof(constructorContext_0.initialZswapLocalState) !== 'object') {
      throw new __compactRuntime.CompactError(`Contract state constructor: expected 'initialZswapLocalState' in argument 1 (as invoked from Typescript) to be an object`);
    }
    const state_0 = new __compactRuntime.ContractState();
    let stateValue_0 = __compactRuntime.StateValue.newArray();
    stateValue_0 = stateValue_0.arrayPush(__compactRuntime.StateValue.newNull());
    state_0.data = new __compactRuntime.ChargedState(stateValue_0);
    state_0.setOperation('prove_ownership', new __compactRuntime.ContractOperation());
    const context = __compactRuntime.createCircuitContext(__compactRuntime.dummyContractAddress(), constructorContext_0.initialZswapLocalState.coinPublicKey, state_0.data, constructorContext_0.initialPrivateState);
    const partialProofData = {
      input: { value: [], alignment: [] },
      output: undefined,
      publicTranscript: [],
      privateTranscriptOutputs: []
    };
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_8.toValue(0n),
                                                                                              alignment: _descriptor_8.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(new Uint8Array(32)),
                                                                                              alignment: _descriptor_0.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_8.toValue(0n),
                                                                                              alignment: _descriptor_8.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 111, 119, 110, 101, 114, 115, 104, 105, 112, 58, 118, 49, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])),
                                                                                              alignment: _descriptor_0.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    state_0.data = new __compactRuntime.ChargedState(context.currentQueryContext.state.state);
    return {
      currentContractState: state_0,
      currentPrivateState: context.currentPrivateState,
      currentZswapLocalState: context.currentZswapLocalState
    }
  }
  _persistentHash_0(value_0) {
    const result_0 = __compactRuntime.persistentHash(_descriptor_1, value_0);
    return result_0;
  }
  _persistentHash_1(value_0) {
    const result_0 = __compactRuntime.persistentHash(_descriptor_2, value_0);
    return result_0;
  }
  _ownershipCommitment_0(wallet_hash_0, agent_key_0, contract_hash_0, did_hash_0)
  {
    return this._persistentHash_0([new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 111, 119, 110, 101, 114, 115, 104, 105, 112, 58, 118, 49, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
                                   wallet_hash_0,
                                   agent_key_0,
                                   contract_hash_0,
                                   did_hash_0]);
  }
  _holderBindingCommitment_0(did_hash_0, challenge_hash_0, bundle_commitment_0)
  {
    return this._persistentHash_1([new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 104, 111, 108, 100, 101, 114, 45, 98, 105, 110, 100, 105, 110, 103, 58, 118, 49, 0, 0, 0, 0, 0, 0]),
                                   did_hash_0,
                                   challenge_hash_0,
                                   bundle_commitment_0]);
  }
  _prove_ownership_0(context,
                     partialProofData,
                     wallet_hash_0,
                     agent_key_0,
                     contract_hash_0,
                     did_hash_public_0,
                     challenge_hash_public_0,
                     bundle_commitment_public_0,
                     holder_binding_commitment_public_0)
  {
    __compactRuntime.assert(this._equal_0(_descriptor_0.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                    partialProofData,
                                                                                                    [
                                                                                                     { dup: { n: 0 } },
                                                                                                     { idx: { cached: false,
                                                                                                              pushPath: false,
                                                                                                              path: [
                                                                                                                     { tag: 'value',
                                                                                                                       value: { value: _descriptor_8.toValue(0n),
                                                                                                                                alignment: _descriptor_8.alignment() } }] } },
                                                                                                     { popeq: { cached: false,
                                                                                                                result: undefined } }]).value),
                                          new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 58, 111, 119, 110, 101, 114, 115, 104, 105, 112, 58, 118, 49, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])),
                            'Invalid proof domain');
    const did_hash_0 = did_hash_public_0;
    const challenge_hash_0 = challenge_hash_public_0;
    const bundle_commitment_0 = bundle_commitment_public_0;
    const holder_binding_commitment_0 = holder_binding_commitment_public_0;
    const computed_ownership_0 = this._ownershipCommitment_0(wallet_hash_0,
                                                             agent_key_0,
                                                             contract_hash_0,
                                                             did_hash_0);
    const computed_binding_0 = this._holderBindingCommitment_0(did_hash_0,
                                                               challenge_hash_0,
                                                               computed_ownership_0);
    __compactRuntime.assert(this._equal_1(computed_ownership_0,
                                          bundle_commitment_0),
                            'Ownership commitment mismatch');
    __compactRuntime.assert(this._equal_2(computed_binding_0,
                                          holder_binding_commitment_0),
                            'Holder binding mismatch');
    return [];
  }
  _equal_0(x0, y0) {
    if (!x0.every((x, i) => y0[i] === x)) { return false; }
    return true;
  }
  _equal_1(x0, y0) {
    if (!x0.every((x, i) => y0[i] === x)) { return false; }
    return true;
  }
  _equal_2(x0, y0) {
    if (!x0.every((x, i) => y0[i] === x)) { return false; }
    return true;
  }
}
export function ledger(stateOrChargedState) {
  const state = stateOrChargedState instanceof __compactRuntime.StateValue ? stateOrChargedState : stateOrChargedState.state;
  const chargedState = stateOrChargedState instanceof __compactRuntime.StateValue ? new __compactRuntime.ChargedState(stateOrChargedState) : stateOrChargedState;
  const context = {
    currentQueryContext: new __compactRuntime.QueryContext(chargedState, __compactRuntime.dummyContractAddress()),
    costModel: __compactRuntime.CostModel.initialCostModel()
  };
  const partialProofData = {
    input: { value: [], alignment: [] },
    output: undefined,
    publicTranscript: [],
    privateTranscriptOutputs: []
  };
  return {
    get proof_domain() {
      return _descriptor_0.fromValue(__compactRuntime.queryLedgerState(context,
                                                                       partialProofData,
                                                                       [
                                                                        { dup: { n: 0 } },
                                                                        { idx: { cached: false,
                                                                                 pushPath: false,
                                                                                 path: [
                                                                                        { tag: 'value',
                                                                                          value: { value: _descriptor_8.toValue(0n),
                                                                                                   alignment: _descriptor_8.alignment() } }] } },
                                                                        { popeq: { cached: false,
                                                                                   result: undefined } }]).value);
    }
  };
}
const _emptyContext = {
  currentQueryContext: new __compactRuntime.QueryContext(new __compactRuntime.ContractState().data, __compactRuntime.dummyContractAddress())
};
const _dummyContract = new Contract({ });
export const pureCircuits = {};
export const contractReferenceLocations =
  { tag: 'publicLedgerArray', indices: { } };
//# sourceMappingURL=index.js.map
