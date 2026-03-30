import { useCallback, useEffect, useState } from "react";
import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import type { DidRecord } from "../types/did";

interface IssuerPanelProps {
  contractAddress: string;
  targetAgentAddress: string;
  record: DidRecord | null;
  onIssue: (payload: { agentAddress: string; didDocument: string }) => Promise<DidRecord>;
  onUpdate: (payload: { agentAddress: string; didDocument: string }) => Promise<DidRecord>;
  onRevoke: (payload: { agentAddress: string; reason: string }) => Promise<DidRecord>;
}

export function IssuerPanel({
  contractAddress,
  targetAgentAddress,
  record,
  onIssue,
  onUpdate,
  onRevoke,
}: IssuerPanelProps) {
  const [agentAddress, setAgentAddress] = useState(targetAgentAddress);
  const [didDocument, setDidDocument] = useState("");
  const [revocationReason, setRevocationReason] = useState("");
  const [loadingAction, setLoadingAction] = useState<"issue" | "update" | "revoke" | "">("");
  const [message, setMessage] = useState("");

  const buildDefaultDidDocument = useCallback((): string => {
    if (record?.didDocument?.trim()) {
      return record.didDocument;
    }
    return JSON.stringify(
        {
          id:
          record?.did ||
          `did:midnight:preprod:${contractAddress || "contract"}:${agentAddress || "agent"}`,
        controller: agentAddress || targetAgentAddress,
        agentName: record?.agentName || null,
        organization:
          record?.organizationDisclosure === "disclosed"
            ? record?.organization || "Matrix Labs"
            : "undisclosed",
        service: [
          {
            id: "#agent-endpoint",
            type: "AgentEndpoint",
            serviceEndpoint: "https://agent.example.com",
          },
        ],
        proofCommitment: record?.proofCommitmentHex || null,
      },
      null,
      2,
    );
  }, [
    agentAddress,
    contractAddress,
    record?.agentName,
    record?.did,
    record?.didDocument,
    record?.organization,
    record?.organizationDisclosure,
    record?.proofCommitmentHex,
    targetAgentAddress,
  ]);

  useEffect(() => {
    setAgentAddress(targetAgentAddress);
  }, [targetAgentAddress]);

  useEffect(() => {
    setDidDocument(buildDefaultDidDocument());
  }, [buildDefaultDidDocument]);

  async function handleIssue() {
    setMessage("");
    if (!contractAddress.trim()) {
      setMessage("Deploy or paste a contract address first.");
      return;
    }
    if (!agentAddress.trim()) {
      setMessage("Target agent wallet address is required.");
      return;
    }
    if (!didDocument.trim()) {
      setMessage("A DID document payload is required.");
      return;
    }

    setLoadingAction("issue");
    try {
      const updated = await onIssue({ agentAddress, didDocument });
      setMessage(`DID issued on-chain. Tx: ${updated.txHash || "confirmed"}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to issue DID");
    } finally {
      setLoadingAction("");
    }
  }

  async function handleUpdate() {
    setMessage("");
    if (!contractAddress.trim()) {
      setMessage("Deploy or paste a contract address first.");
      return;
    }
    if (!agentAddress.trim()) {
      setMessage("Target agent wallet address is required.");
      return;
    }
    if (!didDocument.trim()) {
      setMessage("A DID document payload is required.");
      return;
    }

    setLoadingAction("update");
    try {
      const updated = await onUpdate({ agentAddress, didDocument });
      setMessage(`DID updated on-chain. Tx: ${updated.txHash || "confirmed"}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to update DID");
    } finally {
      setLoadingAction("");
    }
  }

  async function handleRevoke() {
    setMessage("");
    if (!contractAddress.trim()) {
      setMessage("Deploy or paste a contract address first.");
      return;
    }
    if (!agentAddress.trim()) {
      setMessage("Target agent wallet address is required.");
      return;
    }
    if (!revocationReason.trim()) {
      setMessage("Revocation reason is required.");
      return;
    }

    setLoadingAction("revoke");
    try {
      const updated = await onRevoke({ agentAddress, reason: revocationReason });
      setMessage(`DID revoked on-chain. Tx: ${updated.txHash || "confirmed"}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to revoke DID");
    } finally {
      setLoadingAction("");
    }
  }

  const canIssue = record?.status === "pending_issuance";
  const canUpdate = record?.status === "active";
  const canRevoke = record?.status === "active";

  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardHeader>
        <CardTitle className="text-white">Issuer Actions</CardTitle>
        <CardDescription className="text-zinc-400">
          Execute the issuer-side lifecycle on-chain: activate, rotate, or revoke a DID.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor="issuerAgentAddress" className="text-zinc-300">
            Target Agent Wallet
          </Label>
          <Input
            id="issuerAgentAddress"
            value={agentAddress}
            onChange={(e) => setAgentAddress(e.target.value)}
            className="mt-1 bg-zinc-950 border-zinc-800 text-white"
          />
        </div>

        <div>
          <Label htmlFor="didDocument" className="text-zinc-300">
            DID Document Payload
          </Label>
          <textarea
            id="didDocument"
            value={didDocument}
            onChange={(e) => setDidDocument(e.target.value)}
            spellCheck={false}
            rows={12}
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-sm text-white outline-none ring-offset-background placeholder:text-zinc-500 focus-visible:border-zinc-700 focus-visible:ring-2 focus-visible:ring-zinc-700"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Button
            type="button"
            onClick={handleIssue}
            disabled={loadingAction !== "" || !canIssue}
            className="bg-emerald-600 hover:bg-emerald-500 text-white disabled:bg-zinc-700"
          >
            {loadingAction === "issue" ? "Issuing..." : "Issue DID"}
          </Button>
          <Button
            type="button"
            onClick={handleUpdate}
            disabled={loadingAction !== "" || !canUpdate}
            className="bg-blue-600 hover:bg-blue-500 text-white disabled:bg-zinc-700"
          >
            {loadingAction === "update" ? "Updating..." : "Update DID"}
          </Button>
        </div>

        <div>
          <Label htmlFor="revocationReason" className="text-zinc-300">
            Revocation Reason
          </Label>
          <Input
            id="revocationReason"
            value={revocationReason}
            onChange={(e) => setRevocationReason(e.target.value)}
            placeholder="Key compromised, issuer policy breach, etc."
            className="mt-1 bg-zinc-950 border-zinc-800 text-white"
          />
        </div>

        <Button
          type="button"
          onClick={handleRevoke}
          disabled={loadingAction !== "" || !canRevoke}
          className="w-full bg-red-700 hover:bg-red-600 text-white disabled:bg-zinc-700"
        >
          {loadingAction === "revoke" ? "Revoking..." : "Revoke DID"}
        </Button>

        {record && (
          <p className="text-xs text-zinc-400">
            Current status for this agent: <span className="text-zinc-200">{record.status}</span>
          </p>
        )}

        {message && <p className="text-xs text-zinc-300 break-all">{message}</p>}
      </CardContent>
    </Card>
  );
}
