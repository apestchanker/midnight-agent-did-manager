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
  onConnect?: (address: string) => void;
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
  onConnect,
}: WalletPanelProps) {
  if (status === "connected") {
    return (
      <div className="rounded-lg border border-emerald-700 bg-emerald-950/30 p-3">
        <div className="flex items-center gap-2 text-emerald-400 text-sm font-medium">
          <div className="h-2 w-2 rounded-full bg-emerald-500" /> Connected
        </div>
        {walletName ? (
          <div className="mt-1 text-xs text-emerald-300">Wallet: {walletName}</div>
        ) : null}
        <div className="mt-1 font-mono text-xs text-zinc-400 truncate">
          {address}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
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
