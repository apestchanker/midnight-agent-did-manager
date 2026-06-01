# Implementation Progress

**Feature**: 002-wallet-derived-owner-secret
**Date**: 2026-06-01
**Status**: Done

## Completed

- Queried Midnight MCP for in-circuit signature verification support.
- Implemented wallet-signature-derived owner secret.
- Added deployment salt and domain-separated owner signing domain.
- Changed owner private state persistence to store derivation metadata in normal flow.
- Updated owner-only transaction flow to regenerate secret with `wallet.signData`.
- Updated encrypted backup/restore to work with derivation metadata.
- Preserved legacy support for vaults that still contain `issuerSecret`.
- Updated UI copy and README.
- Added focused tests for owner domain, deterministic signature hashing, and metadata serialization.
- Bumped app minor version to `0.6.0`.

## Files Changed

- `src/lib/did/commitments.ts`
- `src/lib/did/private-state.ts`
- `src/lib/did/vault.ts`
- `src/lib/did/api.ts`
- `src/lib/did/app-api.ts`
- `src/lib/did/types.ts`
- `src/types/did.ts`
- `src/components/DeployPanel.tsx`
- `src/components/IssuerPanel.tsx`
- `src/components/OwnerVaultPanel.tsx`
- `tests/did-commitments.test.ts`
- `README.md`
- `package.json`
- `package-lock.json`
