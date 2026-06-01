# Functional Spec: Wallet-Derived Owner Secret

**Feature**: 002-wallet-derived-owner-secret
**Version**: 1.0
**Status**: Done
**Date**: 2026-06-01

## Overview

The DID registry owner authority must no longer depend on a random 32-byte bearer secret persisted in browser private state. Instead, the DApp derives the issuer owner secret from a wallet signature over a domain-separated message:

`issuerSecret = sha256(wallet.signData("didMN:issuer-owner:v1:<networkId>:<deploymentSaltHex>").signature)`

The Compact contract remains unchanged: it stores the derived public authorization key on-chain and verifies privileged actions through `witness issuerSecret()`. The wallet becomes the operational root of control because the same wallet must sign the same domain to regenerate the secret.

## Requirements

### REQ-01: Wallet-derived owner secret on deploy

During DID registry deployment, the DApp MUST ask the connected wallet to sign a domain-separated owner message. The resulting signature hash MUST be used as the owner witness secret. The constructor MUST receive only the derived public authorization key.

### REQ-02: No raw owner secret persisted in normal flow

After deploy and after every owner-only action, the local private state MUST persist recoverable derivation metadata, not the raw `issuerSecret`.

### REQ-03: Owner-only actions regenerate the secret

Before `issue_did`, `update_did`, or `revoke_did`, the DApp MUST regenerate the owner secret by asking the connected wallet to sign the same stored domain metadata. If the regenerated public key does not match on-chain `issuer_service`, the action MUST fail before submitting the transaction.

### REQ-04: Encrypted backup stores derivation metadata

Owner Vault export MUST produce an encrypted backup of derivation metadata. Restore MUST validate network and contract address, regenerate the secret with the connected wallet, and verify it against on-chain authorization state.

### REQ-05: Legacy vault compatibility

Existing vaults containing `issuerSecret` MAY continue to work, but new exports SHOULD omit `issuerSecretHex`.

## Out of Scope

- In-circuit wallet signature verification. Midnight MCP confirmed Compact does not expose a `verify_signature` builtin.
- Contract-level rekey/owner rotation.
- Multisig or threshold wallet governance.
