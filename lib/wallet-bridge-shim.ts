import type {
  ConnectedAPI,
  InitialAPI,
} from "@midnight-ntwrk/dapp-connector-api";

// Auto-injected: bridges parent page's 1AM wallet into Sandpack iframe
const SRC = "1am-sandpack-bridge";
const RSP = "1am-sandpack-response";
let rid = 0;

type PendingResolver = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type WindowWithMidnight = Window & {
  midnight?: Record<string, InitialAPI>;
};

type BridgeResponseMessage = {
  source?: string;
  id?: number;
  error?: string;
  result?: unknown;
};

const pending = new Map<
  number,
  PendingResolver
>();

window.addEventListener("message", (e: MessageEvent) => {
  const data = e.data as BridgeResponseMessage | undefined;
  if (!data || data.source !== RSP || typeof data.id !== "number") return;
  const p = pending.get(data.id);
  if (!p) return;
  pending.delete(data.id);
  if (data.error) p.reject(new Error(data.error));
  else p.resolve(data.result);
});

function callParent(method: string, args: unknown[] = []): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = ++rid;
    pending.set(id, { resolve, reject });
    window.parent.postMessage({ source: SRC, id, method, args }, "*");
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error("Wallet bridge timeout"));
      }
    }, 60000);
  });
}

function makeBridgedAPI(): ConnectedAPI {
  return {
    getConfiguration: () => callParent("getConfiguration") as Promise<ConnectedAPI["getConfiguration"] extends () => Promise<infer T> ? T : never>,
    getShieldedAddresses: () => callParent("getShieldedAddresses") as Promise<ConnectedAPI["getShieldedAddresses"] extends () => Promise<infer T> ? T : never>,
    getUnshieldedAddress: () => callParent("getUnshieldedAddress") as Promise<ConnectedAPI["getUnshieldedAddress"] extends () => Promise<infer T> ? T : never>,
    getShieldedBalances: () => callParent("getShieldedBalances") as Promise<ConnectedAPI["getShieldedBalances"] extends () => Promise<infer T> ? T : never>,
    getUnshieldedBalances: () => callParent("getUnshieldedBalances") as Promise<ConnectedAPI["getUnshieldedBalances"] extends () => Promise<infer T> ? T : never>,
    getDustBalance: () => callParent("getDustBalance") as Promise<ConnectedAPI["getDustBalance"] extends () => Promise<infer T> ? T : never>,
    balanceUnsealedTransaction: (h: string) =>
      callParent("balanceUnsealedTransaction", [h]) as Promise<ConnectedAPI["balanceUnsealedTransaction"] extends (...args: never[]) => Promise<infer T> ? T : never>,
    submitTransaction: (h: string) =>
      callParent("submitTransaction", [h]) as Promise<ConnectedAPI["submitTransaction"] extends (...args: never[]) => Promise<infer T> ? T : never>,
  } as ConnectedAPI;
}

// Only inject if we're inside an iframe (Sandpack) and window.midnight doesn't already exist
if (
  typeof window !== "undefined" &&
  window.parent !== window &&
  !(window as WindowWithMidnight).midnight
) {
  const bridgedWallet: InitialAPI = {
    name: "1AM",
    icon: "bridged",
    rdns: "xyz.1am.bridge",
    apiVersion: "4.0.0",
    connect: async (networkId: string) => {
      await callParent("connect", [networkId]);
      return makeBridgedAPI();
    },
  };

  (window as WindowWithMidnight).midnight = {
    "1am-bridge": bridgedWallet,
  };
}

export {};
