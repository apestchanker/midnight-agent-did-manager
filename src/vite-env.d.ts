/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NETWORK_ID?: string;
  readonly VITE_INDEXER_URI?: string;
  readonly VITE_INDEXER_WS_URI?: string;
  readonly VITE_NODE_URI?: string;
  readonly VITE_PROVER_SERVER_URI?: string;
  readonly VITE_MANAGED_CONTRACT_PATH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
