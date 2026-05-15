import { useEffect, useState } from "react";
import type { ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";
import type { AppProviders } from "../../lib/providers";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import type { DidRecord } from "../types/did";
import type {
  CredentialBundle,
  MidnightProofMaterial,
  MidnightProofVerificationPackage,
  ProofRequestRow,
  VerifiableCredentialRow,
} from "../types/service";
import {
  approveProofRequest,
  createCredentialBundle,
  createMidnightProofMaterial,
  createSignedCredentialBundle,
  createWalletProofRequest,
  listCredentialsByDid,
  rejectProofRequest,
  rotateCredentialsByDid,
  submitProofRequestProof,
  verifyPresentation,
} from "../utils/serviceApi";
import {
  isWalletApprovalRejected,
  signProofApprovalPayload,
} from "../lib/proof-approval";
import {
  createPreviewProofVerificationPackage,
  createProofVerificationPackage,
} from "../lib/proof-request";
import { canonicalize } from "../../lib/canonical-json.js";
import { createNativeOwnershipProofPackage } from "../lib/native-ownership-proof";
import { createLocalPreviewProofSubmission } from "../../lib/midnight-proof-envelope.js";

interface VcPanelProps {
  record: DidRecord | null;
  connectedApi: ConnectedAPI | null;
  walletAddress: string;
  providers: AppProviders | null;
}

export function VcPanel({
  record,
  connectedApi,
  walletAddress,
  providers,
}: VcPanelProps) {
  const [credentials, setCredentials] = useState<VerifiableCredentialRow[]>([]);
  const [bundle, setBundle] = useState<CredentialBundle | null>(null);
  const [proofMaterial, setProofMaterial] = useState<MidnightProofMaterial | null>(null);
  const [directProofRequest, setDirectProofRequest] = useState<ProofRequestRow | null>(null);
  const [proofVerificationPackage, setProofVerificationPackage] =
    useState<MidnightProofVerificationPackage | null>(null);
  const [proofPackageMode, setProofPackageMode] = useState<"native" | "preview" | null>(null);
  const [proofPackageFallbackReason, setProofPackageFallbackReason] = useState("");
  const [verificationResult, setVerificationResult] = useState<string>("");
  const [message, setMessage] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>(["ownership"]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!record?.did || record.status !== "active") {
      setCredentials([]);
      setBundle(null);
      setProofMaterial(null);
      setDirectProofRequest(null);
      setProofVerificationPackage(null);
      setProofPackageMode(null);
      setProofPackageFallbackReason("");
      return;
    }
    listCredentialsByDid(record.did)
      .then(setCredentials)
      .catch((error) => {
        console.error("[VcPanel] failed to load credentials", error);
        setCredentials([]);
      });
  }, [record?.did, record?.status]);

  function toggleScope(scope: string) {
    setSelectedScopes((current) =>
      current.includes(scope)
        ? current.filter((item) => item !== scope)
        : [...current, scope],
    );
  }

  async function copyJson(label: string, value: unknown) {
    try {
      await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
      setCopyMessage(`${label} copied.`);
      window.setTimeout(() => setCopyMessage(""), 2000);
    } catch {
      setCopyMessage(`Failed to copy ${label.toLowerCase()}.`);
      window.setTimeout(() => setCopyMessage(""), 2000);
    }
  }

  function getVerificationPackage(row: ProofRequestRow): MidnightProofVerificationPackage {
    return createProofVerificationPackage(row);
  }

  async function buildLocalPreviewPackage(row: ProofRequestRow) {
    const basePackage = createPreviewProofVerificationPackage(row);
    const previewSubmission = await createLocalPreviewProofSubmission({
      proofRequest: basePackage.proofRequest,
      submission: basePackage.submission,
    });
    return {
      proofRequest: basePackage.proofRequest,
      submission: previewSubmission,
    };
  }

  async function buildBestProofPackage(row: ProofRequestRow): Promise<{
    package: MidnightProofVerificationPackage;
    mode: "native" | "preview";
    fallbackReason?: string;
  }> {
    if (providers && row.proof_material.nativeOwnership) {
      try {
        return {
          package: await createNativeOwnershipProofPackage(providers, row),
          mode: "native",
        };
      } catch (error) {
        console.warn("[VcPanel] native ownership proof generation failed, falling back to preview envelope", error);
        return {
          package: await buildLocalPreviewPackage(row),
          mode: "preview",
          fallbackReason: error instanceof Error ? error.message : String(error),
        };
      }
    }
    return {
      package: await buildLocalPreviewPackage(row),
      mode: "preview",
      fallbackReason: !providers
        ? "Wallet providers were not ready for native proof generation."
        : "Native ownership proof material was not available for this request.",
    };
  }

  async function handleBuildBundle() {
    if (!record?.did) return;
    setLoading(true);
    setMessage("");
    try {
      const nextBundle = await createCredentialBundle({
        did: record.did,
        scopes: selectedScopes,
      });
      setBundle(nextBundle);
      setProofMaterial(null);
      setVerificationResult("");
      setMessage(`Bundle created with ${nextBundle.verifiableCredentials.length} VC(s).`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to build VC bundle");
    } finally {
      setLoading(false);
    }
  }

  async function handleBuildSignedPresentation() {
    if (!record?.did || !connectedApi) return;
    setLoading(true);
    setMessage("");
    try {
      const material = await createMidnightProofMaterial({
        did: record.did,
        scopes: selectedScopes,
        purpose: "selective-disclosure",
      });

      const payloadToSign = canonicalize({
        holder: record.did,
        challenge: material.challenge ?? null,
        verifier: material.verifier ?? null,
        purpose: material.purpose ?? null,
        bundleCommitment: material.bundleCommitment ?? null,
        holderBindingCommitment: material.holderBindingCommitment ?? null,
      });

      const holderSignatureEnvelope = await signProofApprovalPayload(connectedApi, payloadToSign);

      const signedBundle = await createSignedCredentialBundle({
        did: record.did,
        scopes: selectedScopes,
        challenge: material.challenge,
        verifier: material.verifier,
        purpose: material.purpose,
        bundleCommitment: material.bundleCommitment,
        holderBindingCommitment: material.holderBindingCommitment,
        holderSignatureEnvelope,
      });

      setBundle(signedBundle);
      setProofMaterial(material);
      setVerificationResult("");
      setMessage(
        `Signed Verifiable Presentation assembled with ${signedBundle.verifiableCredentials.length} VC(s) and holder proof.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Failed to build signed presentation",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleBuildMidnightProofMaterial() {
    if (!record?.did) return;
    setLoading(true);
    setMessage("");
    try {
      const nextMaterial = await createMidnightProofMaterial({
        did: record.did,
        scopes: selectedScopes,
        purpose: "selective-disclosure",
      });
      setProofMaterial(nextMaterial);
      setMessage(
        `Midnight proof material created with ${nextMaterial.credentialCount} credential commitment(s).`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Failed to build Midnight proof material",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateAndApproveProofRequest() {
    if (!record?.did || !walletAddress) return;
    setLoading(true);
    setMessage("");
    let proofRequest: ProofRequestRow | null = null;
    try {
      if (!connectedApi) {
        throw new Error("Wallet not connected.");
      }
      proofRequest = await createWalletProofRequest({
        walletAddress,
        did: record.did,
        scopes: selectedScopes,
        purpose: "selective-disclosure",
      });
      const holderSignature = await signProofApprovalPayload(
        connectedApi,
        proofRequest.approval_payload,
      );
      const approved = await approveProofRequest(
        proofRequest.id,
        walletAddress,
        holderSignature,
      );
      const generatedPackage = await buildBestProofPackage(approved);
      const submitted = await submitProofRequestProof(
        approved.id,
        generatedPackage.package.submission,
      );
      setDirectProofRequest(submitted.proofRequest);
      setProofVerificationPackage({
        proofRequest: generatedPackage.package.proofRequest,
        submission:
          submitted.proofRequest.proof_submission as unknown as MidnightProofVerificationPackage["submission"],
      });
      setProofPackageMode(generatedPackage.mode);
      setProofPackageFallbackReason(generatedPackage.fallbackReason || "");
      setMessage(
        generatedPackage.mode === "native"
          ? `Proof request ${approved.id} approved by the connected wallet. A native Midnight ownership proof was generated, persisted, and is ready for registry verification.`
          : `Proof request ${approved.id} approved by the connected wallet. Native proof generation failed, so a preview verification package was generated, persisted, and is ready for registry verification instead.${generatedPackage.fallbackReason ? ` Reason: ${generatedPackage.fallbackReason}` : ""}`,
      );
    } catch (error) {
      if (proofRequest && isWalletApprovalRejected(error)) {
        try {
          await rejectProofRequest(
            proofRequest.id,
            walletAddress,
            "Rejected by holder wallet during direct proof approval.",
          );
          setMessage(
            `Proof request ${proofRequest.id} was rejected in the wallet and has been marked as rejected.`,
          );
          setDirectProofRequest(null);
          setProofVerificationPackage(null);
          setProofPackageMode(null);
          setProofPackageFallbackReason("");
          return;
        } catch (rejectError) {
          setMessage(
            rejectError instanceof Error
              ? rejectError.message
              : "Wallet rejected the proof request, but cleanup failed.",
          );
          return;
        }
      }
      setMessage(
        error instanceof Error
          ? error.message
          : "Failed to create and approve proof request",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleRotateCredentials() {
    if (!record?.did) return;
    setLoading(true);
    setMessage("");
    try {
      const result = await rotateCredentialsByDid({
        did: record.did,
      });
      const nextCredentials = await listCredentialsByDid(record.did);
      setCredentials(nextCredentials);
      setBundle(null);
      setProofMaterial(null);
      setDirectProofRequest(null);
      setProofVerificationPackage(null);
      setProofPackageMode(null);
      setProofPackageFallbackReason("");
      setVerificationResult("");
      setMessage(
        `Rotated JWT credentials for ${result.did}. Revoked ${result.revokedCount} and issued ${result.issuedCount} new credential(s).`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Failed to rotate credentials",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyBundle() {
    if (!bundle?.presentation) return;
    setLoading(true);
    setMessage("");
    try {
      const result = await verifyPresentation({
        presentation: bundle.presentation,
      });
      setVerificationResult(
        result.warning
          ? `Presentation verified. ${result.warning}`
          : "Presentation verified.",
      );
    } catch (error) {
      setVerificationResult(
        error instanceof Error ? error.message : "Failed to verify presentation",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardHeader>
        <CardTitle className="text-white">Verifiable Credentials</CardTitle>
        <CardDescription className="text-zinc-400">
          The agent can disclose only the credential scopes it chooses by presenting selected VC JWTs.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!record?.did || record.status !== "active" ? (
          <p className="text-zinc-400 text-sm">
            VC issuance becomes available after the DID is active.
          </p>
        ) : (
          <>
            <div className="space-y-2 text-xs text-zinc-300">
              {credentials.length === 0 ? (
                <p className="text-zinc-500">No credentials loaded yet for this DID.</p>
              ) : (
                credentials.map((credential) => (
                  <div
                    key={credential.id}
                    className="rounded-md border border-zinc-800 bg-zinc-950 p-3"
                  >
                    <div className="font-semibold text-white">
                      {credential.credential_type}
                    </div>
                    <div>Scope: {credential.disclosure_scope}</div>
                    <div>Status: {credential.status}</div>
                    <div className="font-mono break-all text-zinc-400">
                      {credential.jwt}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="space-y-2 text-xs text-zinc-300">
              <div className="font-semibold text-white">Disclosure Bundle</div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectedScopes.includes("ownership")}
                  onChange={() => toggleScope("ownership")}
                />
                ownership
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectedScopes.includes("name")}
                  onChange={() => toggleScope("name")}
                />
                name
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectedScopes.includes("organization")}
                  onChange={() => toggleScope("organization")}
                />
                organization
              </label>

              <Button
                type="button"
                onClick={handleBuildBundle}
                disabled={loading}
                className="bg-emerald-600 hover:bg-emerald-500 text-white"
              >
                {loading ? "Building..." : "Build Disclosure Bundle"}
              </Button>
              <Button
                type="button"
                onClick={handleBuildSignedPresentation}
                disabled={loading || !connectedApi || !walletAddress}
                className="bg-teal-700 hover:bg-teal-600 text-white"
              >
                {loading ? "Signing..." : "Build Signed Presentation"}
              </Button>
              <Button
                type="button"
                onClick={handleBuildMidnightProofMaterial}
                disabled={loading}
                className="bg-sky-700 hover:bg-sky-600 text-white"
              >
                {loading ? "Building..." : "Build Midnight Proof Material"}
              </Button>
              <Button
                type="button"
                onClick={handleRotateCredentials}
                disabled={loading}
                className="bg-indigo-700 hover:bg-indigo-600 text-white"
              >
                {loading ? "Rotating..." : "Rotate JWT VCs"}
              </Button>
              <Button
                type="button"
                onClick={handleCreateAndApproveProofRequest}
                disabled={loading || !connectedApi || !walletAddress}
                className="bg-amber-700 hover:bg-amber-600 text-white"
              >
                {loading ? "Signing..." : "Approve Proof with Connected Wallet"}
              </Button>
            </div>

            {bundle && (
              <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300 space-y-2">
                <div>Holder: {bundle.holder}</div>
                <div>Scopes: {bundle.disclosedScopes.join(", ") || "none"}</div>
                <div className="font-mono break-all">
                  {JSON.stringify(bundle.presentation, null, 2)}
                </div>
                <Button
                  type="button"
                  onClick={handleVerifyBundle}
                  disabled={loading}
                  className="bg-zinc-800 hover:bg-zinc-700 text-white"
                >
                  {loading ? "Verifying..." : "Verify Presentation"}
                </Button>
                {verificationResult && (
                  <div className="text-zinc-300">{verificationResult}</div>
                )}
              </div>
            )}

            {proofMaterial && (
              <div className="rounded-md border border-sky-900 bg-zinc-950 p-3 text-xs text-zinc-300 space-y-2">
                <div className="font-semibold text-white">Midnight Proof Material</div>
                <div>Challenge: <span className="font-mono break-all">{proofMaterial.challenge}</span></div>
                <div>Purpose: {proofMaterial.purpose}</div>
                <div>Bundle Commitment: <span className="font-mono break-all">{proofMaterial.bundleCommitment}</span></div>
                <div>Holder Binding Commitment: <span className="font-mono break-all">{proofMaterial.holderBindingCommitment}</span></div>
                <div className="text-zinc-400">
                  This package is the boundary for holder-side Midnight proving. The final proof should be generated in the holder wallet or local proof server, not by the registry service.
                </div>
                <div className="space-y-2">
                  {proofMaterial.credentialCommitments.map((item) => (
                    <div
                      key={`${item.scope}:${item.commitment}`}
                      className="rounded border border-zinc-800 p-2"
                    >
                      <div className="text-white">{item.credentialType}</div>
                      <div>Scope: {item.scope}</div>
                      <div>Claims: {item.claimKeys.join(", ") || "none"}</div>
                      <div className="font-mono break-all">{item.commitment}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {directProofRequest && (
              <div className="rounded-md border border-amber-900 bg-zinc-950 p-3 text-xs text-zinc-300 space-y-2">
                <div className="font-semibold text-white">Wallet-Approved Proof Request</div>
                <div>ID: <span className="font-mono break-all">{directProofRequest.id}</span></div>
                <div>Status: {directProofRequest.request_status}</div>
                <div>
                  Proof Mode:{" "}
                  <span className={proofPackageMode === "native" ? "text-emerald-300" : "text-amber-300"}>
                    {proofPackageMode === "native" ? "Native" : "Preview"}
                  </span>
                </div>
                <div>Holder wallet: <span className="font-mono break-all">{directProofRequest.holder_wallet_address}</span></div>
                <div>Challenge: <span className="font-mono break-all">{directProofRequest.challenge}</span></div>
                <div className="text-zinc-400">
                  {proofPackageMode === "native"
                    ? "This request is now wallet-authorized and includes a native Midnight proof package."
                    : "This request is now wallet-authorized, but native proof generation failed and the package below contains a preview proof envelope for end-to-end testing."}
                </div>
                {proofPackageMode === "preview" && proofPackageFallbackReason && (
                  <div className="rounded-md border border-amber-800 bg-amber-950/20 p-2 text-amber-200">
                    Native proof generation fallback reason: {proofPackageFallbackReason}
                  </div>
                )}
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-white">Proof Verification Package JSON</div>
                    <Button
                      type="button"
                      variant="outline"
                      className="border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
                      onClick={() =>
                        copyJson(
                          "Proof verification package JSON",
                          proofVerificationPackage || getVerificationPackage(directProofRequest),
                        )
                      }
                    >
                      Copy
                    </Button>
                  </div>
                  <textarea
                    readOnly
                    value={JSON.stringify(
                      proofVerificationPackage || getVerificationPackage(directProofRequest),
                      null,
                      2,
                    )}
                    className="min-h-[22rem] w-full rounded border border-zinc-800 bg-black/30 p-2 font-mono text-[11px] text-zinc-300"
                  />
                </div>
                {copyMessage && <div className="text-zinc-400">{copyMessage}</div>}
              </div>
            )}
          </>
        )}

        {message && <p className="text-xs text-zinc-300">{message}</p>}
      </CardContent>
    </Card>
  );
}
