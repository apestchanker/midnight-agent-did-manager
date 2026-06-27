import * as CompactCompiledContract from "@midnight-ntwrk/compact-js/effect/CompiledContract";
import { deployContract } from "@midnight-ntwrk/midnight-js-contracts";
import type { AppProviders } from "../../../lib/providers";
import { extractContractAddress } from "../did/runtime";

const TOKEN_GATING_CONTRACT_BASE_PATH = "/contracts/managed/token-gating";

async function loadTokenGatingModule() {
  try {
    return await import("../../generated/token-gating/contract/index.js");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown import failure";
    throw new Error(
      `Token gating contract runtime is missing under src/generated/token-gating/contract/index.js or could not be bundled by Vite. Run \`npm run compile-contract\`. Details: ${message}`,
    );
  }
}

export class TokenGatingAPI {
  readonly contractAddress: string;

  private constructor(contractAddress: string) {
    this.contractAddress = contractAddress;
  }

  static async deploy(providers: AppProviders): Promise<TokenGatingAPI> {
    const module = await loadTokenGatingModule();
    const contractDefinition = CompactCompiledContract.withVacantWitnesses(
      CompactCompiledContract.make("token-gating", module.Contract as never),
    ) as never;
    const compiledContract = CompactCompiledContract.withCompiledFileAssets(
      contractDefinition,
      TOKEN_GATING_CONTRACT_BASE_PATH as never,
    ) as never;

    const deployed = await deployContract(providers as never, {
      compiledContract,
      args: [],
    });

    const contractAddress = extractContractAddress(deployed);
    if (!contractAddress) {
      throw new Error(
        "Token gating deployment succeeded but the contract address could not be derived from the Midnight SDK response.",
      );
    }

    return new TokenGatingAPI(contractAddress);
  }
}
