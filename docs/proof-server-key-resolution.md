# Proof server key resolution: wallet-delegated vs. configured HTTP proof server

Found and root-caused 2026-07-22 while debugging a production failure of
`register_initial_admin` (the second step of the two-transaction admin
bootstrap — see `contracts/did_registry.compact.template`) on the deployed
Static Site. Written up here because it is not covered by the installed
`midnight-expert` plugin skills (checked `midnight-tooling:proof-server`,
which only documents running/managing the Docker proof server, not this).

## The mechanism

A Midnight transaction that touches the shielded pool needs ZK proofs not
just for your contract's own circuit, but also for **protocol-level
builtin circuits** — e.g. `midnight/zswap/output` (needed whenever a new
shielded coin/output is constructed — any `mintShieldedToken`, not
contract-specific), `midnight/zswap/spend`, `midnight/zswap/sign`,
`midnight/dust/spend`. These are part of the ledger/kernel, not something
any DApp compiles or owns.

There are two different proving paths in this codebase
(`lib/providers.ts`), and **they resolve builtin keys completely
differently**:

| Path | How it's selected | How builtins (`midnight/zswap/*`) are resolved | How your contract's own circuits are resolved |
|---|---|---|---|
| **Wallet-delegated** | Default — used whenever `VITE_PROVER_SERVER_URI` is unset | The wallet extension (Lace, 1AM, etc.) resolves them **internally**, fetching from a fixed Midnight-owned S3 bucket. Your app's `ZKConfigProvider` is never asked. | Wallet calls `api.getProvingProvider(registry.asKeyMaterialProvider())` — your `KeyMaterialProvider`/`ZKConfigProvider` (the one built from `public/contracts/managed/<contract>/`) is still used for these. |
| **Configured HTTP proof server** | Active whenever `VITE_PROVER_SERVER_URI` is set (`CONFIGURED_PROVER_SERVER_URL` truthy in `lib/providers.ts`), via `httpClientProvingProvider(url, zkConfigProvider)` | **No builtin fallback exists in this path.** `midnight-js`'s `http-client-proving-provider` falls through to whatever `ZKConfigProvider` you gave it for *any* circuit ID it doesn't recognize as a `contract:<addr>/<circuitId>` location — including protocol builtins. If your `ZKConfigProvider` only serves your own contract's circuits (the normal case), this 404s. | Same as above — your `ZKConfigProvider`. |

Source evidence (via `midnight-verify:source-investigator`, not
memory/training data — see that agent's report in this session's
transcript for full detail):

- `midnight-ledger/zswap/src/construct.rs` — `Output` construction fixes
  `key_location: KeyLocation(Cow::Borrowed("midnight/zswap/output"))`.
- `midnight-ledger/ledger/src/test_utilities.rs` and
  `midnight-node/ledger/helpers/.../test_utilities_compat.rs` — both carry
  an explicit `is_builtin_key()` list: `midnight/zswap/spend`,
  `midnight/zswap/output`, `midnight/zswap/sign`, `midnight/dust/spend`.
- `midnight-wallet/packages/prover-client/src/effect/WasmProver.ts` —
  wallet-side `makeDefaultKeyMaterialProvider()` maps these builtin IDs to
  a fixed S3 path (`zswap/{ledgerVersion}/output`, etc.) and fetches them
  from `https://midnight-s3-fileshare-dev-eu-west-1.s3.eu-west-1.amazonaws.com/...`
  — entirely inside the wallet, never touching the DApp's provider.
- `midnight-js/packages/http-client-proof-provider/src/http-client-proving-provider.ts`
  — confirms the fallback-to-your-flat-provider-for-unrecognized-circuit-IDs
  behavior is by design, not a bug in how we compose our provider.
- `midnightntwrk/passport` (`demo/mn-passport-foundations/app/src/lib/wasmProver.ts`)
  is the one official example found that runs its *own* HTTP proof server
  path successfully — it does so by hand-rolling a `SYSTEM_KEYS` map and a
  `lookupSystemKey()` shim that intercepts builtin circuit IDs *before*
  they reach its contract `ZKConfigProvider`, fetching them from a
  separate `/zk-params/` path. We do not have an equivalent shim.

## The incident

Debugging `register_initial_admin` failing in production went through
(in order): a `mintShieldedToken`-shaped circuit was new to this contract
(prior admin-gated circuits only *spend* existing coins via
`consumeAdminToken()`, never mint) → first failure was
`key not found: register_initial_admin` from the 1AM wallet's own proof
server → hypothesized (wrongly, at first) that the public 1AM proof
server just didn't support custom/new circuits → set
`VITE_PROVER_SERVER_URI` to force a different (official) proof server →
that surfaced a **second, unrelated** 404 for
`midnight/zswap/output.prover`, which is what led to the investigation
above.

