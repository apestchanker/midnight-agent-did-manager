import { useState } from "react";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { BadgeCheck, Clipboard, ClipboardCheck, Lock, Rocket, Zap } from "lucide-react";
import type { AppProviders } from "../../lib/providers";
import type { DeployResult } from "../types/did";
import { explorerTxUrl } from "../lib/explorer";
import { useDeployFlow } from "../hooks/useDeployFlow";

interface DeployPanelProps {
  providers: AppProviders;
  onDeployed: (result: DeployResult) => void;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="ml-2 text-zinc-400 hover:text-emerald-400 transition-colors"
      title="Copy to clipboard"
    >
      {copied ? <ClipboardCheck className="h-3 w-3 text-emerald-400" /> : <Clipboard className="h-3 w-3" />}
    </button>
  );
}

export function DeployPanel({ providers, onDeployed }: DeployPanelProps) {
  const {
    step1,
    step2,
    step3,
    step2Enabled,
    step2AlreadyDone,
    step3Enabled,
    tokenGatingAddress,
    lastDeployResult,
    showRedeployWarning,
    handleLoadArtifacts,
    handleDeployTokenGating,
    handleDeployRegistry,
    handleRedeployIntent,
    handleRedeployCancel,
    handleRedeployConfirm,
  } = useDeployFlow(providers, onDeployed);

  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Rocket className="h-5 w-5 text-emerald-500" />
          Deploy DID Registry
        </CardTitle>
        <CardDescription className="text-zinc-400">
          Three-step deploy on {providers.networkId}: load artifacts, deploy the token gating
          contract, then deploy the DID registry using the token contract address.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md bg-blue-950/30 border border-blue-800 p-3">
          <p className="text-xs text-blue-300">
            Requires compiled Compact artifacts under{" "}
            <code>public/contracts/managed/did-registry</code> and{" "}
            <code>src/generated/token-gating</code>. Run{" "}
            <code>npm run compile-contract</code> if missing.
          </p>
        </div>

        {/* Step 1 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-zinc-300">Step 1: Load Artifacts</label>
            {step1.done && (
              <span className="text-xs text-emerald-400 flex items-center gap-1">
                <BadgeCheck className="h-3 w-3" /> Ready
              </span>
            )}
          </div>
          <Button
            type="button"
            onClick={handleLoadArtifacts}
            disabled={step1.loading}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white disabled:bg-zinc-700 disabled:cursor-not-allowed"
          >
            {step1.done ? (
              <><BadgeCheck className="h-4 w-4 mr-2" />Managed Assets Ready</>
            ) : step1.loading ? (
              "Checking..."
            ) : (
              <><Zap className="h-4 w-4 mr-2" />Load Managed Contracts</>
            )}
          </Button>
          {step1.message && (
            <div className="rounded-md border border-blue-800 bg-blue-950/30 p-2">
              <p className="text-xs text-blue-200">{step1.message}</p>
            </div>
          )}
          {step1.error && (
            <div className="rounded-md border border-red-800 bg-red-950/40 p-2">
              <p className="text-xs text-red-300">{step1.error}</p>
            </div>
          )}
        </div>

        {/* Step 2 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-zinc-300 flex items-center gap-1">
              {!step2Enabled && <Lock className="h-3 w-3 text-zinc-500" />}
              Step 2: Deploy Token Gating
            </label>
            {step2AlreadyDone && (
              <span className="text-xs text-emerald-400 flex items-center gap-1">
                <BadgeCheck className="h-3 w-3" /> Deployed
              </span>
            )}
          </div>

          {showRedeployWarning ? (
            <div className="rounded-md bg-red-950/40 border border-red-700 p-3 space-y-2">
              <p className="text-xs text-red-300 font-medium">
                A token gating contract is already deployed. Re-deploying will require you to also
                re-deploy the DID registry with the new token address. Existing registries will
                continue to work but will point to the old token contract.
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  onClick={handleRedeployCancel}
                  className="flex-1 bg-zinc-700 hover:bg-zinc-600 text-white text-xs h-8"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handleRedeployConfirm}
                  disabled={step2.loading}
                  className="flex-1 bg-red-700 hover:bg-red-600 text-white text-xs h-8"
                >
                  {step2.loading ? "Deploying..." : "I understand, re-deploy"}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              onClick={step2AlreadyDone ? handleRedeployIntent : handleDeployTokenGating}
              disabled={!step2Enabled || step2.loading}
              className="w-full bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {step2.loading
                ? "Deploying..."
                : step2AlreadyDone
                ? "Re-deploy Token Gating?"
                : "Deploy Token Gating Contract"}
            </Button>
          )}

          {tokenGatingAddress && (
            <div className="rounded-md border border-violet-800 bg-violet-950/30 p-2">
              <p className="text-xs text-zinc-400 mb-1">Token contract address:</p>
              <div className="flex items-center">
                <span className="text-xs font-mono text-violet-300 break-all">{tokenGatingAddress}</span>
                <CopyButton text={tokenGatingAddress} />
              </div>
            </div>
          )}
          {step2.message && !tokenGatingAddress && (
            <div className="rounded-md border border-violet-800 bg-violet-950/30 p-2">
              <p className="text-xs text-violet-200">{step2.message}</p>
            </div>
          )}
          {step2.error && (
            <div className="rounded-md border border-red-800 bg-red-950/40 p-2">
              <p className="text-xs text-red-300">{step2.error}</p>
            </div>
          )}
        </div>

        {/* Step 3 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-zinc-300 flex items-center gap-1">
              {!step3Enabled && <Lock className="h-3 w-3 text-zinc-500" />}
              Step 3: Deploy DID Registry
            </label>
            {step3.done && (
              <span className="text-xs text-emerald-400">Deployed</span>
            )}
          </div>
          <Button
            type="button"
            onClick={handleDeployRegistry}
            disabled={!step3Enabled || step3.loading}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {step3.loading ? "Deploying..." : "Deploy DID Registry Contract"}
          </Button>
          {step3.error && (
            <div className="rounded-md border border-red-800 bg-red-950/40 p-2">
              <p className="text-xs text-red-300">{step3.error}</p>
            </div>
          )}
        </div>

        {lastDeployResult && (
          <div className="rounded-md border border-emerald-800 bg-emerald-950/30 p-3">
            <p className="text-xs text-emerald-400 flex items-center gap-2">
              <BadgeCheck className="h-4 w-4" />
              Deployment confirmed on-chain
            </p>
            <p className="text-xs text-zinc-300 mt-1">
              <span className="text-zinc-500">Deploy Tx:</span>{" "}
              <span className="break-all font-mono">{lastDeployResult.txId || lastDeployResult.txHash}</span>
            </p>
            {lastDeployResult.txId && lastDeployResult.txHash && lastDeployResult.txId !== lastDeployResult.txHash && (
              <p className="text-xs text-zinc-300 mt-1">
                <span className="text-zinc-500">Deploy Tx Hash:</span>{" "}
                <a
                  href={explorerTxUrl(lastDeployResult.txHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all font-mono text-emerald-400 underline underline-offset-2"
                >
                  {lastDeployResult.txHash}
                </a>
              </p>
            )}
            <p className="text-xs text-zinc-300 mt-1">
              <span className="text-zinc-500">Initialization:</span>{" "}
              constructor-based
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
