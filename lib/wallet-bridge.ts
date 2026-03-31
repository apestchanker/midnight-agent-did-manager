// Side-effect import: sets up wallet bridge if running in Sandpack iframe
import "./wallet-bridge-shim";
import type {
  ConnectedAPI,
  InitialAPI,
} from "@midnight-ntwrk/dapp-connector-api";
export type { ConnectedAPI, InitialAPI } from "@midnight-ntwrk/dapp-connector-api";

type WindowWithMidnight = Window & {
  midnight?: Record<string, unknown>;
};

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export function fromHex(hex: string): Uint8Array {
  const cleaned = hex.replace(/^0x/, "");
  return new Uint8Array(
    (cleaned.match(/.{1,2}/g) ?? []).map((b) => parseInt(b, 16)),
  );
}
function findWallets(): InitialAPI[] {
  if (typeof window === "undefined") return [];
  const midnight = (window as WindowWithMidnight).midnight;
  if (!midnight || typeof midnight !== "object") return [];
  const wallets: InitialAPI[] = [];
  for (const key of Object.keys(midnight)) {
    const c = midnight[key];
    if (
      c &&
      typeof c === "object" &&
      typeof c.name === "string" &&
      typeof c.icon === "string" &&
      typeof c.apiVersion === "string" &&
      typeof c.connect === "function"
    ) {
      wallets.push(c as InitialAPI);
    }
  }
  return wallets;
}
export async function detectWallets(): Promise<InitialAPI[]> {
  const immediate = findWallets();
  if (immediate.length > 0) return immediate;
  return new Promise((resolve) => {
    let attempts = 0;
    const id = setInterval(() => {
      const wallets = findWallets();
      if (wallets.length > 0) {
        clearInterval(id);
        resolve(wallets);
      } else if (++attempts >= 40) {
        clearInterval(id);
        resolve([]);
      }
    }, 500);
  });
}
export async function connectWallet(preferredWalletName?: string): Promise<{
  api: ConnectedAPI;
  config: Awaited<ReturnType<ConnectedAPI["getConfiguration"]>>;
  walletName: string;
}> {
  const wallets = await detectWallets();
  console.log(
    "[Wallet] Detected wallets:",
    wallets.map((w) => w.name),
  );
  if (wallets.length === 0)
    throw new Error(
      "No Midnight wallet detected. Install 1AM or Lace and refresh.",
    );
  const selected =
    (preferredWalletName
      ? wallets.find((w) => w.name === preferredWalletName)
      : undefined) ||
    wallets.find((w) => w.name === "1AM") ||
    wallets[0];
  console.log("[Wallet] Selected wallet:", selected.name);

  // Try configured network first, then fallback to others
  const networks = [
    import.meta.env.VITE_NETWORK_ID || "preview",
    "preview",
    "preprod",
    "mainnet",
  ].filter((v, i, a) => a.indexOf(v) === i); // Remove duplicates

  for (const net of networks) {
    try {
      console.log("[Wallet] Trying network:", net);
      const api = await Promise.race([
        selected.connect(net as never),
        new Promise<never>((_, rej) =>
          setTimeout(
            () => rej(new Error("Connection timeout after 15s")),
            15000,
          ),
        ),
      ]);
      const config = await api.getConfiguration();
      console.log("[Wallet] Connected on " + config.networkId, config);
      return { api, config, walletName: selected.name };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log("[Wallet] Network " + net + " failed:", msg);
      const match = msg.match(/[Ww]allet is on (\S+)/);
      if (match) {
        const walletNet = match[1].replace(/[,.]$/, "");
        console.log("[Wallet] Wallet is on:", walletNet);
        try {
          const api = await selected.connect(walletNet as never);
          const config = await api.getConfiguration();
          return { api, config, walletName: selected.name };
        } catch (e) {
          console.log("[Wallet] Failed to connect to wallet network:", e);
        }
      }
    }
  }
  throw new Error(
    "Could not connect to wallet. Tried networks: " +
      networks.join(", ") +
      `. Make sure ${selected.name} is unlocked and set to one of these networks.`,
  );
}
