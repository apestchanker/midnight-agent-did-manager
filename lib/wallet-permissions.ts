import type { ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";

export const REQUIRED_WALLET_PERMISSIONS = [
  "getConfiguration",
  "getShieldedAddresses",
  "getUnshieldedAddress",
  "getProvingProvider",
  "balanceUnsealedTransaction",
  "submitTransaction",
] as const;

export async function requestWalletPermissionsIfSupported(
  api: ConnectedAPI,
  permissions: readonly string[] = REQUIRED_WALLET_PERMISSIONS,
): Promise<void> {
  if (typeof (api as ConnectedAPI & { hintUsage?: unknown }).hintUsage !== "function") {
    return;
  }

  await (
    api as ConnectedAPI & {
      hintUsage: (requestedPermissions: readonly string[]) => Promise<unknown>;
    }
  ).hintUsage(permissions);
}
