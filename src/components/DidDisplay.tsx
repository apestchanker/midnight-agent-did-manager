import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import type { DidRecord } from "../types/did";
import { explorerTxUrl } from "../lib/explorer";

interface DidDisplayProps {
  record: DidRecord | null;
}

export function DidDisplay({ record }: DidDisplayProps) {
  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardHeader>
        <CardTitle className="text-white">Your DID</CardTitle>
        <CardDescription className="text-zinc-400">
          Assigned identifier, commitments, and registry processing status.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!record ? (
          <p className="text-zinc-400 text-sm">
            DID not found yet. Submit a DID request first.
          </p>
        ) : (
          <div className="space-y-2">
            {record.agentName && (
              <p className="text-sm text-zinc-300">
                <span className="text-zinc-500">Agent Name:</span> {record.agentName}
              </p>
            )}
            {record.organizationDisclosure && (
              <p className="text-sm text-zinc-300">
                <span className="text-zinc-500">Organization Disclosure:</span>{" "}
                {record.organizationDisclosure}
              </p>
            )}
            {record.organization && (
              <p className="text-sm text-zinc-300">
                <span className="text-zinc-500">Organization:</span> {record.organization}
              </p>
            )}
            <p className="text-sm text-zinc-300">
              <span className="text-zinc-500">Agent Key:</span>{" "}
              <span className="font-mono break-all text-emerald-400">
                {record.agentKeyHex}
              </span>
            </p>
            {record.did && (
              <p className="text-sm text-zinc-300">
                <span className="text-zinc-500">DID:</span>{" "}
                <span className="font-mono break-all text-emerald-400">
                  {record.did}
                </span>
              </p>
            )}
            {record.didCommitmentHex && (
              <p className="text-sm text-zinc-300">
                <span className="text-zinc-500">DID Commitment:</span>{" "}
                <span className="font-mono break-all">
                  {record.didCommitmentHex}
                </span>
              </p>
            )}
            {record.documentHashHex && (
              <p className="text-sm text-zinc-300">
                <span className="text-zinc-500">Document:</span>{" "}
                <span className="font-mono break-all">{record.documentHashHex}</span>
              </p>
            )}
            {record.requestCommitmentHex && (
              <p className="text-sm text-zinc-300">
                <span className="text-zinc-500">Request Commitment:</span>{" "}
                <span className="font-mono break-all">
                  {record.requestCommitmentHex}
                </span>
              </p>
            )}
            {record.proofCommitmentHex && (
              <p className="text-sm text-zinc-300">
                <span className="text-zinc-500">Proof Commitment:</span>{" "}
                <span className="font-mono break-all">
                  {record.proofCommitmentHex}
                </span>
              </p>
            )}
            <p className="text-sm text-zinc-300">
              <span className="text-zinc-500">Status:</span> {record.status}
            </p>
            <p className="text-sm text-zinc-300">
              <span className="text-zinc-500">Proof:</span> {record.proofStatus}
            </p>
            <p className="text-sm text-zinc-300">
              <span className="text-zinc-500">Transaction:</span>{" "}
              {record.txStatus}
            </p>
            <p className="text-sm text-zinc-300">
              <span className="text-zinc-500">Created:</span>{" "}
              {new Date(record.createdAt).toLocaleString()}
            </p>
            {record.issuedAt && (
              <p className="text-sm text-zinc-300">
                <span className="text-zinc-500">Issued:</span>{" "}
                {new Date(record.issuedAt).toLocaleString()}
              </p>
            )}
            {record.revokedAt && (
              <p className="text-sm text-zinc-300">
                <span className="text-zinc-500">Revoked:</span>{" "}
                {new Date(record.revokedAt).toLocaleString()}
              </p>
            )}
            {record.txHash && (
              <p className="text-sm text-zinc-300">
                <span className="text-zinc-500">Tx:</span>{" "}
                <span className="font-mono break-all">{record.txId || record.txHash}</span>
              </p>
            )}
            {record.txId && record.txHash && record.txId !== record.txHash && (
              <p className="text-sm text-zinc-300">
                <span className="text-zinc-500">Tx Hash:</span>{" "}
                <a
                  href={explorerTxUrl(record.txHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono break-all text-emerald-400 underline underline-offset-2"
                >
                  {record.txHash}
                </a>
              </p>
            )}
            {!record.txId && record.txHash && (
              <p className="text-sm text-zinc-300">
                <span className="text-zinc-500">Tx Hash:</span>{" "}
                <a
                  href={explorerTxUrl(record.txHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono break-all text-emerald-400 underline underline-offset-2"
                >
                  {record.txHash}
                </a>
              </p>
            )}
            <p className="text-sm text-zinc-300">
              <span className="text-zinc-500">Mode:</span>{" "}
              <span
                className={
                  record.mode === "onchain"
                    ? "text-emerald-400"
                    : "text-amber-400"
                }
              >
                {record.mode}
              </span>
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
