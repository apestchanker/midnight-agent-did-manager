import { detectWallets, type ConnectedAPI } from "../lib/wallet-bridge";
import "../index.css";

type InitialAPI = Awaited<ReturnType<typeof detectWallets>>[number];
type WalletProviderEntry = {
  providerKey: string;
  wallet: InitialAPI;
};

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing #root element");
}

root.innerHTML = `
  <main style="max-width:960px;margin:0 auto;padding:32px 20px 48px;">
    <section style="background:#111827;border:1px solid #374151;border-radius:16px;padding:20px;color:#f9fafb;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;">
      <h1 style="margin:0 0 8px;font-size:28px;">1AM Proof Debug</h1>
      <p style="margin:0 0 16px;color:#9ca3af;line-height:1.5;">
        Esta página usa el bridge del repo y el mismo orden de llamadas de la app para conectar 1AM o Lace y leer <code>proverServerUri</code>.
      </p>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin:16px 0 20px;">
        <select id="wallet" style="border-radius:10px;border:1px solid #374151;background:#0f172a;color:#f9fafb;padding:10px 14px;font:inherit;">
          <option value="">auto</option>
        </select>
        <select id="network" style="border-radius:10px;border:1px solid #374151;background:#0f172a;color:#f9fafb;padding:10px 14px;font:inherit;">
          <option value="preprod">preprod</option>
          <option value="preview">preview</option>
          <option value="mainnet">mainnet</option>
        </select>
        <button id="detect" style="border-radius:10px;border:1px solid #374151;background:#0f172a;color:#f9fafb;padding:10px 14px;font:inherit;cursor:pointer;">Detect Wallets</button>
        <button id="connect" style="border-radius:10px;border:1px solid #374151;background:#0f172a;color:#f9fafb;padding:10px 14px;font:inherit;cursor:pointer;">Connect Wallet</button>
        <button id="clear" style="border-radius:10px;border:1px solid #374151;background:#1f2937;color:#f9fafb;padding:10px 14px;font:inherit;cursor:pointer;">Clear</button>
      </div>
      <div style="display:grid;grid-template-columns:180px 1fr;gap:8px 14px;margin:18px 0;">
        <div style="color:#9ca3af;">Wallets detectadas</div>
        <div id="wallets">-</div>
        <div style="color:#9ca3af;">Wallet elegida</div>
        <div id="selected">-</div>
        <div style="color:#9ca3af;">Network</div>
        <div id="networkValue">-</div>
        <div style="color:#9ca3af;">Prover Server</div>
        <div id="prover">-</div>
        <div style="color:#9ca3af;">Indexer</div>
        <div id="indexer">-</div>
        <div style="color:#9ca3af;">Node</div>
        <div id="node">-</div>
      </div>
      <pre id="providers" style="margin:16px 0 0;padding:16px;border-radius:12px;border:1px solid #374151;background:#08101f;color:#bfdbfe;overflow:auto;white-space:pre-wrap;word-break:break-word;">Providers not loaded yet.</pre>
      <div id="warning" style="display:none;margin:16px 0 0;padding:16px;border-radius:12px;border:1px solid #7c2d12;background:#451a03;color:#fde68a;"></div>
      <pre id="output" style="margin:16px 0 0;padding:16px;border-radius:12px;border:1px solid #374151;background:#020617;color:#dbe6ff;overflow:auto;white-space:pre-wrap;word-break:break-word;">Waiting for action...</pre>
    </section>
  </main>
`;

const logLines: string[] = [];

function $(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element;
}

function setText(id: string, value: string, color = "") {
  const el = $(id);
  el.textContent = value;
  el.setAttribute("style", color ? `color:${color};` : "");
}

function getWalletProviderEntries(): WalletProviderEntry[] {
  const midnight = (window as Window & { midnight?: Record<string, unknown> }).midnight;
  if (!midnight || typeof midnight !== "object") return [];

  const entries: WalletProviderEntry[] = [];
  for (const providerKey of Object.keys(midnight)) {
    const candidate = midnight[providerKey];
    if (
      candidate &&
      typeof candidate === "object" &&
      typeof (candidate as { name?: unknown }).name === "string" &&
      typeof (candidate as { connect?: unknown }).connect === "function"
    ) {
      entries.push({
        providerKey,
        wallet: candidate as InitialAPI,
      });
    }
  }
  return entries;
}

function renderProviders(entries: WalletProviderEntry[]) {
  $("providers").textContent =
    entries.length === 0
      ? "No providers found in window.midnight"
      : JSON.stringify(
          entries.map(({ providerKey, wallet }) => ({
            providerKey,
            name: wallet.name,
            apiVersion: wallet.apiVersion,
            icon: wallet.icon,
            rdns: (wallet as InitialAPI & { rdns?: string }).rdns || null,
            methods: Object.keys(wallet)
              .filter((key) => typeof (wallet as Record<string, unknown>)[key] === "function")
              .sort(),
          })),
          null,
          2,
        );
}

function setWarning(message: string, visible = true) {
  const el = $("warning");
  el.textContent = message;
  el.setAttribute(
    "style",
    visible
      ? "display:block;margin:16px 0 0;padding:16px;border-radius:12px;border:1px solid #7c2d12;background:#451a03;color:#fde68a;"
      : "display:none;",
  );
}

function isLocalProver(url?: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  } catch {
    return false;
  }
}

function syncWalletSelect(entries: WalletProviderEntry[]) {
  const select = document.getElementById("wallet") as HTMLSelectElement;
  const existingValue = select.value;
  select.innerHTML = `<option value="">auto</option>`;
  for (const entry of entries) {
    const option = document.createElement("option");
    option.value = entry.providerKey;
    option.textContent = `${entry.wallet.name} [${entry.providerKey}] (${entry.wallet.apiVersion})`;
    select.appendChild(option);
  }

  const nextValue =
    entries.some((entry) => entry.providerKey === existingValue)
      ? existingValue
      : "";
  select.value = nextValue;
}

