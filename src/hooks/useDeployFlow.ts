import { useState } from "react";
import type { AppProviders } from "../../lib/providers";
import type { DeployResult } from "../types/did";
import { compileDidRegistry, deployUnifiedRegistry } from "../lib/did/app-api";
import { getSavedCompileArtifact, getSavedDeployment } from "../lib/did/cache";

export type StepState = {
  loading: boolean;
  error: string;
  message: string;
  done: boolean;
};

export type UseDeployFlowReturn = {
  step1: StepState;
  step3: StepState;
  lastDeployResult: DeployResult | null;
  handleLoadArtifacts: () => Promise<void>;
  handleDeployUnified: () => Promise<void>;
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
  const [step3, setStep3] = useState<StepState>({
    ...initialStep,
    done: !!getSavedDeployment(),
  });
  const [lastDeployResult, setLastDeployResult] = useState<DeployResult | null>(
    getSavedDeployment(),
  );

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

  return { step1, step3, lastDeployResult, handleLoadArtifacts, handleDeployUnified };
}
