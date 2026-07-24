# MCP Connectors — Follow-up Register

Everything identified across Plans 1, 2 and 2b that was **deliberately not fixed in place**,
plus constraints discovered along the way that future work inherits.

Kept as a standing document so these do not survive only as buried plan amendments.
Last updated 2026-07-24 (`integration/connectors-marketplace`, HEAD `53180c129`).

Severity: **P1** = user-visible correctness or security · **P2** = robustness / maintenance ·
**P3** = docs, cleanup, cosmetics.

---

## Open

### FU-1 — Connector delivery skips are invisible to founders · P1
*Tracked as session task #27.*

A connector can be skipped at delivery time (`secret_unreachable`, `reserved_name`, D7 block)
and today that lands **only in a run log line**. Server-side `ConnectorSkipReason` goes to
`logger.warn` (`server/src/services/mcp-connectors-loader.ts:180`); `MCPConnectorsSection.tsx`
shows no health or last-skip state. A founder must open the specific run's log and know to
look for it.

This directly contradicts the stated goal of the whole workstream — *no connector ever
vanishes silently*. Fix: a per-connector "not delivered to `<agent>`: `<reason>`" badge in
Settings. Plan 3 §4.6 should share this surface with the "Needs setup" badge; both answer
"why isn't this connector working?"

### FU-2 — `${TOKEN}` in a stdio `command` is never substituted · P2
`buildConnectorSpecs` substitutes placeholders in `args`, `envTemplate` and `headers`, but
copies `command` verbatim. So `command: "/opt/${TOKEN}/srv"` emits the literal `${TOKEN}` to
codex and opencode with no skip. It fails loudly at spawn rather than silently, and the
writers are self-consistent with the builder — but it is an undocumented hole in the
substitution surface. Either substitute it or reject it at create time.

### FU-3 — Concurrent runs in the same cwd race on config read-modify-write · P2
Individual writes are atomic (`renameWithRetry`), but read-modify-write is not. Two
simultaneous `writeOpenCodeMcpConfigJson` calls in one cwd produced `config=[aoa,alpha]`,
losing `beta`. Pre-existing for the MCP bridge; connectors widen the blast radius. Needs a
lock or a per-run config path.

### FU-4 — gemini loads ZERO MCP servers under `folderTrust` · P1 (no known remedy)
With `security.folderTrust.enabled: true`, gemini disables **every** MCP server including
AoA's own bridge, so gemini agents get no tools at all.

**Empirically disproven remedies** (probed 2026-07-24 with a stdio recorder, isolated HOME):

| config | result |
|---|---|
| plain | not spawned — "folder is untrusted" |
| `--skip-trust` | **not spawned** (warning suppressed, servers still disabled) |
| per-server `"trust": true` | not spawned |

All three spawn normally when `folderTrust` is disabled (the default). There is no trust
registry AoA can write — `~/.gemini/projects.json` is only a project-name map and no
`trustedFolders.json` is ever created.

Shipped mitigation: detect-and-warn (`gemini-folder-trust.ts`). **Do not "fix" this by
adding `--skip-trust`** — it advertises "Trust the current workspace for this session" but
does not re-enable MCP. Plan 2b amendment B7-CORRECTED holds the detail. Revisit if
gemini-cli changes behaviour upstream.

### FU-5 — codex cannot deliver stdio connectors that carry a secret · P2 (by design)
Codex expands no `${VAR}` in stdio `args`/`env` **and** does not pass its own environment to
MCP children, so there is no route for the credential. Such connectors are skipped with
`secret_unreachable`.

**Forbidden "fixes"**, recorded so nobody re-derives them: expanding the placeholder at
write time puts a live token on disk and reverses D5; `shell_environment_policy.inherit=all`
is global and would leak every env var — including other connectors' tokens — into every
shell command the agent runs.

Only resolvable if codex adds stdio env-var-name indirection (it has `bearer_token_env_var`
and `env_http_headers` for HTTP only).

