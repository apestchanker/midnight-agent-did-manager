import { useCallback, useEffect, useState } from "react";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Coins, RefreshCw, ShieldCheck, Zap } from "lucide-react";
import type { AppProviders } from "../../lib/providers";
import type { UnifiedRegistryAPI } from "../lib/registry";
import { recordActionTokenGrant } from "../utils/serviceApi";
import {
  MidnightBech32m,
  ShieldedAddress,
  ShieldedCoinPublicKey,
} from "@midnight-ntwrk/wallet-sdk-address-format";
import { fromHex } from "../../lib/wallet-bridge";
import { classifyTokenBalance, type ClassifiedTokenBalance } from "../lib/token/token-metadata";

function parseShieldedAddress(address: string, networkId: string): Uint8Array {
  const raw = address.trim();
  if (!raw) throw new Error("Address is required.");
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return fromHex(raw);
  if (raw.startsWith("mn_")) {
    const parsed = MidnightBech32m.parse(raw);
    if (parsed.type === "shield-cpk") {
      return (ShieldedCoinPublicKey.codec.decode(networkId as never, parsed) as { data: Uint8Array }).data;
    }
    if (parsed.type === "shield-addr") {
      return (ShieldedAddress.codec.decode(networkId as never, parsed) as { coinPublicKey: { data: Uint8Array } }).coinPublicKey.data;
    }
  }
  throw new Error(`Unrecognised address format. Expected mn_shield-addr_... or mn_shield-cpk_...`);
}

interface TokenGatingPanelProps {
  providers: AppProviders;
  tokenAPI: UnifiedRegistryAPI | null;
  isAdmin: boolean;
}

