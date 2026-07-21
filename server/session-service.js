import crypto from "crypto";
import { TextEncoder } from "util";
import { addressFromKey, verifySignature } from "@midnight-ntwrk/ledger-v8";
import { query, withTransaction } from "./db.js";
import {
  encodeDerivedWalletAddress,
  normalizeWallet,
  normalizeWalletSignatureHex,
  sha256Hex,
} from "./utils.js";
import { canonicalize } from "../lib/canonical-json.js";

const DEFAULT_NONCE_TTL_SECONDS = 300;
const DEFAULT_SESSION_TTL_SECONDS = 1800;

/**
 * Typed error thrown by createSessionFromSignature (and, going forward, any
 * other session-service failure) with a stable machine-checkable `code` and
 * a suggested `statusCode`. Mirrors the existing RequestBodyError pattern in
 * server/utils.js. The HTTP layer (requireSession / the /api/auth/* route
 * handlers, wired in later tasks) is what actually decides the response —
 * this class just carries enough metadata for that mapping.
 */
export class AuthError extends Error {
  constructor(message, { code, statusCode = 401 } = {}) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

// Loose structural check for a Bech32m-style Midnight wallet address
// ("mn_<hrp>1<data>"), matching the shape used throughout this codebase
// (e.g. "mn_addr_preprod1...", "mn_shield-addr_preprod1..."). This is not a
// full Bech32m checksum validation — REQ-01 Scenario 02 only requires
// rejecting requests that are not well-formed wallet addresses before any
// nonce is persisted; the real proof of ownership happens later, in
// createSessionFromSignature, via signature verification.
const WALLET_ADDRESS_PATTERN = /^mn_[a-z0-9_-]+1[a-z0-9]+$/i;

function nonceTtlSeconds() {
  const configured = Number(process.env.DID_AUTH_NONCE_TTL_SECONDS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_NONCE_TTL_SECONDS;
}

function sessionTtlSeconds() {
  const configured = Number(process.env.DID_SESSION_TTL_SECONDS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_SESSION_TTL_SECONDS;
}

// Code review follow-up (feature 007, post-verify): the derived-address
// Bech32m encoding below was always defaulting to encodeDerivedWalletAddress's
// own hardcoded "preprod" fallback because no networkId was ever passed
// in — there was no server-side env var for it at all (only the client-side
// VITE_NETWORK_ID existed). DID_NETWORK_ID makes this explicitly
// configurable per deploy while keeping "preprod" as the fallback when the
// env var is unset, matching the previous default behavior.
function networkId() {
  const configured = String(process.env.DID_NETWORK_ID || "").trim();
  return configured || "preprod";
}

function isWellFormedWalletAddress(value) {
  return WALLET_ADDRESS_PATTERN.test(value);
}

/**
 * Compute admin status fresh, per ADR-004: never stored on the session row,
 * always compared against the current DID_ADMIN_WALLET_ADDRESS env var so a
 * rotated admin config takes effect immediately for existing sessions. If
 * DID_ADMIN_WALLET_ADDRESS is unset/empty, no session is ever admin
 * (fail-closed).
 */
function computeIsAdmin(walletAddress) {
  const adminWallet = process.env.DID_ADMIN_WALLET_ADDRESS;
  if (!adminWallet || !String(adminWallet).trim()) {
    return false;
  }
  return normalizeWallet(walletAddress) === normalizeWallet(adminWallet);
}

/**
 * Issue a one-time login challenge (nonce) for a declared wallet address.
 * Throws before any row is persisted if walletAddress is empty or not a
 * well-formed wallet address (REQ-01 Scenario 02).
 *
 * @param {string} walletAddress
 * @returns {Promise<{ challenge: string, nonce: string, expiresAt: string }>}
 */
export async function issueNonce(walletAddress) {
  const normalizedWallet = normalizeWallet(walletAddress);
  if (!normalizedWallet || !isWellFormedWalletAddress(normalizedWallet)) {
    // Typed (not a bare Error) so the HTTP layer in server/index.js can tell
    // this *expected* validation failure apart from an *unexpected* failure
    // (e.g. a DB error out of the `query()` call below) and only redact the
    // latter. See the catch block around issueNonce() in server/index.js.
    throw new AuthError("A well-formed wallet address is required to request a challenge.", {
      code: "invalid_wallet_address",
      statusCode: 400,
    });
  }

  const nonce = crypto.randomUUID();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + nonceTtlSeconds() * 1000);

  // Domain-separated challenge envelope (ADR-003): distinct type/purpose
  // and field set from buildApprovalPayload's proof-approval payload, so a
  // login signature can never be replayed as a proof-approval signature or
  // vice versa.
  const challenge = canonicalize({
    type: "midnight-did:auth-challenge",
    purpose: "wallet-session-login",
    walletAddress: normalizedWallet,
    nonce,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    domain: process.env.DID_AUTH_DOMAIN || "",
  });

  await query(
    `insert into auth_nonces (nonce, wallet_address, challenge, expires_at)
     values ($1, $2, $3, $4)`,
    [nonce, normalizedWallet, challenge, expiresAt.toISOString()],
  );

  return { challenge, nonce, expiresAt: expiresAt.toISOString() };
}

/**
 * Exchange a signature over a previously issued challenge for a session
 * (REQ-02). Verification order follows the technical spec's Data flow /
 * Error Handling sections exactly:
 *   1. parse signature.data as the challenge string and recover its
 *      embedded nonce; look up the auth_nonces row -> invalid_nonce
 *   2. nonce already consumed -> nonce_already_used (409)
 *   3. nonce expired (unconsumed) -> nonce_expired
 *   4. verifySignature over the exact challenge bytes -> invalid_signature
 *   5. addressFromKey(verifyingKey) must equal the wallet address declared
 *      at nonce-issuance time -> wallet_address_mismatch
 *   6. atomically mark the nonce consumed (closes the concurrent-replay
 *      race — this is the only step that can still race condition 2)
 *   7. mint an opaque session token, store its hash
 *
 * @param {{ signature: { data: string, signature: string, verifyingKey: string } }} input
 * @param {{ verifySignature?: Function, addressFromKey?: Function }} deps
 * @returns {Promise<{ token: string, walletAddress: string, isAdmin: boolean, expiresAt: string }>}
 */
export async function createSessionFromSignature(input, deps = {}) {
  const verifySignatureFn = deps.verifySignature || verifySignature;
  const addressFromKeyFn = deps.addressFromKey || addressFromKey;

  const signatureEnvelope = input?.signature;
  if (!signatureEnvelope || typeof signatureEnvelope !== "object") {
    throw new AuthError("A wallet signature is required to exchange a challenge for a session.", {
      code: "invalid_nonce",
    });
  }

  const data = String(signatureEnvelope.data || "");
  let parsedChallenge = null;
  try {
    parsedChallenge = JSON.parse(data);
  } catch {
    parsedChallenge = null;
  }
  const nonce =
    parsedChallenge && typeof parsedChallenge === "object" && parsedChallenge.nonce
      ? String(parsedChallenge.nonce)
      : "";
  if (!nonce) {
    throw new AuthError("Challenge could not be parsed or has no embedded nonce.", {
      code: "invalid_nonce",
    });
  }

  const nonceRowResult = await query(`select * from auth_nonces where nonce = $1 limit 1`, [
    nonce,
  ]);
  const nonceRow = nonceRowResult.rows[0];
  // The server never trusts a client-supplied challenge on its own (ADR-003)
  // — it must match the exact canonical string stored at issuance time.
  if (!nonceRow || nonceRow.challenge !== data) {
    throw new AuthError("Challenge is unknown or does not match a previously issued nonce.", {
      code: "invalid_nonce",
    });
  }

  if (nonceRow.consumed_at) {
    throw new AuthError("This challenge has already been exchanged for a session.", {
      code: "nonce_already_used",
      statusCode: 409,
    });
  }

  if (!nonceRow.expires_at || new Date(nonceRow.expires_at).getTime() <= Date.now()) {
    throw new AuthError("Challenge has expired.", { code: "nonce_expired" });
  }

  const normalizedSignature = normalizeWalletSignatureHex(
    String(signatureEnvelope.signature || ""),
    2,
  );
  const normalizedVerifyingKeyForCrypto = normalizeWalletSignatureHex(
    String(signatureEnvelope.verifyingKey || ""),
  );

  let verified = false;
  try {
    verified = verifySignatureFn(
      normalizedVerifyingKeyForCrypto,
      new TextEncoder().encode(data),
      normalizedSignature,
    );
  } catch {
    verified = false;
  }
  if (!verified) {
    throw new AuthError("Wallet signature verification failed.", { code: "invalid_signature" });
  }

  let derivedAddress = "";
  try {
    const rawDerivedAddress = addressFromKeyFn(normalizedVerifyingKeyForCrypto);
    derivedAddress = normalizeWallet(encodeDerivedWalletAddress(rawDerivedAddress, networkId()));
  } catch {
    derivedAddress = "";
  }

  const declaredWallet = normalizeWallet(nonceRow.wallet_address);
  if (!derivedAddress || derivedAddress !== declaredWallet) {
    throw new AuthError(
      "The signing wallet does not match the wallet declared when the challenge was requested.",
      { code: "wallet_address_mismatch" },
    );
  }

  const { token, expiresAt } = await withTransaction(async (client) => {
    // Atomic single-use transition: the only step, besides the earlier
    // read-only consumed_at check, that can still observe a race between
    // two concurrent exchanges of the same nonce.
    const consumed = await client.query(
      `update auth_nonces
       set consumed_at = now()
       where nonce = $1 and consumed_at is null
       returning *`,
      [nonce],
    );
    if (!consumed.rows[0]) {
      throw new AuthError("This challenge has already been exchanged for a session.", {
        code: "nonce_already_used",
        statusCode: 409,
      });
    }

    const newToken = crypto.randomBytes(32).toString("hex");
    const issuedAt = new Date();
    const newExpiresAt = new Date(issuedAt.getTime() + sessionTtlSeconds() * 1000);

    await client.query(
      `insert into auth_sessions (token_hash, wallet_address, expires_at)
       values ($1, $2, $3)`,
      [sha256Hex(newToken), declaredWallet, newExpiresAt.toISOString()],
    );

    return { token: newToken, expiresAt: newExpiresAt.toISOString() };
  });

  return {
    token,
    walletAddress: declaredWallet,
    isAdmin: computeIsAdmin(declaredWallet),
    expiresAt,
  };
}

/**
 * Validate an opaque session token. Never throws — returns null for any
 * missing/unknown/expired/revoked/malformed token so the HTTP layer decides
 * how to respond.
 *
 * @param {string} token
 * @returns {Promise<{ walletAddress: string, isAdmin: boolean } | null>}
 */
export async function validateSession(token) {
  const raw = String(token || "").trim();
  if (!raw) {
    return null;
  }

  const tokenHash = sha256Hex(raw);
  const result = await query(
    `select * from auth_sessions where token_hash = $1 limit 1`,
    [tokenHash],
  );
  const session = result.rows[0];
  if (!session) {
    return null;
  }
  if (session.revoked_at) {
    return null;
  }
  if (!session.expires_at || new Date(session.expires_at).getTime() <= Date.now()) {
    return null;
  }

  try {
    await query(`update auth_sessions set last_used_at = now() where id = $1`, [session.id]);
  } catch {
    // best-effort — mirrors mcp_keys.last_used_at semantics, never blocks validation
  }

  return {
    walletAddress: session.wallet_address,
    isAdmin: computeIsAdmin(session.wallet_address),
  };
}
