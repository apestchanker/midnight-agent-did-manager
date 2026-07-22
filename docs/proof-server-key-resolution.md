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
`lib/providers.ts`. Unset, the wallet handles protocol builtins natively
and correctly; our own `ZKConfigProvider` only ever needs to know about
our own contract's circuits, which is the case it's actually built for.
If a configured HTTP proof server is ever genuinely needed again (e.g. no
wallet available), implement the shim first — don't just point the env
var at a URL.