export function TokenGatingPanel({ providers, tokenAPI, isAdmin }: TokenGatingPanelProps) {
  const [balances, setBalances] = useState<ClassifiedTokenBalance[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [balanceError, setBalanceError] = useState("");

  // Admin mint form
  const [recipientAddress, setRecipientAddress] = useState("");
  const [recipientCustomerRef, setRecipientCustomerRef] = useState("");
  const [grantCredits, setGrantCredits] = useState("5");
  const [minting, setMinting] = useState(false);
  const [mintResult, setMintResult] = useState("");
  const [mintError, setMintError] = useState("");

  // Admin rotate/top-up form
  const [rotateRecipientAddress, setRotateRecipientAddress] = useState("");
  const [rotateSupply, setRotateSupply] = useState("10");
  const [rotating, setRotating] = useState(false);
  const [rotateResult, setRotateResult] = useState("");
  const [rotateError, setRotateError] = useState("");

  const loadBalances = useCallback(async () => {
    setRefreshing(true);
    setBalanceError("");
    try {
      const raw = await providers.connectedAPI.getShieldedBalances();
      const rawEntries = Object.entries(raw as Record<string, bigint>);
      const verifiedColors =
        tokenAPI
          ? await tokenAPI.fetchVerifiedTokenColors(rawEntries.map(([color]) => color))
          : new Set<string>();
      const entries = rawEntries.map(([color, rawBalance]) =>
        classifyTokenBalance(
          color,
          BigInt(rawBalance),
          tokenAPI?.contractAddress,
          verifiedColors,
        ),
      );
      setBalances(entries);
    } catch (e) {
      setBalanceError(e instanceof Error ? e.message : "Failed to read wallet balances");
    } finally {
      setRefreshing(false);
    }
  }, [providers, tokenAPI?.contractAddress]);

  useEffect(() => {
    void loadBalances();
  }, [loadBalances]);

  // Find the verified action credit balance (the color whose address is in valid_colors on the contract).
  // contractAddress is NOT the token color — the color comes from fetchVerifiedTokenColors.
  const myVerifiedBalance = tokenAPI
    ? balances.find((b) => b.verified)
    : null;
  const myBalance = myVerifiedBalance?.rawBalance ?? (tokenAPI ? 0n : null);
  const canAct = myBalance !== null && myBalance > 1n;

  async function handleMint() {
    if (!tokenAPI) return;
    const addr = recipientAddress.trim();
    const customerRef = recipientCustomerRef.trim();
    const credits = BigInt(grantCredits || "0");

    if (!addr) { setMintError("Recipient wallet address is required."); return; }
    if (!customerRef) { setMintError("Customer wallet address is required."); return; }
    if (credits < 1n) { setMintError("Credits must be >= 1."); return; }
    if (credits > BigInt(Number.MAX_SAFE_INTEGER)) {
      setMintError("Credits exceed the service record limit.");
      return;
    }

    setMinting(true);
    setMintError("");
    setMintResult("");
    try {
      console.debug("[TokenGatingPanel] handleMint", { addr, networkId: providers.networkId });
      const recipientBytes = parseShieldedAddress(addr, providers.networkId);
      console.debug("[TokenGatingPanel] parsed recipientBytes length:", recipientBytes.length, "hex:", Buffer.from(recipientBytes).toString("hex").slice(0, 16) + "...");
      const { txHash, subscriptionKey } = await tokenAPI.mintTokens({
        recipientBytes,
        userId: customerRef,
        credits,
      });
      try {
        await recordActionTokenGrant({
          customerRef,
          tokenContractAddress: tokenAPI.contractAddress,
          networkId: providers.networkId,
          recipientShieldedAddress: addr,
          subscriptionKeyHex: Buffer.from(subscriptionKey).toString("hex"),
          creditsGranted: Number(credits),
          creditsUsed: 0,
          mintTxHash: txHash,
          actorRef: providers.unshieldedAddress,
        });
        setMintResult(`Granted ${credits} action credit(s) + 1 anchor. TX: ${txHash}. Grant recorded in customer subscription record.`);
      } catch (recordError) {
        setMintResult(
          `Granted ${credits} action credit(s) + 1 anchor. TX: ${txHash}. Grant record failed: ${
            recordError instanceof Error ? recordError.message : "unknown error"
          }`,
        );
      }
      setRecipientAddress("");
      setRecipientCustomerRef("");
      setGrantCredits("5");
    } catch (e) {
      setMintError(e instanceof Error ? e.message : "Mint failed");
    } finally {
      setMinting(false);
    }
  }

  async function handleRotate() {
    if (!tokenAPI) return;
    const addr = rotateRecipientAddress.trim();
    const supply = BigInt(rotateSupply || "0");

    if (!addr) { setRotateError("Recipient wallet address is required."); return; }
    if (supply < 1n) { setRotateError("Supply must be >= 1."); return; }
    if (supply > BigInt(Number.MAX_SAFE_INTEGER)) {
      setRotateError("Supply exceeds the allowed limit.");
      return;
    }

    setRotating(true);
    setRotateError("");
    setRotateResult("");
    try {
      const newRecipientBytes = parseShieldedAddress(addr, providers.networkId);
      const { txHash } = await tokenAPI.rotateAdminTokens({
        newRecipientBytes,
        newSupply: supply,
      });
      setRotateResult(
        `Burned the old admin token and minted ${supply} + 1 anchor to the recipient. TX: ${txHash}.`,
      );
    } catch (e) {
      setRotateError(e instanceof Error ? e.message : "Admin token rotation failed");
    } finally {
      setRotating(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* User balance view */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-zinc-100">
            <ShieldCheck className="h-4 w-4" />
            My Shielded Action Credits
          </CardTitle>
          <CardDescription className="text-zinc-400">
            Each DID registry operation consumes one action credit from your shielded wallet.
            Balances are read live from the connected wallet — no off-chain mirror.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {myBalance !== null ? (
            <div className="flex items-center gap-3">
              <Coins className="h-5 w-5 text-zinc-400" />
              <div>
                <div className="text-lg font-semibold text-zinc-100">{myBalance.toString()} raw units</div>
                <div className="text-xs text-zinc-500">
                  Anchor-protected: 1 unit is permanent. Spendable:{" "}
                  {myBalance > 1n ? (myBalance - 1n).toString() : "0"}
                </div>
              </div>
              {canAct ? (
                <span className="ml-auto rounded-full bg-emerald-900 px-2 py-0.5 text-xs font-medium text-emerald-300">
                  Can act
                </span>
              ) : (
                <span className="ml-auto rounded-full bg-red-900 px-2 py-0.5 text-xs font-medium text-red-300">
                  No credits
                </span>
              )}
            </div>
          ) : (
            <p className="text-sm text-zinc-500">
              {tokenAPI
                ? "No shielded action credits for this contract."
                : "Token gating contract not connected."}
            </p>
          )}

          <div className="border-t border-zinc-800 pt-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
                All Wallet Shielded Balances
              </span>
              <Button variant="outline" size="sm" onClick={() => void loadBalances()} disabled={refreshing}>
                <RefreshCw className={`h-3 w-3 mr-1 ${refreshing ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
            {balanceError && <p className="text-xs text-red-400">{balanceError}</p>}
            {balances.length === 0 && !balanceError ? (
              <p className="text-xs text-zinc-500">No shielded token balances in this wallet.</p>
            ) : (
              <div className="space-y-1">
                {balances.map((b) => (
                  <div key={b.color} className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-2 text-xs">
                    <span
                      className="font-mono text-zinc-400 truncate max-w-[200px]"
                      title={b.color}
                    >
                      {b.color.slice(0, 16)}…
                    </span>
                    <span
                      className={b.kind === "didmn_action_credit" ? "text-emerald-300" : "text-zinc-500"}
                      title={
                        b.kind === "didmn_action_credit"
                          ? "Matches the active didMN token-gating contract color."
                          : "This wallet balance does not match the active didMN token-gating contract."
                      }
                    >
                      {b.kind === "didmn_action_credit" ? "Action credit" : "Unknown"}
                    </span>
                    <span
                      className={b.verified ? "text-emerald-300" : "text-zinc-500"}
                      title={
                        b.verified
                          ? "Verified by matching the active token-gating contract color."
                          : "Not verified by this app for the active token-gating contract."
                      }
                    >
                      {b.verified ? "Verified" : "Unverified"}
                    </span>
                    <span className="font-semibold text-zinc-200">{b.rawBalance.toString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Admin mint panel */}
      {isAdmin && tokenAPI && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-zinc-100">
              <Zap className="h-4 w-4" />
              Grant Shielded Action Credits
            </CardTitle>
            <CardDescription className="text-zinc-400">
              Mint shielded capability tokens to a user's wallet. Each credit allows one gated DID
              registry action. The circuit mints the specified credits plus 1 permanent anchor unit.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="recipient-address" className="text-zinc-200">Recipient Wallet Shielded Address</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setRecipientAddress(providers.shieldedAddress)}
                  className="text-xs h-6 px-2 text-zinc-400 hover:text-zinc-200"
                >
                  Use my address
                </Button>
              </div>
              <Input
                id="recipient-address"
                placeholder="mn_shield-addr_1... or mn_shield-cpk_1..."
                value={recipientAddress}
                onChange={(e) => setRecipientAddress(e.target.value)}
                className="bg-zinc-950 border-zinc-800 text-white placeholder:text-zinc-500 font-mono text-xs"
              />
              <p className="text-xs text-zinc-500">
                The human-readable shielded address from the recipient's wallet (starts with{" "}
                <code className="text-zinc-400">mn_shield</code>). Network: <code className="text-zinc-400">{providers.networkId}</code>
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="customer-ref" className="text-zinc-200">Customer Wallet Address (unshielded)</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setRecipientCustomerRef(providers.unshieldedAddress)}
                  className="text-xs h-6 px-2 text-zinc-400 hover:text-zinc-200"
                >
                  Use my address
                </Button>
              </div>
              <Input
                id="customer-ref"
                placeholder="mn_addr_1..."
                value={recipientCustomerRef}
                onChange={(e) => setRecipientCustomerRef(e.target.value)}
                className="bg-zinc-950 border-zinc-800 text-white placeholder:text-zinc-500 font-mono text-xs"
              />
              <p className="text-xs text-zinc-500">
                The unshielded wallet address the customer used to bootstrap their account —
                looked up against their linked wallet, not their email (customers created without
                one get an unguessable auto-generated address, so email/ID lookups usually fail
                here). Used to write the action-token grant into the service DB after mint success.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="credits" className="text-zinc-200">Action Credits to Grant</Label>
              <Input
                id="credits"
                type="number"
                min="1"
                value={grantCredits}
                onChange={(e) => setGrantCredits(e.target.value)}
                className="w-24 bg-zinc-950 border-zinc-800 text-white"
              />
              <p className="text-xs text-zinc-500">
                Mints {grantCredits || "0"} + 1 anchor ={" "}
                {Number(grantCredits || 0) + 1} raw units total.
              </p>
            </div>

            {mintError && <p className="text-sm text-red-400">{mintError}</p>}
            {mintResult && (
              <p className="text-xs text-emerald-400 break-all font-mono">{mintResult}</p>
            )}

            <Button onClick={() => void handleMint()} disabled={minting}>
              {minting ? "Minting…" : "Grant Credits"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Admin rotate/top-up panel */}
      {isAdmin && tokenAPI && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-zinc-100">
              <RefreshCw className="h-4 w-4" />
              Top Up Admin Tokens
            </CardTitle>
            <CardDescription className="text-zinc-400">
              Every admin-tier action (issue, grant, revoke, rotate) burns 1 unit from your admin
              token. When the spendable balance runs low, burn the current admin token and mint a
              fresh one via <code className="text-zinc-400">rotate_admin_tokens</code> — atomic in
              a single transaction, no downtime. Send to your own wallet to top up, or to another
              wallet to hand off admin control.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="rotate-recipient-address" className="text-zinc-200">Recipient Shielded Address</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setRotateRecipientAddress(providers.shieldedAddress)}
                  className="text-xs h-6 px-2 text-zinc-400 hover:text-zinc-200"
                >
                  Use my address
                </Button>
              </div>
              <Input
                id="rotate-recipient-address"
                placeholder="mn_shield-addr_1... or mn_shield-cpk_1..."
                value={rotateRecipientAddress}
                onChange={(e) => setRotateRecipientAddress(e.target.value)}
                className="bg-zinc-950 border-zinc-800 text-white placeholder:text-zinc-500 font-mono text-xs"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rotate-supply" className="text-zinc-200">New Admin Supply</Label>
              <Input
                id="rotate-supply"
                type="number"
                min="1"
                value={rotateSupply}
                onChange={(e) => setRotateSupply(e.target.value)}
                className="w-24 bg-zinc-950 border-zinc-800 text-white"
              />
              <p className="text-xs text-zinc-500">
                Mints {rotateSupply || "0"} + 1 anchor ={" "}
                {Number(rotateSupply || 0) + 1} raw units total, replacing the current admin token.
              </p>
            </div>

            {rotateError && <p className="text-sm text-red-400">{rotateError}</p>}
            {rotateResult && (
              <p className="text-xs text-emerald-400 break-all font-mono">{rotateResult}</p>
            )}

            <Button onClick={() => void handleRotate()} disabled={rotating}>
              {rotating ? "Rotating…" : "Rotate Admin Tokens"}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
