# Technical Spec: Wallet-Derived Owner Secret

**Feature**: 002-wallet-derived-owner-secret
**Version**: 1.0
**Status**: Done
**Date**: 2026-06-01

## Architecture

```
[Admin wallet]
   signData("didMN:issuer-owner:v1:<networkId>:<deploymentSaltHex>")
        |
        v
[deriveOwnerSecretFromWalletSignature]
   sha256(signature bytes) -> issuerSecret
        |
        v
[deriveIssuerPublicKey(issuerSecret, issuer_nonce)]
        |
        +--> constructor arg / on-chain issuer_service
        +--> witness issuerSecret() for issue/update/revoke
```

The Compact contract still performs:

```compact
const issuer_secret = issuerSecret();
const issuer_key = issuerPublicKey(issuer_secret, issuer_nonce);
assert(issuer_key == issuer_service, "Unauthorized issuer");
```

## Decisions

### ADR-001: Keep Compact authorization pattern, change secret derivation

MCP Midnight syntax reference states `verify_signature` is not a Compact builtin and signature verification must happen off-chain. Therefore the contract keeps the witness-secret pattern. The DApp derives the witness secret from a wallet signature.

### ADR-002: Domain includes network and deployment salt

The signature domain is:

`didMN:issuer-owner:v1:<networkId>:<deploymentSaltHex>`

The salt prevents unrelated deployments on the same network from sharing an owner secret for the same wallet.

### ADR-003: Persist metadata, not secret

Normal private state stores:

- `ownerDerivation.scheme`
- `ownerDerivation.signDomain`
- `ownerDerivation.deploymentSaltHex`
- `issuerPublicKeyHex`
- `custodianWalletAddress`

It does not need `issuerSecret` after transaction construction.

### ADR-004: Backward compatibility with random-secret vaults

`hasIssuerSecret()` still accepts legacy private state. New backup export strips the secret before serialization.

## Implementation Touchpoints

- `src/lib/did/commitments.ts`: owner domain and signature hashing helpers.
- `src/lib/did/private-state.ts`: wallet-derived owner state construction and metadata stripping.
- `src/lib/did/vault.ts`: regenerate owner secret, validate on-chain match, backup/restore metadata.
- `src/lib/did/api.ts`: deploy and owner-only operations persist metadata after using the witness.
- `README.md` and UI copy: explain wallet-derived authority.

## Security Notes

The risk moves from "anyone with localStorage/backup secret controls the contract" to "anyone controlling or tricking the owner wallet into signing the exact owner domain can derive the witness secret." This is aligned with wallet custody expectations but still requires domain clarity and wallet hygiene.