The real, full root cause was two-layered:

1. **The actual original blocker** (present the whole time, on both proof
   servers): `public/contracts/managed/did-registry/zkir/register_initial_admin.{bzkir,zkir}`
   had never been committed to git — same recurring class of bug as
   commits `9fe51b3` (missing `keys/*.prover`/`*.verifier`) and the
   earlier `23fe8bb` (missing `src/generated/*.runtime.js`). Every time a
   new circuit is added to the Compact contract, its full generated
   artifact set must be committed under
   `public/contracts/managed/<contract>/{compiler,contract,keys,zkir}/`
   (both the `<contract>#<circuit>` prefixed and unprefixed filename
   variants — `scripts/compile-contract.js` writes both) — see the
   "Avoiding this" checklist below. Because the ZKIR 404'd, *no* proving
   path — wallet-delegated or HTTP — could ever have produced a valid
   proof for this circuit, independent of which proof server was in use.
2. **A self-inflicted second failure**, introduced while chasing #1:
   setting `VITE_PROVER_SERVER_URI` switched the app into the HTTP-proof-server
   path, which (per the mechanism above) has no builtin-key fallback —
   surfacing the `midnight/zswap/output.prover` 404 on top of the real bug.

## Avoiding this in the future

**New circuit checklist** — whenever a Compact circuit is added or
renamed in `contracts/*.compact.template`:

1. `npm run compile-contract` (or the relevant `compile-*` script) locally.
2. Confirm the new circuit's artifacts exist in the *source* (gitignored)
   directory: `contracts/managed/<contract>/keys/{<circuit>,<contract>#<circuit>}.{prover,verifier}`
   and `contracts/managed/<contract>/zkir/{<circuit>,<contract>#<circuit>}.{bzkir,zkir}`.
3. Copy/regenerate them into `public/contracts/managed/<contract>/...`
   (same subpaths) — this is the tree actually served to the browser.
4. `git add -f` them explicitly (the `public/contracts/managed/*` glob is
   gitignored by design; committed ZK artifacts are an intentional,
   documented exception for Render's clean-clone Static Site build — see
   `.gitignore`).
5. Sanity check before pushing: `git ls-files public/contracts/managed/<contract>/keys/ public/contracts/managed/<contract>/zkir/ | grep <new_circuit_name>` should list 4 files (prover/verifier × prefixed/unprefixed) plus 4 more for zkir (bzkir/zkir × prefixed/unprefixed).

