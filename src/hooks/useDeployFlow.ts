import { useState } from "react";
import type { AppProviders } from "../../lib/providers";
import type { DeployResult } from "../types/did";
import {
  compileDidRegistry,
  deployTokenGating,
  deployDidRegistry,
  deployUnifiedRegistry,
} from "../lib/did/app-api";
import {
  getSavedCompileArtifact,
  getSavedDeployment,
  getSavedTokenDeployment,
  clearTokenDeployment,
} from "../lib/did/cache";

export type StepState = {
  loading: boolean;
  error: string;
  message: string;
  done: boolean;
};

export type UseDeployFlowReturn = {
  step1: StepState;
  step2: StepState;
  step3: StepState;

  step2Enabled: boolean;
  step2AlreadyDone: boolean;
  step3Enabled: boolean;

  tokenGatingAddress: string | null;
  lastDeployResult: DeployResult | null;

  showRedeployWarning: boolean;

  handleLoadArtifacts: () => Promise<void>;
  handleDeployTokenGating: () => Promise<void>;
  handleDeployRegistry: () => Promise<void>;
  handleDeployUnified: () => Promise<void>;
  handleRedeployIntent: () => void;
  handleRedeployCancel: () => void;
  handleRedeployConfirm: () => Promise<void>;
};

const initialStep: StepState = { loading: false, error: "", message: "", done: false };

export function useDeployFlow(
  providers: AppProviders,
  onDeployed: (result: DeployResult) => void,
): UseDeployFlowReturn {
  const [step1, setStep1] = useState<StepState>({
    ...initialStep,
    done: !!getSavedCompileArtifact(),
  });
  const [step2, setStep2] = useState<StepState>(initialStep);
  const [step3, setStep3] = useState<StepState>({
    ...initialStep,
    done: !!getSavedDeployment(),
  });

  const [tokenGatingAddress, setTokenGatingAddress] = useState<string | null>(
    getSavedTokenDeployment()?.contractAddress ?? null,
  );
  const [lastDeployResult, setLastDeployResult] = useState<DeployResult | null>(
    getSavedDeployment(),
  );
  const [showRedeployWarning, setShowRedeployWarning] = useState(false);

  const step2Enabled = step1.done;
  const step2AlreadyDone = !!tokenGatingAddress;
  const step3Enabled = step1.done && !!tokenGatingAddress;

  async function handleLoadArtifacts(): Promise<void> {
    setStep1((s) => ({ ...s, loading: true, error: "", message: "" }));
    try {
      const result = await compileDidRegistry(providers);
      setStep1({ loading: false, error: "", message: result.message, done: true });
    } catch (e) {
      setStep1((s) => ({
        ...s,
        loading: false,
        error: e instanceof Error ? e.message : "Failed to load artifacts",
        done: false,
      }));
    }
  }

  async function handleDeployTokenGating(): Promise<void> {
    if (!step2Enabled) return;
    setStep2((s) => ({ ...s, loading: true, error: "", message: "" }));
    try {
      const result = await deployTokenGating(providers);
      setTokenGatingAddress(result.contractAddress);
      setShowRedeployWarning(false);
      setStep2({
        loading: false,
        error: "",
        message: result.message ?? "Token gating contract deployed.",
        done: true,
      });
    } catch (e) {
      setStep2((s) => ({
        ...s,
        loading: false,
        error: e instanceof Error ? e.message : "Deployment failed",
      }));
    }
  }

  async function handleDeployRegistry(): Promise<void> {
    if (!step3Enabled || !tokenGatingAddress) {
      throw new Error("Token gating contract must be deployed first (Step 2)");
    }
    setStep3((s) => ({ ...s, loading: true, error: "", message: "" }));
    try {
      const result = await deployDidRegistry(providers, tokenGatingAddress);
      setLastDeployResult(result);
      setStep3({
        loading: false,
        error: "",
        message: result.message ?? "DID Registry deployed.",
        done: true,
      });
      onDeployed(result);
    } catch (e) {
      setStep3((s) => ({
        ...s,
        loading: false,
        error: e instanceof Error ? e.message : "Deployment failed",
      }));
    }
  }

  /**
   * Deploy the unified v3 contract (token gating + DID registry in one).
   * Uses step3 state slot; step2 is skipped in the unified flow.
   */
  async function handleDeployUnified(): Promise<void> {
    if (!step1.done) return;
    setStep3((s) => ({ ...s, loading: true, error: "", message: "" }));
    try {
      const result = await deployUnifiedRegistry(providers);
      setLastDeployResult(result);
      setStep3({
        loading: false,
        error: "",
        message: result.message ?? "Unified registry deployed.",
        done: true,
      });
      onDeployed(result);
    } catch (e) {
      setStep3((s) => ({
        ...s,
        loading: false,
        error: e instanceof Error ? e.message : "Deployment failed",
      }));
    }
  }

  function handleRedeployIntent(): void {
    setShowRedeployWarning(true);
  }

  function handleRedeployCancel(): void {
    setShowRedeployWarning(false);
  }

  async function handleRedeployConfirm(): Promise<void> {
    clearTokenDeployment();
    setTokenGatingAddress(null);
    setShowRedeployWarning(false);
    setStep2(initialStep);
    await handleDeployTokenGating();
  }

  return {
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
    handleDeployUnified,
    handleRedeployIntent,
    handleRedeployCancel,
    handleRedeployConfirm,
  };
}
