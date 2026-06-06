# Stable Owner Vault Secret

## Functional Requirements

- Deploy MUST generate a random 32-byte owner secret.
- Deploy MUST derive the initial public authorization key from that secret and pass only that public key to the Compact constructor.
- Owner-only actions MUST load the same local secret from Midnight private state and supply it through `witness issuerSecret()`.
- Owner Vault export MUST encrypt and include the owner secret, because it cannot be regenerated from wallet signatures.
- Owner Vault restore MUST validate network, contract address, and on-chain public authorization key before storing restored private state.

## Security Notes

Wallet signatures are not a deterministic KDF in the observed wallet integration. A wallet signature may still be useful as a UX authorization or unlock signal, but it MUST NOT be the only source used to regenerate the Compact witness secret unless the wallet explicitly provides a deterministic signing/KDF guarantee.

Browser-backed private state is acceptable for this local development repo but is not production custody. Production should move owner secret custody to an encrypted vault, HSM, secure enclave, or equivalent controlled storage.
