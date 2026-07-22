import { useCallback, useState, useEffect } from "react";
import {
  connectWallet,
  detectWallets,
  type ConnectedAPI,
  type InitialAPI,
} from "../lib/wallet-bridge";
import { requestWalletPermissionsIfSupported } from "../lib/wallet-permissions";
import {
  buildProviders,
  type AppProviders,
  type StorageMode,
} from "../lib/providers";

type WalletStatus =
  | "detecting"
  | "disconnected"
  | "connecting"
  | "connected";

type WalletOption = {
  name: string;
  apiVersion: string;
};

type ProofServiceState = {
  source: "configured_env" | "wallet";
  proverServerUrl?: string;
  warningRequired: boolean;
};

function toWalletOption(wallet: InitialAPI): WalletOption {
  return {
    name: wallet.name,
    apiVersion: wallet.apiVersion,
  };
}

export function useWallet(storageMode: StorageMode = "app_local") {
  const SELECTED_WALLET_KEY = "didmn:selected-wallet:v1";
  const [status, setStatus] = useState<WalletStatus>("detecting");
  const [api, setApi] = useState<ConnectedAPI | null>(null);
  const [providers, setProviders] = useState<AppProviders | null>(null);
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");
  const [availableWallets, setAvailableWallets] = useState<WalletOption[]>([]);
  const [selectedWalletName, setSelectedWalletName] = useState("1AM");
  const [connectedWalletName, setConnectedWalletName] = useState("");
  const [proofService, setProofService] = useState<ProofServiceState | null>(null);
  const persistSelectedWallet = useCallback(
    (walletName: string) => {
      if (typeof window === "undefined") return;
      window.localStorage.setItem(SELECTED_WALLET_KEY, walletName);
    },
    [],
  );

  const clearPersistedSelection = useCallback(() => {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(SELECTED_WALLET_KEY);
  }, []);

  const hasLiveSession = useCallback(
    () => Boolean(api && providers && address),
    [api, providers, address],
  );

  useEffect(() => {
    detectWallets().then(async (wallets) => {
      const normalizedWallets = wallets.map(toWalletOption);
      setAvailableWallets(normalizedWallets);
      const resolvedWalletName = (() => {
        const persisted =
          typeof window !== "undefined"
            ? window.localStorage.getItem(SELECTED_WALLET_KEY)
            : null;
        if (
          persisted &&
          normalizedWallets.some((wallet) => wallet.name === persisted)
        ) {
          return persisted;
        }
        if (normalizedWallets.some((wallet) => wallet.name === selectedWalletName)) {
          return selectedWalletName;
        }
        return normalizedWallets.find((wallet) => wallet.name === "1AM")?.name ||
          normalizedWallets[0]?.name ||
          "1AM";
      })();
      setSelectedWalletName(resolvedWalletName);
      setStatus("disconnected");
    });
    // Mount-only: this detects available wallets and resolves an initial
    // selection once. It must NOT re-run when selectedWalletName changes —
    // doing so previously re-read the (stale) persisted wallet from
    // localStorage and forced the user's live dropdown pick back to
    // whatever was last connected, since persistSelectedWallet() is only
    // called on a successful connect, not on every selection change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearPersistedSelection, persistSelectedWallet]);

  const reconnectApi = useCallback(
    async (walletNameOverride?: string): Promise<ConnectedAPI> => {
      const { api: nextApi, walletName } = await connectWallet(
        walletNameOverride || connectedWalletName || selectedWalletName,
      );
      setApi(nextApi);
      setConnectedWalletName(walletName);
      return nextApi;
    },
    [connectedWalletName, selectedWalletName],
  );

  const finalizeConnection = useCallback(
    async (
      connectedApi: ConnectedAPI,
      walletName: string,
    ) => {
      await requestWalletPermissionsIfSupported(connectedApi);

      const provs = await buildProviders(connectedApi, {
        reconnect: async () => reconnectApi(walletName),
        onReconnect: (reconnectedApi) => {
          setApi(reconnectedApi);
        },
        storageMode,
        onProofProviderStatusChange: setProofService,
      });
      setApi(connectedApi);
      setProviders(provs);
      setAddress(provs.unshieldedAddress);
      setConnectedWalletName(walletName);
      setStatus("connected");
      persistSelectedWallet(walletName);
    },
    [persistSelectedWallet, reconnectApi, storageMode],
  );

  const tryRecoverExistingSession = useCallback(
    async (walletNameHint?: string): Promise<boolean> => {
      if (!hasLiveSession()) {
        return false;
      }
      try {
        const nextApi = await reconnectApi(walletNameHint);
        await finalizeConnection(nextApi, walletNameHint || connectedWalletName || selectedWalletName);
        return true;
      } catch (error) {
        console.error("[useWallet] Failed to revalidate active session:", error);
        return false;
      }
    },
    [
      connectedWalletName,
      finalizeConnection,
      hasLiveSession,
      reconnectApi,
      selectedWalletName,
    ],
  );

  const connect = async () => {
    setStatus("connecting");
    setError("");
    try {
      const {
        api: connectedApi,
        walletName,
      } = await connectWallet(selectedWalletName);

      await finalizeConnection(connectedApi, walletName);
    } catch (e) {
      const errMsg =
        e instanceof Error ? e.message : "Connection failed: " + String(e);
      console.error("[useWallet] ❌ Connection error:", errMsg);
      console.error("[useWallet] Full error:", e);
      if (await tryRecoverExistingSession(selectedWalletName)) {
        setError(`Wallet connection request timed out or stalled. The existing session was revalidated.`);
        setStatus("connected");
        return;
      }
      setError(errMsg);
      setStatus("disconnected");
    }
  };

  const approveRemoteProver = async () => {
    return;
  };

  const declineRemoteProver = () => {
    setApi(null);
    setProviders(null);
    setAddress("");
    setConnectedWalletName("");
    setProofService(null);
    clearPersistedSelection();
    setError("Connection cancelled.");
    setStatus("disconnected");
  };

  return {
    status,
    api,
    providers,
    proofService,
    address,
    error,
    connect,
    availableWallets,
    selectedWalletName,
    setSelectedWalletName,
    connectedWalletName,
    approveRemoteProver,
    declineRemoteProver,
  };
}
