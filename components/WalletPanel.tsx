import { useState } from "react";
import type { StorageMode } from "../lib/providers";

type WalletOption = {
  name: string;
  apiVersion: string;
};

type PendingRemoteProverApproval = {
  config: {
    proverServerUri?: string;
    networkId?: string;
  };
  walletName: string;
};

type WalletPanelProps = {
  status:
    | "detecting"
    | "disconnected"
    | "connecting"
    | "awaiting_remote_prover_approval"
    | "connected";
  address: string;
  error: string;
  walletName?: string;
  connect: () => Promise<void>;
  availableWallets: WalletOption[];
  selectedWalletName: string;
  onSelectWallet: (walletName: string) => void;
  pendingRemoteProverApproval: PendingRemoteProverApproval | null;
  approveRemoteProver: () => Promise<void>;
  declineRemoteProver: () => void;
  storageMode: StorageMode;
  onSelectStorageMode: (mode: StorageMode) => void;
  onConnect?: (address: string) => void;
};

const STORAGE_MODE_LABELS: Record<StorageMode, string> = {
  app_local: "App local vault",
  patched_sdk: "Patched Midnight SDK",
};

export function WalletPanel({
  status,
  address,
  error,
  walletName,
  connect,
  availableWallets,
  selectedWalletName,
  onSelectWallet,
  pendingRemoteProverApproval,
  approveRemoteProver,
  declineRemoteProver,
  storageMode,
  onSelectStorageMode,
  onConnect,
}: WalletPanelProps) {
  const [showStorageSettings, setShowStorageSettings] = useState(false);
  const canChangeStorageMode = status !== "connected" && status !== "connecting";

  if (status === "connected") {
    return (
      <div className="rounded-lg border border-emerald-700 bg-emerald-950/30 p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-emerald-400 text-sm font-medium">
              <div className="h-2 w-2 rounded-full bg-emerald-500" /> Connected
            </div>
            <div className="mt-1 text-xs text-emerald-300">
              Storage mode: {STORAGE_MODE_LABELS[storageMode]}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowStorageSettings((current) => !current)}
            className="rounded-lg border border-emerald-700/70 px-2 py-1 text-xs font-medium text-emerald-200 hover:bg-emerald-900/40 transition"
          >
            Settings
          </button>
        </div>
        {walletName ? (
          <div className="mt-1 text-xs text-emerald-300">Wallet: {walletName}</div>
        ) : null}
        <div className="mt-1 font-mono text-xs text-zinc-400 truncate">
          {address}
        </div>
        {showStorageSettings ? (
          <div className="mt-3 rounded-lg border border-amber-700/60 bg-zinc-950/80 p-3 text-xs text-zinc-300">
            <div className="font-medium text-white">Private storage mode</div>
            <div className="mt-1 text-zinc-400">
              Storage mode is locked while connected. Reload or reconnect before switching modes so vault data does not appear to vanish across backends.
            </div>
            <div className="mt-3 grid gap-2">
              <label className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                <div className="flex items-center gap-2">
                  <input type="radio" checked={storageMode === "app_local"} readOnly />
                  <span className="font-medium text-white">App local vault</span>
                </div>
                <div className="mt-1 text-zinc-400">
                  Safe default. Uses the app-managed browser local vault and does not depend on the unofficial SDK patch.
                </div>
              </label>
              <label className="rounded-lg border border-amber-700/50 bg-amber-950/20 p-3">
                <div className="flex items-center gap-2">
                  <input type="radio" checked={storageMode === "patched_sdk"} readOnly />
                  <span className="font-medium text-amber-100">Patched Midnight SDK</span>
                </div>
                <div className="mt-1 text-amber-100/80">
                  Experimental. This uses a non-official patched version of the official Midnight SDK private-state provider. A PR has been submitted and is waiting for upstream approval.
                </div>
              </label>
            </div>
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900 p-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Private Storage
          </div>
          <div className="mt-1 text-sm text-white">{STORAGE_MODE_LABELS[storageMode]}</div>
        </div>
        <button
          type="button"
          onClick={() => setShowStorageSettings((current) => !current)}
          className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-800"
        >
          Settings
        </button>
      </div>
      {showStorageSettings ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-sm text-zinc-300">
          <div className="font-medium text-white">Choose storage mode before connecting</div>
          <div className="mt-1 text-xs text-zinc-500">
            Each mode stores private state in a different backend. Switching modes later can make an existing vault look missing until you switch back or restore a backup.
          </div>
          <div className="mt-3 grid gap-2">
            <label className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
              <div className="flex items-start gap-2">
                <input
                  type="radio"
                  name="storage-mode"
                  checked={storageMode === "app_local"}
                  onChange={() => onSelectStorageMode("app_local")}
                  disabled={!canChangeStorageMode}
                />
                <div>
                  <div className="font-medium text-white">App local vault</div>
                  <div className="mt-1 text-xs text-zinc-400">
                    Safe default. Uses the app-managed browser local vault and avoids relying on the unofficial SDK patch.
                  </div>
                </div>
              </div>
            </label>
            <label className="rounded-lg border border-amber-700/50 bg-amber-950/20 p-3">
              <div className="flex items-start gap-2">
                <input
                  type="radio"
                  name="storage-mode"
                  checked={storageMode === "patched_sdk"}
                  onChange={() => onSelectStorageMode("patched_sdk")}
                  disabled={!canChangeStorageMode}
                />
                <div>
                  <div className="font-medium text-amber-100">Patched Midnight SDK</div>
                  <div className="mt-1 text-xs text-amber-100/80">
                    Warning: enabling this uses a non-official patched version of the official Midnight SDK private-state provider. The upstream PR has been submitted and is waiting for approval.
                  </div>
                </div>
              </div>
            </label>
          </div>
          {!canChangeStorageMode ? (
            <div className="mt-3 text-xs text-zinc-500">
              Storage mode is locked while a wallet connection is active.
            </div>
          ) : null}
        </div>
      ) : null}
      {availableWallets.length > 0 ? (
        <div>
          <label
            htmlFor="wallet-select"
            className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500"
          >
            Wallet
          </label>
          <select
            id="wallet-select"
            value={selectedWalletName}
            onChange={(event) => onSelectWallet(event.target.value)}
            disabled={status === "connecting"}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none transition focus:border-zinc-600 disabled:opacity-50"
          >
            {availableWallets.map((wallet) => (
              <option key={`${wallet.name}:${wallet.apiVersion}`} value={wallet.name}>
                {wallet.name} ({wallet.apiVersion})
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <button
        onClick={async () => {
          await connect();
          if (address) onConnect?.(address);
        }}
        disabled={status === "connecting" || availableWallets.length === 0}
        className="w-full rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-zinc-900 hover:bg-zinc-200 disabled:opacity-50 transition"
      >
        {status === "connecting"
          ? "Connecting..."
          : status === "detecting"
            ? "Detecting wallet..."
            : availableWallets.length === 0
              ? "No Wallet Detected"
              : `Connect ${selectedWalletName} Wallet`}
      </button>
      {pendingRemoteProverApproval ? (
        <div className="rounded-lg border border-amber-700 bg-amber-950/30 p-3 text-sm text-amber-100">
          <div className="font-medium">Remote proving service detected</div>
          <div className="mt-2 text-xs text-amber-200/90">
            Wallet `{pendingRemoteProverApproval.walletName}` will use
            {" "}
            `{pendingRemoteProverApproval.config.proverServerUri || "an unknown remote endpoint"}`
            {" "}
            on network `{pendingRemoteProverApproval.config.networkId || "unknown"}`.
          </div>
          <div className="mt-2 text-xs text-amber-200/90">
            Continue only if you explicitly want proofs to be generated through an
            external service.
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => {
                void approveRemoteProver();
              }}
              className="rounded-lg bg-amber-200 px-3 py-2 text-xs font-medium text-amber-950 hover:bg-amber-100 transition"
            >
              Continue With Remote Prover
            </button>
            <button
              onClick={declineRemoteProver}
              className="rounded-lg border border-amber-700 px-3 py-2 text-xs font-medium text-amber-100 hover:bg-amber-950/40 transition"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}
