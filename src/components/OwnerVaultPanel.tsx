import { useEffect, useMemo, useState } from "react";
import type { AppProviders } from "../../lib/providers";
import {
  exportOwnerVaultBackup,
  getOwnerVaultStatus,
  restoreOwnerVaultBackup,
  type OwnerVaultStatus,
} from "../lib/didContract";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

interface OwnerVaultPanelProps {
  providers: AppProviders;
  contractAddress: string;
}

export function OwnerVaultPanel({
  providers,
  contractAddress,
}: OwnerVaultPanelProps) {
  const MIN_BACKUP_PASSWORD_LENGTH = 10;
  const [status, setStatus] = useState<OwnerVaultStatus | null>(null);
  const [backupPassword, setBackupPassword] = useState("");
  const [showBackupPassword, setShowBackupPassword] = useState(false);
  const [backupJson, setBackupJson] = useState("");
  const [restorePassword, setRestorePassword] = useState("");
  const [showRestorePassword, setShowRestorePassword] = useState(false);
  const [restoreJson, setRestoreJson] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState<"status" | "export" | "restore" | "">("");

  async function refreshStatus() {
    if (!contractAddress.trim()) {
      setStatus(null);
      return;
    }
    setLoading("status");
    try {
      setStatus(await getOwnerVaultStatus(providers, contractAddress));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to inspect owner vault.");
    } finally {
      setLoading("");
    }
  }

  useEffect(() => {
    void refreshStatus();
  }, [contractAddress, providers]);

  const statusTone = useMemo(() => {
    if (!status) return "text-zinc-400";
    if (!status.hasLocalVault) return "text-amber-300";
    if (status.matchesOnChain === false) return "text-red-300";
    return "text-emerald-300";
  }, [status]);

  const backupPasswordError =
    backupPassword.trim().length > 0 &&
    backupPassword.trim().length < MIN_BACKUP_PASSWORD_LENGTH
      ? `Backup password must be at least ${MIN_BACKUP_PASSWORD_LENGTH} characters.`
      : "";

  const restorePasswordError =
    restorePassword.trim().length > 0 &&
    restorePassword.trim().length < MIN_BACKUP_PASSWORD_LENGTH
      ? `Backup password must be at least ${MIN_BACKUP_PASSWORD_LENGTH} characters.`
      : "";

  async function handleExport() {
    if (backupPasswordError) {
      setMessage(backupPasswordError);
      return;
    }
    setLoading("export");
    setMessage("");
    try {
      const exported = await exportOwnerVaultBackup(
        providers,
        contractAddress,
        backupPassword,
      );
      setBackupJson(exported);
      setMessage("Owner vault backup created. Save it outside this browser before continuing.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to export owner vault backup.");
    } finally {
      setLoading("");
    }
  }

  async function handleRestore() {
    if (restorePasswordError) {
      setMessage(restorePasswordError);
      return;
    }
    if (!restoreJson.trim()) {
      setMessage("Paste an encrypted vault backup before attempting restore.");
      return;
    }
    setLoading("restore");
    setMessage("");
    try {
      const nextStatus = await restoreOwnerVaultBackup(
        providers,
        contractAddress,
        restoreJson,
        restorePassword,
      );
      setStatus(nextStatus);
      setMessage("Owner vault restored into Midnight private state for this contract.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to restore owner vault backup.");
    } finally {
      setLoading("");
    }
  }

  function downloadBackup() {
    if (!backupJson) return;
    const blob = new Blob([backupJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `owner-vault-${contractAddress || "registry"}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardHeader>
        <CardTitle className="text-white">Owner Vault</CardTitle>
        <CardDescription className="text-zinc-400">
          The owner secret lives in Midnight private state as a local vault. Export
          an encrypted backup after deployment and restore it before admin actions
          if the local vault is missing.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!contractAddress.trim() ? (
          <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-400">
            Deploy or paste a contract address first.
          </div>
        ) : (
          <>
            <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
              <div className={`text-sm font-medium ${statusTone}`}>
                {status?.hasLocalVault
                  ? status.matchesOnChain === false
                    ? "Local owner vault does not match this registry"
                    : "Local owner vault is present"
                  : "Local owner vault is missing"}
              </div>
              <div className="mt-2 space-y-1 text-xs text-zinc-400">
                <div>Contract: <span className="font-mono break-all">{contractAddress}</span></div>
                <div>Created: <span className="font-mono">{status?.createdAt || "unknown"}</span></div>
                <div>Local issuer key: <span className="font-mono break-all">{status?.localIssuerPublicKeyHex || "not loaded"}</span></div>
                <div>On-chain issuer key: <span className="font-mono break-all">{status?.onChainIssuerPublicKeyHex || "not readable"}</span></div>
              </div>
              <div className="mt-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void refreshStatus();
                  }}
                  disabled={loading !== ""}
                  className="border-zinc-700 text-zinc-200 hover:bg-zinc-800"
                >
                  {loading === "status" ? "Checking..." : "Refresh Vault Status"}
                </Button>
              </div>
            </div>

            <form
              className="space-y-2 rounded-md border border-zinc-800 bg-zinc-950 p-3"
              onSubmit={(event) => {
                event.preventDefault();
                void handleExport();
              }}
            >
              <input
                type="text"
                name="username"
                autoComplete="username"
                value={contractAddress}
                readOnly
                tabIndex={-1}
                aria-hidden="true"
                className="sr-only"
              />
              <Label htmlFor="backupPassword" className="text-zinc-300">
                Backup Password
              </Label>
              <div className="flex gap-2">
                <Input
                  id="backupPassword"
                  type={showBackupPassword ? "text" : "password"}
                  value={backupPassword}
                  onChange={(event) => setBackupPassword(event.target.value)}
                  placeholder="At least 10 characters"
                  autoComplete="new-password"
                  className="bg-zinc-950 border-zinc-800 text-white"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowBackupPassword((current) => !current)}
                  className="border-zinc-700 text-zinc-200 hover:bg-zinc-800"
                >
                  {showBackupPassword ? "Hide" : "Show"}
                </Button>
              </div>
              <p className={`text-xs ${backupPasswordError ? "text-red-300" : "text-zinc-500"}`}>
                {backupPasswordError || "Use a memorable password with at least 10 characters."}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  disabled={loading !== "" || !contractAddress.trim() || !!backupPasswordError}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white"
                >
                  {loading === "export" ? "Exporting..." : "Create Encrypted Backup"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={downloadBackup}
                  disabled={!backupJson}
                  className="border-zinc-700 text-zinc-200 hover:bg-zinc-800"
                >
                  Download Backup
                </Button>
              </div>
              {backupJson ? (
                <textarea
                  value={backupJson}
                  onChange={(event) => setBackupJson(event.target.value)}
                  rows={8}
                  spellCheck={false}
                  className="mt-2 w-full rounded-md border border-zinc-800 bg-black px-3 py-2 font-mono text-xs text-zinc-100 outline-none"
                />
              ) : null}
            </form>

            <form
              className="space-y-2 rounded-md border border-zinc-800 bg-zinc-950 p-3"
              onSubmit={(event) => {
                event.preventDefault();
                void handleRestore();
              }}
            >
              <input
                type="text"
                name="username"
                autoComplete="username"
                value={contractAddress}
                readOnly
                tabIndex={-1}
                aria-hidden="true"
                className="sr-only"
              />
              <Label htmlFor="restorePassword" className="text-zinc-300">
                Restore Backup
              </Label>
              <div className="flex gap-2">
                <Input
                  id="restorePassword"
                  type={showRestorePassword ? "text" : "password"}
                  value={restorePassword}
                  onChange={(event) => setRestorePassword(event.target.value)}
                  placeholder="Backup password"
                  autoComplete="current-password"
                  className="bg-zinc-950 border-zinc-800 text-white"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowRestorePassword((current) => !current)}
                  className="border-zinc-700 text-zinc-200 hover:bg-zinc-800"
                >
                  {showRestorePassword ? "Hide" : "Show"}
                </Button>
              </div>
              <p className={`text-xs ${restorePasswordError ? "text-red-300" : "text-zinc-500"}`}>
                {restorePasswordError || "Enter the password used when the backup was created."}
              </p>
              <textarea
                value={restoreJson}
                onChange={(event) => setRestoreJson(event.target.value)}
                rows={8}
                spellCheck={false}
                placeholder="Paste the encrypted owner vault backup JSON here"
                className="w-full rounded-md border border-zinc-800 bg-black px-3 py-2 font-mono text-xs text-zinc-100 outline-none"
              />
              <Button
                type="submit"
                disabled={loading !== "" || !contractAddress.trim() || !!restorePasswordError || !restoreJson.trim()}
                className="bg-blue-600 hover:bg-blue-500 text-white"
              >
                {loading === "restore" ? "Restoring..." : "Restore Owner Vault"}
              </Button>
            </form>
          </>
        )}

        {message ? (
          <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300">
            {message}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
