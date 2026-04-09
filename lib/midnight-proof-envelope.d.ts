import type {
  MidnightProofRequest,
  MidnightProofSubmission,
} from "../src/types/service";

export function buildProofEnvelopePublicInputs(input: {
  proofRequest: MidnightProofRequest;
  submission: MidnightProofSubmission;
}): Record<string, unknown>;

export function createLocalPreviewProofSubmission(input: {
  proofRequest: MidnightProofRequest;
  submission: MidnightProofSubmission;
  generatedBy?: string;
}): Promise<MidnightProofSubmission>;

export function verifyLocalPreviewProofSubmission(input: {
  proofRequest: MidnightProofRequest;
  submission: MidnightProofSubmission;
}): Promise<{
  matches: boolean;
  reason: string | null;
  expectedPublicInputsHash?: string;
  expectedProofValue?: string;
}>;
