import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import type { DidRecord } from "../types/did";
import type { CredentialBundle, VerifiableCredentialRow } from "../types/service";
import {
  createCredentialBundle,
  listCredentialsByDid,
  verifyPresentation,
} from "../utils/serviceApi";

interface VcPanelProps {
  record: DidRecord | null;
}

export function VcPanel({ record }: VcPanelProps) {
  const [credentials, setCredentials] = useState<VerifiableCredentialRow[]>([]);
  const [bundle, setBundle] = useState<CredentialBundle | null>(null);
  const [verificationResult, setVerificationResult] = useState<string>("");
  const [message, setMessage] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>(["ownership"]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!record?.did || record.status !== "active") {
      setCredentials([]);
      setBundle(null);
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
      setVerificationResult("");
      setMessage(`Bundle created with ${nextBundle.verifiableCredentials.length} VC(s).`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to build VC bundle");
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
          </>
        )}

        {message && <p className="text-xs text-zinc-300">{message}</p>}
      </CardContent>
    </Card>
  );
}
