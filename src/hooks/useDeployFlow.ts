import { useState } from "react";
import type { AppProviders } from "../../lib/providers";
import type { DeployResult } from "../types/did";
import { compileDidRegistry, deployUnifiedRegistry, initializeAdmin } from "../lib/did/app-api";
import { getSavedCompileArtifact, getSavedDeployment, saveDeployment } from "../lib/did/cache";

export type StepState = {
  loading: boolean;
  error: string;
  message: string;
  done: boolean;
};

export type UseDeployFlowReturn = {
  step1: StepState;
  step3: StepState;
  step4: StepState;
  lastDeployResult: DeployResult | null;
  handleLoadArtifacts: () => Promise<void>;
  handleDeployUnified: () => Promise<void>;
  handleInitAdmin: () => Promise<void>;
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
  const savedDeployment = getSavedDeployment(providers.networkId);
  const [step3, setStep3] = useState<StepState>({
    ...initialStep,
    done: !!savedDeployment,
  });
  const [step4, setStep4] = useState<StepState>({
    ...initialStep,
    done: !!savedDeployment?.initializeTxHash,
  });
  const [lastDeployResult, setLastDeployResult] = useState<DeployResult | null>(
    savedDeployment,
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
    setStep4(initialStep);
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
      console.error("[useDeployFlow] Deployment failed:", e);
      setStep3((s) => ({
        ...s,
        loading: false,
        error: e instanceof Error ? e.message : "Deployment failed",
      }));
    }
  }

  async function handleInitAdmin(): Promise<void> {
    if (!lastDeployResult?.contractAddress) return;
    setStep4((s) => ({ ...s, loading: true, error: "", message: "" }));
    try {
      const { initializeTxHash, initializeTxId } = await initializeAdmin(
        providers,
        lastDeployResult.contractAddress,
      );
      const updated: DeployResult = {
        ...lastDeployResult,
        initializeTxHash,
        initializeTxId,
      };
      setLastDeployResult(updated);
      saveDeployment({
        ...updated,
        networkId: providers.networkId,
        deployedAt: updated.deployedAt || new Date().toISOString(),
      });
      setStep4({
        loading: false,
        error: "",
        message: "Admin token minted in a second transaction.",
        done: true,
      });
      onDeployed(updated);
    } catch (e) {
      console.error("[useDeployFlow] Admin initialization failed:", e);
      setStep4((s) => ({
        ...s,
        loading: false,
        error: e instanceof Error ? e.message : "Admin initialization failed",
      }));
    }
  }

  return {
    step1,
    step3,
    step4,
    lastDeployResult,
    handleLoadArtifacts,
    handleDeployUnified,
    handleInitAdmin,
  };
}
