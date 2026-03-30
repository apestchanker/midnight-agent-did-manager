import { useState } from "react";
import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { BadgeCheck, Rocket, Zap } from "lucide-react";
import type { AppProviders } from "../../lib/providers";
import type { DeployResult } from "../types/did";
import { explorerTxUrl } from "../lib/explorer";
import {
  compileDidRegistry,
  deployDidRegistry,
  getSavedCompileArtifact,
  getSavedDeployment,
} from "../lib/didContract";

interface DeployPanelProps {
  providers: AppProviders;
  onDeployed: (result: DeployResult) => void;
}

export function DeployPanel({ providers, onDeployed }: DeployPanelProps) {
  const [compiling, setCompiling] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [compileError, setCompileError] = useState("");
  const [deployError, setDeployError] = useState("");
  const [compileMessage, setCompileMessage] = useState("");
  const [deployMessage, setDeployMessage] = useState("");
  const [compiled, setCompiled] = useState(!!getSavedCompileArtifact());
  const [lastDeploy, setLastDeploy] = useState<DeployResult | null>(
    getSavedDeployment(),
  );
  const [lastTx, setLastTx] = useState(
    getSavedDeployment()?.txHash || "",
  );

  async function handleCompile() {
    setCompiling(true);
    setCompileError("");
    setCompileMessage("");
    try {
      const result = await compileDidRegistry(providers);
      if (result.success) {
        setCompiled(true);
        setCompileMessage(result.message);
        console.log("[DeployPanel] ✅ Compile successful");
      } else {
        setCompileError(result.message);
      }
    } catch (e) {
      setCompileError(e instanceof Error ? e.message : "Compilation failed");
    } finally {
      setCompiling(false);
    }
  }

  async function handleDeploy() {
    if (!compiled) {
      setDeployError("Please compile the contract first");
      return;
    }

    setDeploying(true);
    setDeployError("");
    setDeployMessage("");
    try {
      const result = await deployDidRegistry(providers);
      setLastTx(result.txHash);
      setLastDeploy(result);
      setDeployMessage(result.message || "");
      onDeployed(result);
    } catch (e) {
      setDeployError(e instanceof Error ? e.message : "Deployment failed");
    } finally {
      setDeploying(false);
    }
  }

  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Rocket className="h-5 w-5 text-emerald-500" />
          Deploy DID Registry
        </CardTitle>
        <CardDescription className="text-zinc-400">
          Validate the managed Compact build and deploy the registry to{" "}
          {providers.networkId}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md bg-blue-950/30 border border-blue-800 p-3">
          <p className="text-xs text-blue-300">
            This flow expects a real Compact managed build under
            `public/contracts/managed/did-registry`. If that directory is
            missing, run `npm run compile-contract` first.
          </p>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-zinc-300">
              Step 1: Load Artifact
            </label>
            {compiled && (
              <span className="text-xs text-emerald-400 flex items-center gap-1">
                <BadgeCheck className="h-3 w-3" /> Compiled
              </span>
            )}
          </div>
          <Button
            type="button"
            onClick={handleCompile}
            disabled={compiling}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white disabled:bg-zinc-700 disabled:cursor-not-allowed"
          >
            {compiled ? (
              <>
                <BadgeCheck className="h-4 w-4 mr-2" />
                Managed Assets Ready
              </>
            ) : compiling ? (
              "Checking..."
            ) : (
              <>
                <Zap className="h-4 w-4 mr-2" />
                Load Managed Contract
              </>
            )}
          </Button>
          {compileMessage && (
            <div className="rounded-md border border-blue-800 bg-blue-950/30 p-2">
              <p className="text-xs text-blue-200">{compileMessage}</p>
            </div>
          )}
          {compileError && (
            <div className="rounded-md border border-red-800 bg-red-950/40 p-2">
              <p className="text-xs text-red-300">{compileError}</p>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-zinc-300">
              Step 2: Deploy Registry
            </label>
            {lastTx && (
              <span className="text-xs text-emerald-400">Deployed</span>
            )}
          </div>
          <Button
            type="button"
            onClick={handleDeploy}
            disabled={deploying || !compiled}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {deploying ? "Deploying..." : "Deploy DID Registry Contract"}
          </Button>
          {deployMessage && (
            <div className="rounded-md border border-amber-800 bg-amber-950/30 p-2">
              <p className="text-xs text-amber-200">{deployMessage}</p>
            </div>
          )}
          {deployError && (
            <div className="rounded-md border border-red-800 bg-red-950/40 p-2">
              <p className="text-xs text-red-300">{deployError}</p>
            </div>
          )}
        </div>

        {lastTx && (
          <div className="rounded-md border border-emerald-800 bg-emerald-950/30 p-3">
              <p className="text-xs text-emerald-400 flex items-center gap-2">
                <BadgeCheck className="h-4 w-4" />
              Deployment confirmed on-chain
              </p>
            <p className="text-xs text-zinc-300 mt-1">
              <span className="text-zinc-500">Deploy Tx:</span>{" "}
              <a
                href={explorerTxUrl(lastDeploy?.txId || lastTx)}
                target="_blank"
                rel="noreferrer"
                className="break-all font-mono text-emerald-400 underline underline-offset-2"
              >
                {lastDeploy?.txId || lastTx}
              </a>
            </p>
            {lastDeploy?.txId && lastDeploy.txHash && lastDeploy.txId !== lastDeploy.txHash && (
              <p className="text-xs text-zinc-300 mt-1">
                <span className="text-zinc-500">Deploy Tx Hash:</span>{" "}
                <span className="break-all font-mono">{lastDeploy.txHash}</span>
              </p>
            )}
            {lastDeploy?.initializeTxHash && (
              <p className="text-xs text-zinc-300 mt-1">
                <span className="text-zinc-500">Initialize Tx:</span>{" "}
                <a
                  href={explorerTxUrl(lastDeploy.initializeTxId || lastDeploy.initializeTxHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all font-mono text-emerald-400 underline underline-offset-2"
                >
                  {lastDeploy.initializeTxId || lastDeploy.initializeTxHash}
                </a>
              </p>
            )}
            {lastDeploy?.initializeTxId &&
              lastDeploy.initializeTxHash &&
              lastDeploy.initializeTxId !== lastDeploy.initializeTxHash && (
                <p className="text-xs text-zinc-300 mt-1">
                  <span className="text-zinc-500">Initialize Tx Hash:</span>{" "}
                  <span className="break-all font-mono">
                    {lastDeploy.initializeTxHash}
                  </span>
                </p>
              )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
