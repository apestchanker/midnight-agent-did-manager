import type { CachedDidMetadata, SavedCompileArtifact, SavedDeployment } from "./types";
import { COMPILE_KEY, DEPLOY_KEY, DID_CACHE_PREFIX } from "./types";

function cacheKey(contractAddress: string, agentAddress: string): string {
  return `${DID_CACHE_PREFIX}:${contractAddress}:${agentAddress.toLowerCase()}`;
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
    cacheKey(metadata.contractAddress, metadata.agentAddress),
    JSON.stringify(metadata),
  );
}

export function getDidMetadata(
  contractAddress: string,
  agentAddress: string,
): CachedDidMetadata | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(cacheKey(contractAddress, agentAddress));
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
  agentAddress: string,
  patch: Partial<CachedDidMetadata>,
): CachedDidMetadata {
  const existing = getDidMetadata(contractAddress, agentAddress);
  const merged: CachedDidMetadata = {
    contractAddress,
    agentAddress,
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

