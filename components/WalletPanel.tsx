type WalletPanelProps = {
  status: "detecting" | "disconnected" | "connecting" | "connected";
  address: string;
  error: string;
  connect: () => Promise<void>;
  onConnect?: (address: string) => void;
};

export function WalletPanel({
  status,
  address,
  error,
  connect,
  onConnect,
}: WalletPanelProps) {
  if (status === "connected") {
    return (
      <div className="rounded-lg border border-emerald-700 bg-emerald-950/30 p-3">
        <div className="flex items-center gap-2 text-emerald-400 text-sm font-medium">
          <div className="h-2 w-2 rounded-full bg-emerald-500" /> Connected
        </div>
        <div className="mt-1 font-mono text-xs text-zinc-400 truncate">
          {address}
        </div>
      </div>
    );
  }
  return (
    <div>
      <button
        onClick={async () => {
          await connect();
          if (address) onConnect?.(address);
        }}
        disabled={status === "connecting"}
        className="w-full rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-zinc-900 hover:bg-zinc-200 disabled:opacity-50 transition"
      >
        {status === "connecting"
          ? "Connecting..."
          : status === "detecting"
            ? "Detecting wallet..."
            : "Connect 1AM Wallet"}
      </button>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}