### FU-6 — gemini stdio expansion never re-confirmed live under trust · P3
The per-CLI matrix's gemini stdio row rests on a single probe. The Task 7 reviewer could not
re-verify it because servers never spawned under folder trust, and the model call 403s on
this machine's API key. Re-probe on a gemini install with working quota.

### FU-7 — codex emits a duplicate table header on out-of-fence collision · P3
If a user hand-writes `[mcp_servers.notion]` outside the AoA-managed fence and a managed
connector has the same name, both headers land in `config.toml`. Codex takes last-wins, so
it is cosmetic — but confusing to read.

### FU-8 — Commander's codex path passes no connectors · P2
Plan 2 wired Commander connector delivery for the claude path; `cli-mode.ts`'s codex branch
does not pass `mcpServers`. Pre-existing, not a Plan 2b regression, but it means a
codex-mode Commander sees no external connectors.

### FU-9 — Marketplace catalog does not scale past ~10k items · P2 (constraint)
The browser downloads the **entire** catalog (`ui/src/api/marketplace.ts:105`) and every
filter/sort is a pure client-side function. Measured 2026-07-24: **1.47 MB / 514 items**,
~2,154 B per non-skill item.

This is why Plan 3 rejects bulk registry import (design §3.2) and uses a search endpoint.
Any future work that wants a large catalog must first add server-side search and pagination
— which affects every item type, not just connectors.

### FU-10 — Governance: authenticated-mode activation is approval-only · P3 (decision)
A founder **cannot** self-activate a connector via PATCH in `authenticated` mode; the
`install_mcp_connector` approval is the sole activation path (C2). This is deliberate and
strict. Open question for the founder: relax to self-serve, or keep board accountability?

### FU-11 — codex managed-home cleanups (Plan 2b B2N8) · P3
(a) `CODEX_ENV_TEST_AGENT_ID` is reachable by normalisation — any id starting with a
non-allowlisted char followed by `env-test` collapses onto `_env-test`. Unreachable from the
DB (uuid PKs), but a sibling root would make collision structurally impossible.
(b) Orphaned legacy per-company homes (`~/.codex/aoa-instances/<companyId>/…`) are no longer
read and are never swept.
(c) `docs/aoa/plans/2026-06-24-provider-switching-watched-walkthrough.md:98,116,128,146`
still documents the per-company path with stale line numbers.

---

## Pre-existing, not caused by this work

### FU-12 — `*-routes-contract` perf flakes are load-dependent · P2
`discussions-routes-contract`, `teams-routes-contract` and `routines-routes-contract` each
failed a 3000 ms budget under full-suite load and passed in isolation (e.g. 1482 ms). It is
not a specific file — it is whichever loses the scheduling race. Either raise the budget or
stop asserting wall-clock in a parallel suite.

### FU-13 — `github-integration` test asserts the wrong host · P2
Expects `http://localhost:5173/…`, gets `http://127.0.0.1:3100/…`. Confirmed failing on
clean HEAD.

---

## Closed during Plans 1/2/2b (recorded so they are not re-opened)

- **RCE chain** — missing D7 stdio gate + PATCH `pending_approval→active` + client-trusted
  `source`. Fixed as a set; `source` is now server-forced.
- **Arg-injection bypass** — the crew runner sanitised `args` while the adapter *prefers*
  `extraArgs`, so a founder's path survived and AoA's own config was shadowed. Fixed by
  targeting the adapter-preferred key.
- **Data-loss bug** — an unmatched `# >>> aoa-managed` comment in a user's config caused
  strip-to-EOF, silently deleting the remainder. Fixed: unmatched start fence is not a
  fence, plus atomic write.
- **Silently unauthenticated codex connectors** — non-bearer HTTP auth was dropped and a
  bogus `Authorization` invented. Fixed via `env_http_headers` (verified live: the real
  header value reaches the server).
- **In-file catalog marker key is fatal on opencode** — an unrecognised top-level key makes
  opencode reject the *entire* config, loading zero MCP servers including AoA's bridge.
  Hence the sidecar manifest, stored outside the agent cwd.
