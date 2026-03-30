const EXPLORER_BASE_URL = "https://explorer.1am.xyz";
const EXPLORER_NETWORK =
  (import.meta.env.VITE_NETWORK_ID || "").trim() || "preprod";

export function explorerTxUrl(txRef: string): string {
  const url = new URL(`/tx/${txRef}`, EXPLORER_BASE_URL);
  url.searchParams.set("network", EXPLORER_NETWORK);
  return url.toString();
}
