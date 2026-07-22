import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { BadgeCheck, Lock, Rocket, Zap } from "lucide-react";
import type { AppProviders } from "../../lib/providers";
import type { DeployResult } from "../types/did";
import { explorerTxUrl } from "../lib/explorer";
import { useDeployFlow } from "../hooks/useDeployFlow";

interface DeployPanelProps {
  providers: AppProviders;
  onDeployed: (result: DeployResult) => void;
}

export function DeployPanel({ providers, onDeployed }: DeployPanelProps) {
  const {
    step1,
    step3,
    step4,
    lastDeployResult,
    handleLoadArtifacts,
    handleDeployUnified,
    handleInitAdmin,
  } = useDeployFlow(providers, onDeployed);

  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Rocket className="h-5 w-5 text-emerald-500" />
          Deploy DID Registry
        </CardTitle>
        <CardDescription className="text-zinc-400">
          Three-step deploy on {providers.networkId}: load compiled artifacts, deploy the unified
          registry contract, then initialize the admin token as its own separate transaction.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md bg-blue-950/30 border border-blue-800 p-3">
          <p className="text-xs text-blue-300">
            Requires locally compiled Compact artifacts under{" "}
            <code>public/contracts/managed</code> and{" "}
            <code>src/generated</code>. Run{" "}
            <code>npm run compile-all</code> if missing.
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

        {/* Step 2 — Unified deploy */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-zinc-300 flex items-center gap-1">
              {!step1.done && <Lock className="h-3 w-3 text-zinc-500" />}
              Step 2: Deploy Unified Registry
            </label>
            {step3.done && (
              <span className="text-xs text-emerald-400 flex items-center gap-1">
                <BadgeCheck className="h-3 w-3" /> Deployed
              </span>
            )}
          </div>
          <Button
            type="button"
            onClick={handleDeployUnified}
            disabled={!step1.done || step3.loading}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {step3.loading
              ? "Deploying..."
              : step3.done
              ? "Re-deploy Unified Registry"
              : "Deploy Unified Registry Contract"}
          </Button>
          {step3.message && (
            <div className="rounded-md border border-emerald-800 bg-emerald-950/30 p-2">
              <p className="text-xs text-emerald-200">{step3.message}</p>
            </div>
          )}
          {step3.error && (
            <div className="rounded-md border border-red-800 bg-red-950/40 p-2">
              <p className="text-xs text-red-300">{step3.error}</p>
            </div>
          )}
        </div>

        {/* Step 3 — Initialize Admin (second, separate transaction) */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-zinc-300 flex items-center gap-1">
              {!step3.done && <Lock className="h-3 w-3 text-zinc-500" />}
              Step 3: Initialize Admin
            </label>
            {step4.done && (
              <span className="text-xs text-emerald-400 flex items-center gap-1">
                <BadgeCheck className="h-3 w-3" /> Admin Initialized
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-500">
            Mints the genesis admin token in a second, separate transaction. First caller to run
            this after deploy becomes admin — retry here any time, no need to redeploy.
          </p>
          <Button
            type="button"
            onClick={handleInitAdmin}
            disabled={!step3.done || step4.loading}
            className="w-full bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {step4.loading
              ? "Initializing..."
              : step4.done
              ? "Re-run Initialize Admin"
              : "Initialize Admin"}
          </Button>
          {step4.message && (
            <div className="rounded-md border border-emerald-800 bg-emerald-950/30 p-2">
              <p className="text-xs text-emerald-200">{step4.message}</p>
            </div>
          )}
          {step4.error && (
            <div className="rounded-md border border-red-800 bg-red-950/40 p-2">
              <p className="text-xs text-red-300">{step4.error}</p>
            </div>
          )}
        </div>

        {lastDeployResult && (
          <div className="rounded-md border border-emerald-800 bg-emerald-950/30 p-3">
            <p className="text-xs text-emerald-400 flex items-center gap-2">
              <BadgeCheck className="h-4 w-4" />
              Deployment confirmed on-chain
            </p>
            {lastDeployResult.txHash && (
              <p className="text-xs text-zinc-300 mt-1">
                <span className="text-zinc-500">Deploy Tx:</span>{" "}
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
            {lastDeployResult.contractAddress && (
              <p className="text-xs text-zinc-300 mt-1">
                <span className="text-zinc-500">Contract:</span>{" "}
                <span className="break-all font-mono">{lastDeployResult.contractAddress}</span>
              </p>
            )}
            {lastDeployResult.initializeTxHash && (
              <p className="text-xs text-zinc-300 mt-1">
                <span className="text-zinc-500">Admin Init Tx:</span>{" "}
                <a
                  href={explorerTxUrl(lastDeployResult.initializeTxHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all font-mono text-emerald-400 underline underline-offset-2"
                >
                  {lastDeployResult.initializeTxHash}
                </a>
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