function logStep(message: string, details?: unknown) {
  const line =
    details === undefined
      ? message
      : `${message}\n${JSON.stringify(details, null, 2)}`;
  logLines.push(line);
  $("output").textContent = logLines.join("\n\n");
}

function clearDebugOutput() {
  logLines.length = 0;
  setText("wallets", "-");
  setText("selected", "-");
  setText("networkValue", "-");
  setText("prover", "-");
  setText("indexer", "-");
  setText("node", "-");
  $("providers").textContent = "Providers cleared. Click Detect Wallets to reload.";
  $("output").textContent = "Cleared.";
  setWarning("", false);
}

async function runDetect(): Promise<InitialAPI[]> {
  logStep("Running wallet detection...");
  renderProviders(getWalletProviderEntries());
  const wallets = await detectWallets();
  const entries = getWalletProviderEntries();
  renderProviders(entries);
  syncWalletSelect(entries);
  if (wallets.length === 0) {
    setText("wallets", "No se detectó ninguna wallet Midnight", "#fca5a5");
    setWarning("", false);
    logStep(
      "No se detectó window.midnight. Abre esta página en un navegador/perfil donde 1AM o Lace estén instaladas y habilitadas.",
    );
    return [];
  }

  setText(
    "wallets",
    entries.map((entry) => `${entry.wallet.name} [${entry.providerKey}]`).join(", "),
    "#6ee7b7",
  );
  logStep("Wallets detected.", {
    detectedWallets: entries.map((entry) => ({
      providerKey: entry.providerKey,
      name: entry.wallet.name,
      apiVersion: entry.wallet.apiVersion,
      rdns: (entry.wallet as InitialAPI & { rdns?: string }).rdns || null,
      icon: entry.wallet.icon,
    })),
  });
  return wallets;
}

async function connectExactlyLikeApp() {
  logStep("Connect button pressed.");
  const wallets = await runDetect();
  const entries = getWalletProviderEntries();
  const preferredProviderKey = (
    document.getElementById("wallet") as HTMLSelectElement
  ).value;
  const selected =
    (preferredProviderKey
      ? entries.find((entry) => entry.providerKey === preferredProviderKey)?.wallet
      : undefined) ||
    entries.find((entry) => entry.wallet.name === "1AM")?.wallet ||
    wallets[0];
  if (!selected) {
    throw new Error("No Midnight wallet detected. Install 1AM or Lace and refresh.");
  }
  setText("selected", selected.name, "#6ee7b7");
  logStep("Selected wallet.", { wallet: selected.name });

  const network = (document.getElementById("network") as HTMLSelectElement).value;

  logStep("Connecting wallet...", { network });
  const api = await selected.connect(network as never);
  logStep("Connected. Requesting configuration...");
  const config = await api.getConfiguration();
  const apiMethods = Object.keys(api as Record<string, unknown>)
    .filter((key) => typeof (api as Record<string, unknown>)[key] === "function")
    .sort();
  logStep("Connected API methods.", { methods: apiMethods });

  if (typeof (api as Partial<ConnectedAPI>).hintUsage === "function") {
    logStep("Requesting permissions with hintUsage...");
    await (api as ConnectedAPI & { hintUsage: ConnectedAPI["hintUsage"] }).hintUsage([
      "getConfiguration",
      "getShieldedAddresses",
      "getUnshieldedAddress",
      "getProvingProvider",
      "balanceUnsealedTransaction",
      "submitTransaction",
    ]);
  } else {
    logStep("hintUsage is not implemented by this wallet API.", {
      missingMethod: "hintUsage",
    });
  }

  logStep("Priming wallet session...");
  const shielded =
    typeof api.getShieldedAddresses === "function"
      ? await api.getShieldedAddresses()
      : null;
  const unshielded =
    typeof api.getUnshieldedAddress === "function"
      ? await api.getUnshieldedAddress()
      : null;

  return { api, config, shielded, unshielded };
}

function renderConfig(config: Awaited<ReturnType<ConnectedAPI["getConfiguration"]>>) {
  setText("networkValue", String(config.networkId || "-"), "#6ee7b7");
  const prover = String(config.proverServerUri || "(sin proverServerUri)");
  const local = isLocalProver(config.proverServerUri);
  if (local) {
    setWarning("Local proof server detected. Proof generation stays on this machine.", true);
  } else {
    setWarning(
      `Remote proof service detected: ${prover}. This is not local proving.`,
      true,
    );
  }
  setText("prover", prover, local ? "#6ee7b7" : "#fca5a5");
  setText("indexer", String(config.indexerUri || "-"));
  setText("node", String(config.substrateNodeUri || "-"));
}

$("detect").addEventListener("click", () => {
  void runDetect();
});

$("connect").addEventListener("click", () => {
  void (async () => {
    try {
      const { api, config, shielded, unshielded } = await connectExactlyLikeApp();
      renderConfig(config);
      logStep("Wallet session ready.", {
        proverServerUri: config.proverServerUri || null,
        networkId: config.networkId,
        shieldedAddress: shielded?.shieldedAddress || null,
        unshieldedAddress: unshielded?.unshieldedAddress || null,
        config,
      });
      (window as Window & { __oneamDebug?: unknown }).__oneamDebug = {
        api,
        config,
        shielded,
        unshielded,
      };
    } catch (error) {
      logStep("Connection failed.", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();
});

$("clear").addEventListener("click", () => {
  clearDebugOutput();
});

void runDetect();
