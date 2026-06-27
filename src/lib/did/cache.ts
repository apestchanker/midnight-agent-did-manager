import type { CachedDidMetadata, SavedCompileArtifact, SavedDeployment, SavedTokenDeployment } from "./types";
import { COMPILE_KEY, DEPLOY_KEY, DID_CACHE_PREFIX, TOKEN_GATING_DEPLOY_KEY } from "./types";

function cacheKey(contractAddress: string, agentId: string): string {
  return `${DID_CACHE_PREFIX}:${contractAddress}:${agentId.toLowerCase()}`;
}

export function saveCompileArtifact(data: SavedCompileArtifact): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(COMPILE_KEY, JSON.stringify(data));
}

export function saveDeployment(result: SavedDeployment): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DEPLOY_KEY, JSON.stringify(result));
}

export function saveDidMetadata(metadata: CachedDidMetadata): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    cacheKey(metadata.contractAddress, metadata.agentId),
    JSON.stringify(metadata),
  );
}

export function getDidMetadata(
  contractAddress: string,
  agentId: string,
): CachedDidMetadata | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(cacheKey(contractAddress, agentId));
  if (!raw) return null;

  try {
    return JSON.parse(raw) as CachedDidMetadata;
  } catch {
    return null;
  }
}

export function readSavedJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function mergeDidMetadata(
  contractAddress: string,
  agentId: string,
  patch: Partial<CachedDidMetadata>,
): CachedDidMetadata {
  const existing = getDidMetadata(contractAddress, agentId);
  const merged: CachedDidMetadata = {
    contractAddress,
    agentId,
    createdAt: existing?.createdAt || new Date().toISOString(),
    ...existing,
    ...patch,
  };
  saveDidMetadata(merged);
  return merged;
}

export function getSavedContractAddress(): string {
  return getSavedDeployment()?.contractAddress || "";
}

export function getSavedDeployment(): SavedDeployment | null {
  return readSavedJson<SavedDeployment>(DEPLOY_KEY);
}

export function getSavedCompileArtifact(): SavedCompileArtifact | null {
  return readSavedJson<SavedCompileArtifact>(COMPILE_KEY);
}

export function saveTokenDeployment(result: SavedTokenDeployment): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TOKEN_GATING_DEPLOY_KEY, JSON.stringify(result));
}

export function getSavedTokenDeployment(): SavedTokenDeployment | null {
  return readSavedJson<SavedTokenDeployment>(TOKEN_GATING_DEPLOY_KEY);
}

export function clearTokenDeployment(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_GATING_DEPLOY_KEY);
}
