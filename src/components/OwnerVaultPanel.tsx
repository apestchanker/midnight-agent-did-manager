import { useEffect, useMemo, useState } from "react";
import type { AppProviders } from "../../lib/providers";
import {
  exportOwnerVaultBackup,
  getOwnerVaultStatus,
  restoreOwnerVaultBackup,
  type OwnerVaultStatus,
} from "../lib/didContract";
import {
  buildOwnerSignatureDomain,
  createDeploymentSaltHex,
  deriveOwnerSecretFromWalletSignature,
} from "../lib/did/commitments";
import { toHex } from "../../lib/wallet-bridge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

interface OwnerVaultPanelProps {
  providers: AppProviders;
  contractAddress: string;
}

type SignatureDeterminismCheck = {
  domain: string;
  source: "fresh-test-domain" | "contract-owner-domain";
  sameSignature: boolean;
  sameDerivedSecret: boolean;
  signatureOnePrefix: string;
  signatureTwoPrefix: string;
  derivedSecretOnePrefix: string;
  derivedSecretTwoPrefix: string;
  checkedAt: string;
};

type PendingSignatureTest = {
  domain: string;
  source: SignatureDeterminismCheck["source"];
  signatureOne: string;
  derivedSecretOneHex: string;
  signatureOnePrefix: string;
  derivedSecretOnePrefix: string;
  startedAt: string;
};

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
  const [signatureCheck, setSignatureCheck] =
    useState<SignatureDeterminismCheck | null>(null);
  const [pendingSignatureTest, setPendingSignatureTest] =
    useState<PendingSignatureTest | null>(null);
  const [signatureProgress, setSignatureProgress] = useState("");
  const [signatureError, setSignatureError] = useState("");
  const [signatureAttemptedAt, setSignatureAttemptedAt] = useState("");
  const [loading, setLoading] =
    useState<"status" | "export" | "restore" | "signature" | "">("");

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

  async function handleStartSignatureDeterminismCheck(
    source: SignatureDeterminismCheck["source"],
  ) {
    if (typeof providers.connectedAPI.signData !== "function") {
      setMessage("Connected Midnight wallet does not support signData().");
      return;
    }

    setLoading("signature");
    setMessage("");
    setSignatureCheck(null);
    setPendingSignatureTest(null);
    setSignatureError("");
    setSignatureAttemptedAt(new Date().toISOString());
    setSignatureProgress("Preparing signature test domain.");
    try {
      const contractDeploymentSaltHex =
        status?.ownerDerivation?.scheme === "wallet-signature-sha256-v1"
          ? status.ownerDerivation.deploymentSaltHex
          : undefined;
      if (source === "contract-owner-domain" && !contractDeploymentSaltHex) {
        throw new Error(
          "This registry does not expose owner derivation metadata for a contract-domain test.",
        );
      }
      const deploymentSaltHex =
        source === "contract-owner-domain" && contractDeploymentSaltHex
          ? contractDeploymentSaltHex
          : createDeploymentSaltHex(toHex);
      const domain = buildOwnerSignatureDomain({
        networkId: providers.networkId,
        deploymentSaltHex,
      });

      setSignatureProgress("Wallet prompt 1 of 2: sign the test domain.");
      const first = await providers.connectedAPI.signData(domain, {
        encoding: "text",
        keyType: "unshielded",
      });
      const firstSignature = String(first.signature || "").replace(/^0x/i, "");
      const firstSecret = await deriveOwnerSecretFromWalletSignature(firstSignature);
      const firstSecretHex = toHex(firstSecret);

      setPendingSignatureTest({
        domain,
        source,
        signatureOne: firstSignature,
        derivedSecretOneHex: firstSecretHex,
        signatureOnePrefix: `${firstSignature.slice(0, 16)}...${firstSignature.slice(-8)}`,
        derivedSecretOnePrefix: `${firstSecretHex.slice(0, 16)}...${firstSecretHex.slice(-8)}`,
        startedAt: new Date().toISOString(),
      });
      setSignatureProgress("");
    } catch (error) {
      const nextError =
        error instanceof Error
          ? error.message
          : "Failed to run wallet signature determinism check.";
      setSignatureError(nextError);
      setMessage(nextError);
    } finally {
      setLoading("");
    }
  }

  async function handleCompleteSignatureDeterminismCheck() {
    if (!pendingSignatureTest) {
      setSignatureError("Run the first signature step before completing the test.");
      return;
    }
    if (typeof providers.connectedAPI.signData !== "function") {
      setMessage("Connected Midnight wallet does not support signData().");
      return;
    }

    setLoading("signature");
    setMessage("");
    setSignatureCheck(null);
    setSignatureError("");
    setSignatureProgress("Wallet prompt 2 of 2: sign the exact same domain again.");
    try {
      const second = await providers.connectedAPI.signData(pendingSignatureTest.domain, {
        encoding: "text",
        keyType: "unshielded",
      });
      setSignatureProgress("Comparing signatures and derived owner secrets.");
      const secondSignature = String(second.signature || "").replace(/^0x/i, "");
      const secondSecret = await deriveOwnerSecretFromWalletSignature(secondSignature);
      const secondSecretHex = toHex(secondSecret);

      setSignatureCheck({
        domain: pendingSignatureTest.domain,
        source: pendingSignatureTest.source,
        sameSignature:
          pendingSignatureTest.signatureOne.toLowerCase() ===
          secondSignature.toLowerCase(),
        sameDerivedSecret:
          pendingSignatureTest.derivedSecretOneHex.toLowerCase() ===
          secondSecretHex.toLowerCase(),
        signatureOnePrefix: pendingSignatureTest.signatureOnePrefix,
        signatureTwoPrefix: `${secondSignature.slice(0, 16)}...${secondSignature.slice(-8)}`,
        derivedSecretOnePrefix: pendingSignatureTest.derivedSecretOnePrefix,
        derivedSecretTwoPrefix: `${secondSecretHex.slice(0, 16)}...${secondSecretHex.slice(-8)}`,
        checkedAt: new Date().toISOString(),
      });
      setPendingSignatureTest(null);
    } catch (error) {
      const nextError =
        error instanceof Error
          ? error.message
          : "Failed to complete wallet signature determinism check.";
      setSignatureError(nextError);
      setMessage(nextError);
    } finally {
      setLoading("");
      setSignatureProgress("");
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
          Owner authority uses a stable secret stored in local Midnight private
          state. The chain stores only the derived public authorization key;
          export an encrypted backup before relying on a registry.
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
                    ? "Local owner metadata does not match this registry"
                    : "Local owner metadata is present"
                  : "Local owner metadata is missing"}
              </div>
              <div className="mt-2 space-y-1 text-xs text-zinc-400">
                <div>Contract: <span className="font-mono break-all">{contractAddress}</span></div>
                <div>Created: <span className="font-mono">{status?.createdAt || "unknown"}</span></div>
                <div>Local issuer key: <span className="font-mono break-all">{status?.localIssuerPublicKeyHex || "not loaded"}</span></div>
                <div>On-chain issuer key: <span className="font-mono break-all">{status?.onChainIssuerPublicKeyHex || "not readable"}</span></div>
              </div>
              <div className="mt-3">
                <div className="flex flex-wrap gap-2">
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
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      void handleStartSignatureDeterminismCheck("fresh-test-domain");
                    }}
                    disabled={loading !== ""}
                    className="border-zinc-700 text-zinc-200 hover:bg-zinc-800"
                  >
                    {loading === "signature" ? "Signing..." : "Start Fresh Signature Test"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      void handleStartSignatureDeterminismCheck("contract-owner-domain");
                    }}
                    disabled={loading !== "" || !status?.ownerDerivation?.deploymentSaltHex}
                    className="border-zinc-700 text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
                  >
                    Start Contract Domain Test
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      void handleCompleteSignatureDeterminismCheck();
                    }}
                    disabled={loading !== "" || !pendingSignatureTest}
                    className="bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50"
                  >
                    Sign Same Domain Again
                  </Button>
                </div>
                <div className="mt-3 rounded-md border border-zinc-800 bg-black/40 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Signature Test Output
                  </div>
                  {!signatureAttemptedAt && !signatureCheck && !signatureError ? (
                    <div className="mt-2 text-xs text-zinc-400">
                      No signature test has been run in this browser session.
                    </div>
                  ) : null}
                  {signatureProgress ? (
                    <div className="mt-2 text-xs text-blue-200">
                      {signatureProgress}
                    </div>
                  ) : null}
                  {signatureError ? (
                    <div className="mt-2 text-xs text-red-300">
                      Error: {signatureError}
                    </div>
                  ) : null}
                  {pendingSignatureTest ? (
                    <div className="mt-2 space-y-1 text-xs text-zinc-400">
                      <div className="font-medium text-blue-200">
                        Step 1 captured. Click "Sign Same Domain Again" to complete the comparison.
                      </div>
                      <div>Started: <span className="font-mono">{pendingSignatureTest.startedAt}</span></div>
                      <div>Domain source: <span className="font-mono">{pendingSignatureTest.source === "contract-owner-domain" ? "current contract owner derivation" : "fresh test domain, independent from deployed contract"}</span></div>
                      <div>Domain: <span className="font-mono break-all">{pendingSignatureTest.domain}</span></div>
                      <div>Signature #1: <span className="font-mono">{pendingSignatureTest.signatureOnePrefix}</span></div>
                      <div>Derived secret #1: <span className="font-mono">{pendingSignatureTest.derivedSecretOnePrefix}</span></div>
                    </div>
                  ) : null}
                  {signatureCheck ? (
                    <div className="mt-2 space-y-1 text-xs text-zinc-400">
                      <div
                        className={`font-medium ${
                          signatureCheck.sameSignature && signatureCheck.sameDerivedSecret
                            ? "text-emerald-300"
                            : "text-red-300"
                        }`}
                      >
                        {signatureCheck.sameSignature && signatureCheck.sameDerivedSecret
                          ? "PASS: same message produced the same derived owner secret"
                          : "FAIL: same message produced a different derived owner secret"}
                      </div>
                      <div>Checked: <span className="font-mono">{signatureCheck.checkedAt}</span></div>
                      <div>Domain source: <span className="font-mono">{signatureCheck.source === "contract-owner-domain" ? "current contract owner derivation" : "fresh test domain, independent from deployed contract"}</span></div>
                      <div>Domain: <span className="font-mono break-all">{signatureCheck.domain}</span></div>
                      <div>Signature #1: <span className="font-mono">{signatureCheck.signatureOnePrefix}</span></div>
                      <div>Signature #2: <span className="font-mono">{signatureCheck.signatureTwoPrefix}</span></div>
                      <div>Same signature: <span className="font-mono">{String(signatureCheck.sameSignature)}</span></div>
                      <div>Derived secret #1: <span className="font-mono">{signatureCheck.derivedSecretOnePrefix}</span></div>
                      <div>Derived secret #2: <span className="font-mono">{signatureCheck.derivedSecretTwoPrefix}</span></div>
                      <div>Same derived secret: <span className="font-mono">{String(signatureCheck.sameDerivedSecret)}</span></div>
                    </div>
                  ) : null}
                  {signatureAttemptedAt && !signatureProgress && !signatureCheck && !signatureError ? (
                    <div className="mt-2 text-xs text-zinc-400">
                      Last attempt started at <span className="font-mono">{signatureAttemptedAt}</span>.
                    </div>
                  ) : null}
                </div>
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
