import { Buffer } from "buffer";
import { gcm } from "@noble/ciphers/aes.js";
import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, randomBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { Level } from "level";
import * as superjson from "superjson";
import type { ContractAddress, SigningKey } from "@midnight-ntwrk/compact-runtime";
import type { PrivateStateProvider } from "@midnight-ntwrk/midnight-js-types";

type PasswordProvider = () => Promise<string> | string;

type BrowserLevelPrivateStateProviderConfig = {
  accountId: string;
  midnightDbName?: string;
  privateStateStoreName?: string;
  signingKeyStoreName?: string;
  privateStoragePasswordProvider: PasswordProvider;
};

type CacheEntry = {
  encryption: StorageEncryption;
  saltHex: string;
};

const DEFAULT_CONFIG = {
  midnightDbName: "midnight-level-db",
  privateStateStoreName: "private-states",
  signingKeyStoreName: "signing-keys",
} as const;

const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const PBKDF2_ITERATIONS = 600000;
const ENCRYPTION_VERSION = 2;
const VERSION_PREFIX_LENGTH = 1;
const HEADER_LENGTH =
  VERSION_PREFIX_LENGTH + SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH;
const METADATA_KEY = "__midnight_encryption_metadata__";
const ACCOUNT_ID_HASH_LENGTH = 32;
const MIN_PASSWORD_LENGTH = 16;

const encryptionInitPromises = new Map<string, Promise<Buffer>>();
const encryptionCache = new Map<string, CacheEntry>();

superjson.registerCustom(
  {
    isApplicable: (value): value is Buffer => value instanceof Buffer,
    serialize: (value) => value.toString("hex"),
    deserialize: (value) => Buffer.from(value, "hex"),
  },
  "buffer",
);

function validatePassword(password: string): void {
  if (!password) {
    throw new Error(
      "privateStoragePasswordProvider must return a password for private state encryption.",
    );
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `Private state password must be at least ${MIN_PASSWORD_LENGTH} characters long.`,
    );
  }
}

async function getPasswordFromProvider(provider: PasswordProvider): Promise<string> {
  const password = await provider();
  validatePassword(password);
  return password;
}

function hashAccountId(accountId: string): string {
  return bytesToHex(sha256(utf8ToBytes(accountId))).slice(0, ACCOUNT_ID_HASH_LENGTH);
}

function getScopedLevelName(baseLevelName: string, accountId: string): string {
  return `${baseLevelName}:${hashAccountId(accountId)}`;
}

async function withSubLevel<T>(
  dbName: string,
  levelName: string,
  thunk: (subLevel: any) => Promise<T>,
): Promise<T> {
  const level = new Level(dbName, { createIfMissing: true });
  const subLevel = level.sublevel(levelName, { valueEncoding: "utf-8" });
  try {
    await level.open();
    await subLevel.open();
    return await thunk(subLevel);
  } finally {
    await subLevel.close();
    await level.close();
  }
}

function hashPassword(password: string): string {
  return bytesToHex(sha256(utf8ToBytes(password)));
}

function toBytes(value: Uint8Array | Buffer): Uint8Array {
  return Uint8Array.from(value);
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function constantTimeBufferEqual(aBuf: Uint8Array, bBuf: Uint8Array): boolean {
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < aBuf.length; i += 1) {
    result |= aBuf[i] ^ bBuf[i];
  }
  return result === 0;
}

function extractEncryptedComponents(data: Buffer) {
  if (data.length < HEADER_LENGTH) {
    throw new Error("Invalid encrypted data: too short");
  }
  const version = data[0] as number;
  if (version !== ENCRYPTION_VERSION) {
    throw new Error(`Unsupported encryption version: ${version}`);
  }
  return {
    salt: data.subarray(VERSION_PREFIX_LENGTH, VERSION_PREFIX_LENGTH + SALT_LENGTH),
    iv: data.subarray(
      VERSION_PREFIX_LENGTH + SALT_LENGTH,
      VERSION_PREFIX_LENGTH + SALT_LENGTH + IV_LENGTH,
    ),
    authTag: data.subarray(
      VERSION_PREFIX_LENGTH + SALT_LENGTH + IV_LENGTH,
      VERSION_PREFIX_LENGTH + SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH,
    ),
    encrypted: data.subarray(HEADER_LENGTH),
  };
}

class StorageEncryption {
  private readonly encryptionKey: Buffer;
  private readonly salt: Buffer;
  private readonly passwordHash: string;

