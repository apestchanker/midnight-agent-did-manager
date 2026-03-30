import { useEffect, useState } from "react";
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

interface RequestFormProps {
  contractAddress: string;
  walletAddress: string;
  initialAgentAddress?: string;
  onRequest: (payload: {
    agentAddress: string;
    agentName?: string;
    organization?: string;
    organizationDisclosure: "disclosed" | "undisclosed";
    didDocument: string;
  }) => Promise<DidRecord>;
}

export function RequestForm({
  contractAddress,
  walletAddress,
  initialAgentAddress,
  onRequest,
}: RequestFormProps) {
  const [agentAddress, setAgentAddress] = useState(initialAgentAddress || "");
  const [agentName, setAgentName] = useState("");
  const [organization, setOrganization] = useState("");
  const [organizationDisclosure, setOrganizationDisclosure] = useState<"disclosed" | "undisclosed">("undisclosed");
  const [didDocument, setDidDocument] = useState("");
  const [didDocumentTouched, setDidDocumentTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setAgentAddress(initialAgentAddress || "");
  }, [initialAgentAddress]);

  useEffect(() => {
    if (didDocumentTouched) return;
    setDidDocument(
      JSON.stringify(
        {
          id: "",
          controller: agentAddress || "",
          agentName: agentName || "",
          organization:
            organizationDisclosure === "disclosed" ? organization || "" : "undisclosed",
          service: [
            {
              id: "#agent-endpoint",
              type: "AgentEndpoint",
              serviceEndpoint: "https://agent.example.com",
            },
          ],
        },
        null,
        2,
      ),
    );
  }, [agentAddress, agentName, didDocumentTouched, organization, organizationDisclosure]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");

    if (!contractAddress.trim()) {
      setMessage("Please deploy or paste a contract address first.");
      return;
    }
    if (!agentAddress.trim()) {
      setMessage("Select or enter an agent wallet address first.");
      return;
    }
    setLoading(true);
    try {
      const record = await onRequest({
        agentAddress,
        agentName,
        organization,
        organizationDisclosure,
        didDocument,
      });
      setMessage(
        `Request confirmed on-chain. Agent key: ${record.agentKeyHex}`,
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to request DID");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardHeader>
        <CardTitle className="text-white">Request DID</CardTitle>
        <CardDescription className="text-zinc-400">
          Submit an on-chain DID petition bound to your wallet. Optional organization disclosure is stored on-chain; personal identity stays off-chain.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label className="text-zinc-300">Human Wallet</Label>
            <Input
              value={walletAddress}
              readOnly
              className="mt-1 bg-zinc-950 border-zinc-800 text-zinc-300"
            />
          </div>

          <div>
            <Label htmlFor="agentAddress" className="text-zinc-300">
              Agent Wallet Address
            </Label>
            <Input
              id="agentAddress"
              value={agentAddress}
              onChange={(e) => setAgentAddress(e.target.value)}
              placeholder="mn_addr_preprod1..."
              className="mt-1 bg-zinc-950 border-zinc-800 text-white"
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => setAgentAddress(walletAddress)}
                disabled={!walletAddress.trim()}
                className="bg-zinc-800 hover:bg-zinc-700 text-white"
              >
                Use My Connected Wallet
              </Button>
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              The human can manage multiple agents. This wallet becomes the DID subject binding.
            </p>
          </div>

          <div>
            <Label htmlFor="agentName" className="text-zinc-300">
              Agent Name
            </Label>
            <Input
              id="agentName"
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              placeholder="Agent Smith"
              className="mt-1 bg-zinc-950 border-zinc-800 text-white"
            />
            <p className="mt-1 text-xs text-zinc-500">
              Stored in the off-chain payload and VC layer, not on-chain.
            </p>
          </div>

          <div>
            <Label htmlFor="organization" className="text-zinc-300">
              Organization (optional)
            </Label>
            <Input
              id="organization"
              value={organization}
              onChange={(e) => setOrganization(e.target.value)}
              placeholder="Acme Labs"
              className="mt-1 bg-zinc-950 border-zinc-800 text-white"
            />
          </div>

          <div>
            <Label htmlFor="organizationDisclosure" className="text-zinc-300">
              Organization Disclosure
            </Label>
            <select
              id="organizationDisclosure"
              value={organizationDisclosure}
              onChange={(e) =>
                setOrganizationDisclosure(
                  e.target.value as "disclosed" | "undisclosed",
                )
              }
              className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white"
            >
              <option value="undisclosed">undisclosed</option>
              <option value="disclosed">disclosed</option>
            </select>
          </div>

          <div>
            <Label htmlFor="didDocument" className="text-zinc-300">
              Requested DID Document Payload
            </Label>
            <textarea
              id="didDocument"
              value={didDocument}
              onChange={(e) => {
                setDidDocumentTouched(true);
                setDidDocument(e.target.value);
              }}
              spellCheck={false}
              rows={12}
              className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-sm text-white outline-none ring-offset-background placeholder:text-zinc-500 focus-visible:border-zinc-700 focus-visible:ring-2 focus-visible:ring-zinc-700"
            />
            <p className="mt-1 text-xs text-zinc-500">
              This is authored by the requester and reviewed by the issuer before issuance.
            </p>
          </div>

          <Button
            type="submit"
            disabled={loading || !agentAddress.trim()}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white"
          >
            {loading ? "Submitting..." : "Request DID"}
          </Button>

          {message && (
            <p className="text-xs text-zinc-300 break-all">{message}</p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
