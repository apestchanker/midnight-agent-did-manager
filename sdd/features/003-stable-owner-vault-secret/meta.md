# Meta: Stable Owner Vault Secret

## Identificacion
- **ID**: 003
- **Slug**: 003-stable-owner-vault-secret
- **Tipo**: corrective-design
- **Estado**: implemented

## Resumen
Corrige el diseno `wallet-derived-owner-secret`. La wallet conectada puede producir firmas distintas para el mismo mensaje, por lo que `sha256(wallet.signData(domain).signature)` no es una raiz deterministica de ownership. El registry owner vuelve a ser un secreto aleatorio estable guardado en Midnight private state local y exportado dentro de un Owner Vault backup cifrado.

## Decision
- El contrato Compact sigue usando `witness issuerSecret()` y `persistentHash`.
- On-chain solo se guarda el public authorization key derivado.
- El secreto no se guarda en Postgres ni on-chain.
- El secreto si debe persistir en local Midnight private state para poder ejecutar `issue/update/revoke`.
- La portabilidad depende de exportar/restaurar el Owner Vault backup cifrado.
- La wallet sigue siendo necesaria para conectar/submeter transacciones, pero no se usa como KDF deterministica del issuer secret.

## Evidencia
Prueba ejecutada en UI el 2026-06-06:
- mismo dominio `didMN:issuer-owner:v1:preview:<salt>`
- `Same signature: false`
- `Same derived secret: false`

## Fechas
- **Creada**: 2026-06-06
- **Implementada**: 2026-06-06