  constructor(password: string, existingSalt?: Buffer) {
    this.salt = existingSalt ?? Buffer.from(randomBytes(SALT_LENGTH));
    this.encryptionKey = this.deriveKey(password, this.salt);
    this.passwordHash = hashPassword(password);
  }

  private deriveKey(password: string, salt: Buffer): Buffer {
    return Buffer.from(
      pbkdf2(sha256, utf8ToBytes(password), toBytes(salt), {
        c: PBKDF2_ITERATIONS,
        dkLen: KEY_LENGTH,
      }),
    );
  }

  verifyPassword(password: string): boolean {
    const inputHash = Buffer.from(hashPassword(password), "hex");
    const storedHash = Buffer.from(this.passwordHash, "hex");
    return constantTimeBufferEqual(toBytes(inputHash), toBytes(storedHash));
  }

  encrypt(data: string): string {
    const plaintext = Buffer.from(data, "utf-8");
    const iv = Buffer.from(randomBytes(IV_LENGTH));
    const encryptedWithTag = Buffer.from(
      gcm(toBytes(this.encryptionKey), toBytes(iv)).encrypt(toBytes(plaintext)),
    );
    const encrypted = encryptedWithTag.subarray(
      0,
      encryptedWithTag.length - AUTH_TAG_LENGTH,
    );
    const authTag = encryptedWithTag.subarray(
      encryptedWithTag.length - AUTH_TAG_LENGTH,
    );
    const payload = concatBytes(
      new Uint8Array([ENCRYPTION_VERSION]),
      toBytes(this.salt),
      toBytes(iv),
      toBytes(authTag),
      toBytes(encrypted),
    );
    return Buffer.from(payload).toString(
      "base64",
    );
  }

  decrypt(encryptedData: string): string {
    const data = Buffer.from(encryptedData, "base64");
    const { salt, iv, authTag, encrypted } = extractEncryptedComponents(data);
    if (!constantTimeBufferEqual(toBytes(this.salt), toBytes(salt))) {
      throw new Error("Salt mismatch: data was encrypted with a different password");
    }
    const ciphertext = concatBytes(toBytes(encrypted), toBytes(authTag));
    const decrypted = Buffer.from(
      gcm(toBytes(this.encryptionKey), toBytes(iv)).decrypt(
        ciphertext,
      ),
    );
    return decrypted.toString("utf-8");
  }

  getSalt(): Buffer {
    return this.salt;
  }
}

async function getOrCreateSalt(dbName: string, levelName: string): Promise<Buffer> {
  const lockKey = `${dbName}:${levelName}`;
  const existingPromise = encryptionInitPromises.get(lockKey);
  if (existingPromise) {
    return existingPromise;
  }

  const initPromise = withSubLevel(dbName, levelName, async (subLevel) => {
    try {
      const metadataJson = (await subLevel.get(METADATA_KEY)) as string | undefined;
      if (metadataJson) {
        const metadata = JSON.parse(metadataJson) as { salt?: string };
        if (metadata.salt) {
          return Buffer.from(metadata.salt, "hex");
        }
      }
    } catch (error) {
      if (
        !(
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "LEVEL_NOT_FOUND"
        )
      ) {
        throw error;
      }
    }

    const salt = Buffer.from(randomBytes(SALT_LENGTH));
    await subLevel.put(
      METADATA_KEY,
      JSON.stringify({
        salt: salt.toString("hex"),
        version: ENCRYPTION_VERSION,
      }),
    );
    return salt;
  });

  encryptionInitPromises.set(lockKey, initPromise);
  try {
    return await initPromise;
  } finally {
    encryptionInitPromises.delete(lockKey);
  }
}

async function getOrCreateEncryption(
  dbName: string,
  levelName: string,
  passwordProvider: PasswordProvider,
): Promise<StorageEncryption> {
  const cacheKey = `${dbName}:${levelName}`;
  const salt = await getOrCreateSalt(dbName, levelName);
  const saltHex = salt.toString("hex");
  const cached = encryptionCache.get(cacheKey);
  const password = await getPasswordFromProvider(passwordProvider);

  if (cached && cached.saltHex === saltHex && cached.encryption.verifyPassword(password)) {
    return cached.encryption;
  }

  const encryption = new StorageEncryption(password, salt);
  encryptionCache.set(cacheKey, { encryption, saltHex });
  return encryption;
}

