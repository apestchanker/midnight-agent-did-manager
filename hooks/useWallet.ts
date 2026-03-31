import { useState, useEffect } from "react";
import {
  connectWallet,
  detectWallets,
  type ConnectedAPI,
  type InitialAPI,
} from "../lib/wallet-bridge";
import { requestWalletPermissionsIfSupported } from "../lib/wallet-permissions";
import { buildProviders, type AppProviders } from "../lib/providers";

type WalletStatus =
  | "detecting"
  | "disconnected"
  | "connecting"
  | "awaiting_remote_prover_approval"
  | "connected";

type WalletOption = {
  name: string;
  apiVersion: string;
};

type PendingRemoteProverApproval = {
  api: ConnectedAPI;
  config: Awaited<ReturnType<ConnectedAPI["getConfiguration"]>>;
  walletName: string;
};

function toWalletOption(wallet: InitialAPI): WalletOption {
  return {
    name: wallet.name,
    apiVersion: wallet.apiVersion,
  };
}

function isLocalProverServerUrl(url?: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  } catch {
    return false;
  }
}

export function useWallet() {
  const [status, setStatus] = useState<WalletStatus>("detecting");
  const [api, setApi] = useState<ConnectedAPI | null>(null);
  const [providers, setProviders] = useState<AppProviders | null>(null);
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");
  const [availableWallets, setAvailableWallets] = useState<WalletOption[]>([]);
  const [selectedWalletName, setSelectedWalletName] = useState("1AM");
  const [connectedWalletName, setConnectedWalletName] = useState("");
  const [pendingRemoteProverApproval, setPendingRemoteProverApproval] =
    useState<PendingRemoteProverApproval | null>(null);

  useEffect(() => {
    detectWallets().then((wallets) => {
      console.log(
        "[useWallet] Wallet detection complete, found:",
        wallets.length,
        "wallet(s)",
      );
      const normalizedWallets = wallets.map(toWalletOption);
      setAvailableWallets(normalizedWallets);
      setSelectedWalletName((current) => {
        if (normalizedWallets.some((wallet) => wallet.name === current)) {
          return current;
        }
        return normalizedWallets.find((wallet) => wallet.name === "1AM")?.name ||
          normalizedWallets[0]?.name ||
          "1AM";
      });
      setStatus("disconnected");
    });
  }, []);

  const finalizeConnection = async (
    connectedApi: ConnectedAPI,
    walletName: string,
  ) => {
    await requestWalletPermissionsIfSupported(connectedApi);

    const provs = await buildProviders(connectedApi);
    console.log("[useWallet] Providers built:", {
      networkId: provs.networkId,
      shieldedAddress: provs.shieldedAddress?.slice(0, 16),
      unshieldedAddress: provs.unshieldedAddress?.slice(0, 16),
      proverServerUrl: provs.proverServerUrl,
    });
    setApi(connectedApi);
    setProviders(provs);
    setAddress(provs.unshieldedAddress);
    setConnectedWalletName(walletName);
    setPendingRemoteProverApproval(null);
    setStatus("connected");
    console.log(
      "[useWallet] ✅ Connected successfully on network:",
      provs.networkId,
    );
  };

  const connect = async () => {
    setStatus("connecting");
    setError("");
    setPendingRemoteProverApproval(null);
    try {
      console.log("[useWallet] Connecting to wallet...");
      const {
        api: connectedApi,
        config,
        walletName,
      } = await connectWallet(selectedWalletName);
      console.log("[useWallet] Connected API:", connectedApi);
      console.log("[useWallet] Config:", config);
      console.log("[useWallet] Connected wallet:", walletName);

      if (!isLocalProverServerUrl(config.proverServerUri)) {
        console.warn(
          "[useWallet] Remote proving endpoint requires explicit approval:",
          config.proverServerUri,
        );
        setPendingRemoteProverApproval({
          api: connectedApi,
          config,
          walletName,
        });
        setStatus("awaiting_remote_prover_approval");
        return;
      }

      await finalizeConnection(connectedApi, walletName);
    } catch (e) {
      const errMsg =
        e instanceof Error ? e.message : "Connection failed: " + String(e);
      console.error("[useWallet] ❌ Connection error:", errMsg);
      console.error("[useWallet] Full error:", e);
      setError(errMsg);
      setStatus("disconnected");
    }
  };

  const approveRemoteProver = async () => {
    if (!pendingRemoteProverApproval) return;
    setStatus("connecting");
    setError("");
    try {
      await finalizeConnection(
        pendingRemoteProverApproval.api,
        pendingRemoteProverApproval.walletName,
      );
    } catch (e) {
      const errMsg =
        e instanceof Error ? e.message : "Connection failed: " + String(e);
      console.error("[useWallet] ❌ Connection error:", errMsg);
      console.error("[useWallet] Full error:", e);
      setError(errMsg);
      setPendingRemoteProverApproval(null);
      setStatus("disconnected");
    }
  };

  const declineRemoteProver = () => {
    if (!pendingRemoteProverApproval) return;
    setApi(null);
    setProviders(null);
    setAddress("");
    setConnectedWalletName("");
    setPendingRemoteProverApproval(null);
    setError(
      `Connection cancelled. ${pendingRemoteProverApproval.config.proverServerUri} is a remote proving service.`,
    );
    setStatus("disconnected");
  };

  return {
    status,
    api,
    providers,
    address,
    error,
    connect,
    availableWallets,
    selectedWalletName,
    setSelectedWalletName,
    connectedWalletName,
    pendingRemoteProverApproval,
    approveRemoteProver,
    declineRemoteProver,
  };
}
