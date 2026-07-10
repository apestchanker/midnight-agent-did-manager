import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppProviders } from "../../lib/providers";
import { getOwnerVaultStatus } from "../lib/did/vault";
import type { OwnerVaultStatus } from "../types/did";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

interface OwnerVaultPanelProps {
  providers: AppProviders;
  contractAddress: string;
}

export function OwnerVaultPanel({
  providers,
  contractAddress,
}: OwnerVaultPanelProps) {
  const [status, setStatus] = useState<OwnerVaultStatus | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const refreshStatus = useCallback(async () => {
    if (!contractAddress.trim()) {
      setStatus(null);
      return;
    }

    setLoading(true);
    setMessage("");
    try {
      setStatus(await getOwnerVaultStatus(providers, contractAddress));
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Failed to inspect registry controller state.",
      );
    } finally {
      setLoading(false);
    }
  }, [contractAddress, providers]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const statusTone = useMemo(() => {
    if (!contractAddress.trim()) return "text-zinc-400";
    return "text-emerald-300";
  }, [contractAddress]);

  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardHeader>
        <CardTitle className="text-white">Registry Controller</CardTitle>
        <CardDescription className="text-zinc-400">
          DID registry v2 uses wallet-native controller keys. No browser-local
          owner secret or backup vault is required.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!contractAddress.trim() ? (
          <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-400">
            Deploy or paste a contract address first.
          </div>
        ) : (
          <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
            <div className={`text-sm font-medium ${statusTone}`}>
              Controller-bound registry selected
            </div>
            <div className="mt-2 space-y-1 text-xs text-zinc-400">
              <div>
                Contract:{" "}
                <span className="font-mono break-all">
                  {status?.contractAddress || contractAddress}
                </span>
              </div>
              <div>Local owner vault: not used in v2</div>
              <div>Authorization: Compact `ownPublicKey()` and on-chain roles</div>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void refreshStatus();
              }}
              disabled={loading}
              className="mt-3 border-zinc-700 text-zinc-200 hover:bg-zinc-800"
            >
              {loading ? "Checking..." : "Refresh Controller Status"}
            </Button>
          </div>
        )}
        {message ? (
          <div className="rounded-md border border-red-800 bg-red-950/40 p-3 text-xs text-red-200">
            {message}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