async function subLevelMaybeGet<T>(
  dbName: string,
  levelName: string,
  key: string,
  passwordProvider: PasswordProvider,
): Promise<T | null> {
  const encryption = await getOrCreateEncryption(dbName, levelName, passwordProvider);
  return withSubLevel(dbName, levelName, async (subLevel) => {
    try {
      const encryptedValue = (await subLevel.get(key)) as string | undefined;
      if (encryptedValue === undefined) {
        return null;
      }
      const decryptedValue = encryption.decrypt(encryptedValue);
      const value = superjson.parse<T>(decryptedValue);
      return value === undefined ? null : value;
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "LEVEL_NOT_FOUND"
      ) {
        return null;
      }
      throw error;
    }
  });
}

export function createPatchedSdkPrivateStateProvider(
  config: BrowserLevelPrivateStateProviderConfig,
): PrivateStateProvider {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };

  if (!config.accountId.trim()) {
    throw new Error("accountId is required for patched SDK private state.");
  }

  const scopedPrivateStateLevelName = getScopedLevelName(
    fullConfig.privateStateStoreName,
    config.accountId,
  );
  const scopedSigningKeyLevelName = getScopedLevelName(
    fullConfig.signingKeyStoreName,
    config.accountId,
  );
  const passwordProvider = config.privateStoragePasswordProvider;

  let contractAddress: ContractAddress | null = null;

  const getScopedKey = (privateStateId: string): string => {
    if (contractAddress === null) {
      throw new Error(
        "Contract address not set. Call setContractAddress() before accessing private state.",
      );
    }
    return `${contractAddress}:${privateStateId}`;
  };

  return {
    setContractAddress(address: ContractAddress): void {
      contractAddress = address;
    },
    async get(privateStateId: string) {
      return subLevelMaybeGet(
        fullConfig.midnightDbName,
        scopedPrivateStateLevelName,
        getScopedKey(privateStateId),
        passwordProvider,
      );
    },
    async remove(privateStateId: string) {
      return withSubLevel(
        fullConfig.midnightDbName,
        scopedPrivateStateLevelName,
        (subLevel) => subLevel.del(getScopedKey(privateStateId)),
      );
    },
    async set(privateStateId: string, state: unknown) {
      const encryption = await getOrCreateEncryption(
        fullConfig.midnightDbName,
        scopedPrivateStateLevelName,
        passwordProvider,
      );
      const encrypted = encryption.encrypt(superjson.stringify(state));
      return withSubLevel(
        fullConfig.midnightDbName,
        scopedPrivateStateLevelName,
        (subLevel) => subLevel.put(getScopedKey(privateStateId), encrypted),
      );
    },
    async clear() {
      if (contractAddress === null) {
        throw new Error(
          "Contract address not set. Call setContractAddress() before accessing private state.",
        );
      }
      const prefix = `${contractAddress}:`;
      await withSubLevel(
        fullConfig.midnightDbName,
        scopedPrivateStateLevelName,
        async (subLevel) => {
          const keys: string[] = [];
          for await (const [key] of subLevel.iterator()) {
            const resolvedKey = String(key);
            if (resolvedKey !== METADATA_KEY && resolvedKey.startsWith(prefix)) {
              keys.push(resolvedKey);
            }
          }
          if (keys.length > 0) {
            await subLevel.batch(keys.map((key) => ({ type: "del", key })));
          }
        },
      );
    },
    async getSigningKey(address: ContractAddress) {
      return subLevelMaybeGet<SigningKey>(
        fullConfig.midnightDbName,
        scopedSigningKeyLevelName,
        address,
        passwordProvider,
      );
    },
    async setSigningKey(address: ContractAddress, signingKey: SigningKey) {
      const encryption = await getOrCreateEncryption(
        fullConfig.midnightDbName,
        scopedSigningKeyLevelName,
        passwordProvider,
      );
      const encrypted = encryption.encrypt(superjson.stringify(signingKey));
      return withSubLevel(
        fullConfig.midnightDbName,
        scopedSigningKeyLevelName,
        (subLevel) => subLevel.put(address, encrypted),
      );
    },
    async removeSigningKey(address: ContractAddress) {
      return withSubLevel(
        fullConfig.midnightDbName,
        scopedSigningKeyLevelName,
        (subLevel) => subLevel.del(address),
      );
    },
    async clearSigningKeys() {
      return withSubLevel(
        fullConfig.midnightDbName,
        scopedSigningKeyLevelName,
        async (subLevel) => {
          const keys: string[] = [];
          for await (const [key] of subLevel.iterator()) {
            const resolvedKey = String(key);
            if (resolvedKey !== METADATA_KEY) {
              keys.push(resolvedKey);
            }
          }
          if (keys.length > 0) {
            await subLevel.batch(keys.map((key) => ({ type: "del", key })));
          }
        },
      );
    },
  } as PrivateStateProvider;
}
