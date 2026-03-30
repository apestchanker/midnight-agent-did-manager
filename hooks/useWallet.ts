import { useState, useEffect } from "react";
import {
  connectWallet,
  detectWallets,
  type ConnectedAPI,
} from "../lib/wallet-bridge";
import { buildProviders, type AppProviders } from "../lib/providers";
export function useWallet() {
  const [status, setStatus] = useState<
    "detecting" | "disconnected" | "connecting" | "connected"
  >("detecting");
  const [api, setApi] = useState<ConnectedAPI | null>(null);
  const [providers, setProviders] = useState<AppProviders | null>(null);
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    detectWallets().then((wallets) => {
      console.log(
        "[useWallet] Wallet detection complete, found:",
        wallets.length,
        "wallet(s)",
      );
      setStatus("disconnected");
    });
  }, []);

  const connect = async () => {
    setStatus("connecting");
    setError("");
    try {
      console.log("[useWallet] Connecting to wallet...");
      const { api: connectedApi, config } = await connectWallet();
      console.log("[useWallet] Connected API:", connectedApi);
      console.log("[useWallet] Config:", config);

      await connectedApi.hintUsage([
        "getConfiguration",
        "getShieldedAddresses",
        "getUnshieldedAddress",
        "getProvingProvider",
        "balanceUnsealedTransaction",
        "submitTransaction",
      ]);

      const provs = await buildProviders(connectedApi);
      console.log("[useWallet] Providers built:", {
        networkId: provs.networkId,
        shieldedAddress: provs.shieldedAddress?.slice(0, 16),
        unshieldedAddress: provs.unshieldedAddress?.slice(0, 16),
      });
      setApi(connectedApi);
      setProviders(provs);
      setAddress(provs.unshieldedAddress);
      setStatus("connected");
      console.log(
        "[useWallet] ✅ Connected successfully on network:",
        provs.networkId,
      );
    } catch (e) {
      const errMsg =
        e instanceof Error ? e.message : "Connection failed: " + String(e);
      console.error("[useWallet] ❌ Connection error:", errMsg);
      console.error("[useWallet] Full error:", e);
      setError(errMsg);
      setStatus("disconnected");
    }
  };

  return { status, api, providers, address, error, connect };
}