**`VITE_PROVER_SERVER_URI`**: leave it **unset** in every environment
(including Render) unless a proper builtin-key shim (a `SYSTEM_KEYS`
lookup like `midnightntwrk/passport`'s, checked *before* falling through
to the contract's own `ZKConfigProvider`) is implemented in
`lib/providers.ts`. If a configured HTTP proof server is ever genuinely
needed again (e.g. no wallet available), implement the shim first — don't
just point the env var at a URL.

## Update (2026-07-22): unsetting it was not sufficient — some wallets don't resolve builtins internally either

The original recommendation above ("unset it, the wallet handles
protocol builtins natively") turned out to be **wallet-specific, not
universal**. Confirmed in production: with `VITE_PROVER_SERVER_URI`
correctly unset, deploying + calling `register_initial_admin` (the first
circuit in this contract to call `mintShieldedToken`, so the first to ever
need a `midnight/zswap/output` proof) still 404'd fetching
`midnight%2Fzswap%2Foutput.{prover,verifier,bzkir}` from our own site and
timed out — with the **1AM** wallet extension. The reference
`midnight-wallet` SDK's `WasmProver.ts` (which Lace is built on) does
resolve these builtins internally from a fixed source without ever asking
the DApp's `ZKConfigProvider`; 1AM apparently does not implement the same
shortcut and falls back to asking us for them, same as a self-hosted HTTP
proof server would.

Since this project intentionally supports multiple wallets (not just
Lace), the fix had to work regardless of which wallet resolves proving —
so we now **serve the four protocol builtin keys ourselves**, same-origin,
sidestepping this entirely:

- `midnight/zswap/spend`, `midnight/zswap/output`, `midnight/zswap/sign`,
  `midnight/dust/spend` — each as `.prover`/`.verifier` (in `keys/`) and
  `.bzkir` (in `zkir/`). `NormalizedFetchZkConfigProvider` requests them as
  `${encodeURIComponent(circuitId)}${extension}`, e.g. a GET for
  `keys/midnight%2Fzswap%2Foutput.prover`. **Correction, found the hard way
  in production**: an earlier version of this fix placed a file literally
  named with the percent-encoded string as its filename (`midnight%2Fzswap%2Foutput.prover`,
  no subdirectory) — that is wrong. Render's edge (Cloudflare-fronted, and
  this is standard behavior for most CDNs/static hosts, not unusual)
  decodes `%2F` back to `/` before resolving the static file, so the
  request above actually needs a real `midnight/zswap/output.prover` file
  under a `midnight/zswap/` subdirectory, not a flat percent-encoded
  filename. Confirmed by curling the flat-filename version on the live
  deployment (`404`) after confirming it built into `dist/` correctly —
  the mismatch was purely at the hosting layer, not the build. Verify with
  a real HTTP request against the deployed origin before trusting either
  layout — a local filesystem check (`find`/`ls`) proves the build step
  worked, not that the hosting layer serves it at the URL the app actually
  requests.
- Sourced from `https://srs.midnight.network/{zswap,dust}/9/*` — verified
  via real HTTP fetch (`200`, correct binary `Content-Length` for all 12
  files, not HTML error pages). The `9` is the `midnight-ledger-static`
  crate version, confirmed via source inspection
  (`midnight-ledger/static/version`, and its use in
  `zswap/src/prove.rs`/`ledger/src/dust.rs` to build these exact path
  strings) to be the correct pin for `@midnight-ntwrk/ledger-v8 ^8.1.0` —
  it is a separate, independently-versioned artifact namespace from the
  ledger-wasm package's own `8.x` version, not something to guess by
  trial and error.
- **Both verified public sources for these files**
  (`midnight-s3-fileshare-dev-eu-west-1.s3.eu-west-1.amazonaws.com` and
  `srs.midnight.network`) **lack CORS headers** (`OPTIONS` preflight →
  `403`, no `Access-Control-Allow-Origin`). A direct browser-side fetch to
  either from our own DApp code (replicating `midnight-wallet`'s
  `SYSTEM_KEYS` pattern client-side) would likely be blocked by the
  browser's CORS policy — wallet extensions can get away with this fetch
  because extensions have relaxed cross-origin permissions a regular
  webpage does not. Fetching the files once (server-side, e.g. via
  `curl`, no browser involved) and committing them to serve same-origin
  avoids this entirely, and is why that's the fix here rather than a
  client-side `SYSTEM_KEYS` shim.
- Only needed for circuits that actually call `mintShieldedToken` (or
  otherwise construct a shielded output/spend) — most of this contract's
  admin-gated circuits only *spend* existing capability-token coins via
  `consumeAdminToken()`/`consumeToken()`, which is a different operation.
  If a future circuit is added to a *different* managed contract
  (`native-ownership-proof`, etc.) and also mints, the same 4×3 files need
  to be copied into that contract's `keys/`/`zkir/` directories too.

## `VITE_PROVER_SERVER_URI` and CORS on `/prove` itself

Separate from key/ZKIR resolution: `proof-server.preprod.midnight.network`'s
actual `/prove` endpoint also has **no CORS headers** — a browser-side
`fetch()` to it (which is what `httpClientProvingProvider` does when
`VITE_PROVER_SERVER_URI` is configured) is blocked outright
(`Access-Control-Allow-Origin` missing, `TypeError: Failed to fetch`).
This isn't specific to this one proof server — every external proof
server tried so far (1AM's, the official preprod one) has failed for a
CORS-shaped or CORS-adjacent reason when called directly from page JS.
Confirmed in `lib/providers.ts`'s own fallback path
(`configuredProofProvider` failing → `[providers] configured proof server
... failed, falling back to wallet prover`), the code already handles
this gracefully by falling back to wallet-delegated proving per proof —
but that fallback still costs a failed round trip per proof needed in the
transaction, and depends on the wallet's own proving succeeding after it.

Given both the key-serving problem (above) and this CORS problem are
solved by *not* going through an external HTTP proof server from the
browser at all, the working configuration for this project is:
**`VITE_PROVER_SERVER_URI` unset**, wallet-delegated proving only, with
this project's own `zkConfigProvider` serving both the contract's own
circuits and the four protocol builtins (see above) so any wallet's
delegated proving can resolve everything it needs from our own origin.
A self-hosted proof server would need to be reachable through something
other than a direct browser `fetch()` (e.g. proxied through this
project's own backend, which isn't subject to browser CORS) to be a
viable alternative.
