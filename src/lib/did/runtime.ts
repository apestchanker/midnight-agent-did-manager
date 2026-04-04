import * as CompactCompiledContract from "@midnight-ntwrk/compact-js/effect/CompiledContract";
import { createWitnesses } from "./private-state";
import type { ManagedContractModule } from "./types";

let runtimePromise: Promise<{
  module: ManagedContractModule;
  compiledContract: unknown;
}> | null = null;

export async function loadManagedContractModule(): Promise<ManagedContractModule> {
  try {
    return (await import(
      "../../generated/didRegistryContract.runtime.js"
    )) as ManagedContractModule;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown import failure";
    throw new Error(
      `Managed contract runtime is missing under src/generated/didRegistryContract.runtime.js or could not be bundled by Vite. Run \`npm run compile-contract\`. Details: ${message}`,
    );
  }
}

export async function getContractRuntime(managedContractBasePath: string) {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const module = await loadManagedContractModule();
      const contractDefinition = CompactCompiledContract.make(
        "did-registry",
        module.Contract as never,
      ) as never;
      const contractWithWitnesses = CompactCompiledContract.withWitnesses(
        contractDefinition,
        createWitnesses() as never,
      ) as never;
      const compiledContract = CompactCompiledContract.withCompiledFileAssets(
        contractWithWitnesses,
        managedContractBasePath as never,
      ) as never;

      return { module, compiledContract };
    })();
  }

  return runtimePromise;
}

export function extractContractAddress(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    const fromSelf = extractContractAddress(objectValue.contractAddress);
    if (fromSelf) return fromSelf;
    const fromDeployTx = extractContractAddress(objectValue.deployTxData);
    if (fromDeployTx) return fromDeployTx;
    const fromPublic = extractContractAddress(objectValue.public);
    if (fromPublic) return fromPublic;
  }

  return "";
}

