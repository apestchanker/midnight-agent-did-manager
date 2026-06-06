# Meta: Wallet-Derived Owner Secret

## Identificacion
- **ID**: 002
- **Slug**: 002-wallet-derived-owner-secret
- **Tipo**: feature
- **Estado**: superseded

## Resumen
Reemplazaba el owner secret aleatorio persistido en el vault por un owner secret regenerable desde una firma de la wallet admin. El contrato seguia usando el patron Compact soportado de `witness issuerSecret()` + `persistentHash`.

## Superseded
El 2026-06-06 se probo en la app que la wallet conectada puede devolver firmas distintas para el mismo dominio exacto. Como el secret se derivaba de `sha256(signature)`, el esquema no es deterministico y no sirve como raiz persistente de ownership. Queda reemplazado por `003-stable-owner-vault-secret`.

## Stack detectado
- **Lenguaje**: TypeScript / JavaScript (ESM)
- **Framework**: Vite + React 18, Node.js HTTP
- **Contrato**: Compact `did_registry.compact`
- **Test runner**: vitest

## Git
- **Branch**: codex/wallet-derived-owner-secret
- **Base branch**: main

## Artefactos
- [x] 1-functional/spec.md
- [x] 2-technical/spec.md
- [x] 3-tasks/tasks.json
- [x] 4-implementation/progress.md
- [x] 5-verify/report.md

## Fechas
- **Creada**: 2026-06-01
- **Ultima actualizacion**: 2026-06-01
- **Completada**: 2026-06-01

## Nota MCP Midnight
Consulta MCP realizada el 2026-06-01:
- `midnight_search_docs`: no encontro patron oficial de verificacion directa de firma wallet dentro de circuitos Compact.
- `midnight_search_compact`: encontro patrones de `local_secret_key()` + `persistentHash` para identidad/autorizacion.
- `midnight_get_latest_syntax`: confirma explicitamente que `verify_signature` no existe como builtin; la verificacion/uso de firma debe realizarse off-chain/prover-side y el circuito debe recibir witnesses.
