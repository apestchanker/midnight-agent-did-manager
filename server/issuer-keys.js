import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { exportJWK, generateKeyPair, importJWK } from "jose";

const ISSUER_ID =
  process.env.DID_SERVICE_ISSUER_ID ||
  "https://agent-registry.local/issuers/default";
const KEYS_PATH = resolve(process.cwd(), "data", "issuer-ed25519.jwk.json");

function ensureDir(path) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export async function getIssuerKeys() {
  ensureDir(KEYS_PATH);

  if (!existsSync(KEYS_PATH)) {
    const { publicKey, privateKey } = await generateKeyPair("EdDSA", {
      extractable: true,
    });
    const publicJwk = await exportJWK(publicKey);
    const privateJwk = await exportJWK(privateKey);
    publicJwk.kid = `${ISSUER_ID}#keys-1`;
    privateJwk.kid = `${ISSUER_ID}#keys-1`;
    writeFileSync(
      KEYS_PATH,
      JSON.stringify(
        {
          issuerId: ISSUER_ID,
          publicJwk,
          privateJwk,
        },
        null,
        2,
      ),
    );
  }

  const raw = JSON.parse(readFileSync(KEYS_PATH, "utf8"));
  const privateKey = await importJWK(raw.privateJwk, "EdDSA");
  const publicKey = await importJWK(raw.publicJwk, "EdDSA");

  return {
    issuerId: raw.issuerId || ISSUER_ID,
    publicJwk: raw.publicJwk,
    privateJwk: raw.privateJwk,
    publicKey,
    privateKey,
  };
}
