const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

function getStore() {
  const root = globalThis;
  if (!root.__didMnLogStore) {
    root.__didMnLogStore = [];
  }
  return root.__didMnLogStore;
}

function coerceMessage(args) {
  return args
    .map((value) => {
      if (typeof value === "string") return value;
      if (value instanceof Error) return value.stack || value.message;
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    })
    .join(" ");
}

export function appendLog(level, scope, args) {
  const entries = getStore();
  entries.push({
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
    ts: new Date().toISOString(),
    level,
    scope,
    message: coerceMessage(args),
  });
  if (entries.length > MAX_LIMIT) {
    entries.splice(0, entries.length - MAX_LIMIT);
  }
}

export function getRecentLogs(limit = DEFAULT_LIMIT) {
  const normalized = Number.isFinite(limit)
    ? Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limit)))
    : DEFAULT_LIMIT;
  return getStore().slice(-normalized);
}

export function installProcessLogger(scope) {
  const root = globalThis;
  if (!root.__didMnLoggerInstalledScopes) {
    root.__didMnLoggerInstalledScopes = new Set();
  }
  if (root.__didMnLoggerInstalledScopes.has(scope)) {
    return;
  }
  root.__didMnLoggerInstalledScopes.add(scope);

  const methods = ["log", "info", "warn", "error"];
  for (const method of methods) {
    const original = console[method].bind(console);
    console[method] = (...args) => {
      appendLog(method, scope, args);
      original(...args);
    };
  }

  appendLog("info", scope, [`logger attached for ${scope}`]);
}
