# MCP Connectors — Plan 2b: the three non-Claude adapters

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.
>
> **WORKTREE:** all work in `C:\Users\TK\.aoa\wt\mcp-connectors` (branch `feat/mcp-connectors`). The session default cwd is a DIFFERENT worktree WITHOUT this code. Every agent must confirm the worktree first.

**Goal:** Deliver external MCP connectors to `codex_local`, `opencode_local`, and `gemini_local` agent runs (heartbeat + crew), so connectors are no longer Claude-only.

**Architecture:** Specs flow to adapters via the (currently inert) `AdapterExecutionContext.mcpServers` plural carrier; **each adapter writes its own native config file**, because the destination path is computed inside the adapter (gemini/opencode from `cwd`; codex from a managed `CODEX_HOME`). Claude was the exception only because `--mcp-config <path>` lets the server choose the path. `connectorEnv` already reaches every adapter's child via the existing `config.env` → `mergeChildEnv` chain — no new env plumbing.

---

## Scope

**IN:** codex/opencode/gemini connector delivery on the **heartbeat + crew** agent-run paths.
**OUT (deferred):** Commander's codex path (separate turn loop — `runCodexTurn`; needs its own resolve + `mcpParams` threading + `spawnEnv` merge). Commander's opencode path is unsupported by construction (`resolveCliInvocation` returns `null`). Marketplace catalog (Plan 3), flagship plugins/OAuth (Plan 4).

## Locked decisions for this plan

| # | Decision | Why |
|---|---|---|
| **B1** | **codex managed home becomes PER-AGENT**: `~/.codex/aoa-instances/<companyId>/<agentId>`. | Today it is per-company, so per-agent opt-in (D4) is inexpressible — Agent A's connectors would be visible to Agent B, and concurrent runs race one `config.toml`. Per-agent preserves D4 and removes the race. Cost: `ensureCodexAuthInHome` must seed per agent. |
| **B2** | **Secret delivery is PER-CLI, not the shared `${VAR}`.** claude `${VAR}` (verified); **codex = env-var-NAME indirection** (`bearer_token_env_var`, flat form — verified against codex-cli 0.144.1); **opencode = `{env:VAR}`**; gemini = TBD by the Task 1 gate. | The shared `substitute()` emits the wrong syntax for codex and opencode. Each writer renders its own auth form from a common spec. |
| **B3** | **Add `authTokenEnvVar?: string` to `McpHttpServerSpec`.** Writers that need an env-var NAME (codex) read it directly. | Plan-1 amendment A3 anticipated this. Never regex-reverse `"Bearer ${VAR}"` back into a var name — brittle and breaks for any non-standard header template. `envVarNameFor(serverName)` already computes the exact name. |
| **B4** | **codex: prefer the FLAT `url` + `bearer_token_env_var` form**, not `[mcp_servers.x.http_headers]`. | Verified: the flat form round-trips and IS covered by the existing stripper. The sub-table form would be orphaned by `stripAoaMcpBlocks`. Choosing flat removes that orphan class entirely. |
| **B5** | **AoA-managed server blocks get an ownership marker; writers strip ALL AoA-managed names, not just their own.** | The stripper takes ONE `serverName` and there is no way to enumerate what a prior run wrote. A disabled/deleted connector's block would persist forever in the per-company/per-agent `config.toml` and the agent would keep the tool — a security-relevant staleness bug. Claude is immune (per-run tmpdir, unlinked on cleanup); these files persist. |
| **B6** | **gemini is GATED on Task 1.** If its `headers` do not expand env vars, gemini gets **no HTTP connectors** (stdio only) — it has no env-var-name fallback, and writing a live secret to disk violates D5. | Better to ship two adapters correctly than three with one silently authenticating as no-one. |

## Verified grounding (do not re-derive)

- `ctx.mcpServers` (`packages/adapter-utils/src/types.ts:325`) has **zero readers and zero writers** — Plan 2b wires both ends.
- Server seams (only two `adapter.execute({...})` sites): `heartbeat.ts:4549` and `runner.ts:620`, each alongside `mcpBridge:`.
- Server gates to relax: `heartbeat.ts:4287` (`if (agent.adapterType === "claude_local")`) and `runner.ts:378` (same).
- `heartbeat-mcp.ts:52-65` non-claude early return must (a) merge `connectorEnv` into `config.env` and (b) surface `extraMcpServers` on `HeartbeatMcpDelivery` (`:8-12`) so the caller can pass `mcpServers:`. Its inline comment already says: *do not merge connectorEnv without also delivering the specs*.
- Crew: hoist the `claudeEnvMerge` (`runner.ts:544-547`) out of the ternary so the non-claude branch (`:550`) gets it too.
- **Env reaches every child already:** each adapter copies `config.env` into its spawn env (codex `execute.ts:307-309`, opencode `:200-202`, gemini `:188-190`) and `mergeChildEnv(process.env, opts.env, …)` merges at spawn. No per-adapter env plumbing needed.
- Writer call sites: codex `execute.ts:347-363`, opencode `:135-151`, gemini `:123-140` — all read `ctx.mcpBridge` only.
- Current writers + their strip behaviour: codex `stripAoaMcpBlocks` targets only `[mcp_servers.X]` + `[mcp_servers.X.env]`; opencode `delete existingMcp[serverName]` and gemini `delete existingServers[serverName]` remove the whole node (no orphan risk for THEM, but see B5 for the multi-connector staleness problem, which affects all three).
- All three packages already depend on `@armyofagents/adapter-utils` and import from it — so importing `McpServerSpec` is fine. The "must not import from the server" convention bans server imports, not adapter-utils.
- `mergeExternalMcpServers` suits opencode/gemini (they build destination maps). **codex concatenates TOML strings** → use `stripReservedMcpServerNames` there, exactly as its docstring anticipates.
- codex `execute.ts:347-361` skips the MCP write for `sandbox-docker` targets AND is gated on `ctx.mcpBridge` being truthy — a connectors-only run would skip entirely. Must restructure.
- codex has two spawn paths but **one config write covers both** (same managed home).

---

## Task 1 — GATE: verify the per-CLI secret mechanism (gemini + opencode)

Nothing downstream is safe to build until we know how each CLI resolves a secret. codex is already verified (env-var-name indirection, flat `bearer_token_env_var`).

**Files:** none (empirical spike; record the result in this plan).

- [ ] **Step 1: gemini.** Install/locate `gemini-cli`. Write a `settings.json` with an HTTP MCP server whose `headers` contains `Authorization: Bearer ${AOA_PROBE_TOKEN}`, point it at a local HTTP listener that records the inbound header (mirror Plan 1's Task 4 probe method — a `node` server writing the received header to a file), run a one-shot gemini session with `AOA_PROBE_TOKEN=sentinel-12345` in env, and report **the header the listener actually received**.
  - Expanded (`Bearer sentinel-12345`) → gemini HTTP connectors are viable with `${VAR}`.
  - Literal (`Bearer ${AOA_PROBE_TOKEN}`) → **gemini gets stdio-only connectors** (B6); do NOT implement its HTTP branch.
  - If gemini-cli cannot be installed here, say so plainly and mark gemini DEFERRED — do not guess.
- [ ] **Step 2: opencode.** Same probe with `opencode.json` using `type:"remote"` + `headers: {Authorization: "Bearer {env:AOA_PROBE_TOKEN}"}`. Confirm `{env:VAR}` expands. Note the known upstream flakiness (opencode issue #5299 — `{env:...}` inconsistently failing for some URLs); if it fails, retry with a different URL before concluding.
- [ ] **Step 3: record.** Append a "Task 1 GATE RESULT" section to this plan with a per-CLI table (mechanism, verified/not, and the decision for each). Commit.

**This task gates Tasks 4-6.** If a CLI's mechanism is unverified, that CLI's HTTP writer is not built.

---

## Task 2 — Add `authTokenEnvVar` to the http spec (B3)

**Files:** `packages/adapter-utils/src/mcp-server-spec.ts`, its test; `server/src/services/mcp-connectors.ts` (populate it), its test.

- [ ] **Step 1: failing test.** In `packages/adapter-utils/src/__tests__/mcp-server-spec.test.ts`, assert an http spec may carry `authTokenEnvVar` and the guards still narrow correctly. In `server/src/services/__tests__/mcp-connectors.test.ts`, assert `buildConnectorSpecs` sets `authTokenEnvVar: envVarNameFor(serverName)` on http specs that have a secret, and omits it when `secretValue` is null.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: implement.** Add `authTokenEnvVar?: string` to `McpHttpServerSpec` with a doc comment: *the ENV VAR NAME (not the value) holding this connector's token, for CLIs that take an env-var name rather than expanding `${VAR}` — e.g. codex's `bearer_token_env_var`. Never a secret value.* In `buildConnectorSpecs`, set it from the same `envVarNameFor(row.serverName)` already used for the env map, only when `row.secretValue` is present.
- [ ] **Step 4:** run → PASS. Confirm existing Plan 1/2 tests still green (the field is optional and additive). Typecheck.
- [ ] **Step 5: commit** `feat(mcp): add authTokenEnvVar to McpHttpServerSpec for env-var-name CLIs`.

---

## Task 3 — Wire the plural carrier end-to-end (server side), un-gate non-claude

Makes `ctx.mcpServers` live and delivers `connectorEnv` to non-claude children. No adapter reads it yet (Tasks 4-6) — so this task must be behaviour-neutral for existing runs.

**Files:** `server/src/services/heartbeat.ts`, `heartbeat-mcp.ts`, `internal-agent/aoa-agents/runner.ts` + their tests.

- [ ] **Step 1: failing tests.** (a) `heartbeat-mcp.test.ts`: for a NON-claude adapter with connectors, the delivery result exposes `extraMcpServers` AND merges `connectorEnv` into `config.env`; with no connectors it is byte-identical to today. (b) `aoa-runner.test.ts`: a non-claude crew agent with connectors gets `connectorEnv` in `config.env` and `mcpServers` on the `adapter.execute` argument. (c) both: claude behaviour unchanged.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: implement.**
  - `heartbeat-mcp.ts`: add `extraMcpServers` to the `HeartbeatMcpDelivery` result type; in the non-claude early return, merge `connectorEnv` into `config.env` (same gated-when-non-empty shape as the claude branch) and return the specs. Delete the "do not merge without delivering specs" caveat comment — this task delivers both.
  - `heartbeat.ts`: relax the `claude_local` gate at `:4287` so connectors resolve for every CLI adapter (keep a gate if there are adapters with no MCP support at all — e.g. `process`/`http` — resolve only for the four CLI adapters). Pass `mcpServers: heartbeatMcpDelivery.extraMcpServers` at the `adapter.execute` literal (`:4549`), beside `mcpBridge:`.
  - `runner.ts`: relax the gate at `:378`; hoist the env merge out of the claude ternary so the non-claude branch gets it; add `mcpServers: extraMcpServers` at the `adapter.execute` literal (`:620`).
- [ ] **Step 4:** run all three suites + `pnpm --filter @armyofagents/server typecheck`. **Byte-identity for claude runs is the anti-regression** — Plan 1/2's heartbeat/crew tests must pass untouched.
- [ ] **Step 5: commit** `feat(mcp): populate ctx.mcpServers and deliver connectorEnv to non-claude adapters`.

---

## Task 4 — codex: per-agent managed home + staleness fix (B1, B5)

Do this BEFORE codex's HTTP writer — it changes where the file lives and how it is cleaned.

**Files:** `packages/adapters/codex-local/src/server/codex-home.ts`, `codex-config-toml.ts`, `execute.ts` + tests.

- [ ] **Step 1: failing tests.** (a) `resolveManagedCodexHomeDir` includes the agent id → two agents in one company get different dirs. (b) the writer strips ALL AoA-managed blocks (a block for a connector NOT in the current set is removed) while preserving a user's own hand-added `[mcp_servers.mine]`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: implement.**
  - `codex-home.ts`: change `resolveManagedCodexHomeDir(env, companyId)` → `(env, companyId, agentId)` returning `.../aoa-instances/<companyId>/<agentId>`. Update every caller (grep). Ensure `ensureCodexAuthInHome` seeds the new per-agent dir.

    > **CAUTION — do NOT sweep Commander into this.** Commander's codex path uses a DIFFERENT function, `codexHomeDirFor(companyId, userId)` (`server/src/services/internal-agent/cli-mode.ts`), keyed by company **and user**, not agent. It is out of scope for this plan (Commander codex is a deferred follow-up) and must keep its current per-company:user shape. Only the AGENT-side `resolveManagedCodexHomeDir` changes. When you grep for callers, classify each hit before editing — a blind rename would break Commander's session home and silently re-auth every user.
  - **Ownership marker (B5):** wrap AoA-written blocks in sentinel comments, e.g. `# >>> aoa-managed (do not edit)` … `# <<< aoa-managed`, and have the strip remove everything between the fences before rewriting. That makes "strip all AoA-managed" possible without enumerating names, and preserves user-authored blocks outside the fence. Keep `stripAoaMcpBlocks`'s existing per-name behaviour for the legacy un-fenced `aoa` block so an existing file upgrades cleanly on first write.
- [ ] **Step 4:** run codex adapter tests + typecheck. Verify an existing (pre-fence) `config.toml` upgrades without duplicating the `aoa` block.
- [ ] **Step 5: commit** `fix(mcp): per-agent codex managed home + AoA-managed block fencing`.

---

## Task 5 — codex writer: multi-server + remote HTTP (B2, B4)

**Files:** `codex-config-toml.ts`, `execute.ts` + tests.

- [ ] **Step 1: failing tests.** The writer accepts `external?: Record<string, McpServerSpec>` (imported from `@armyofagents/adapter-utils`) alongside the existing `aoa` spec and emits: the `aoa` stdio block; one `[mcp_servers.<name>]` per connector; for an http connector with `authTokenEnvVar`, the FLAT form `url = "..."` + `bearer_token_env_var = "AOA_MCP_X_TOKEN"` (**never** a plaintext token, never a `[.http_headers]` sub-table); for a stdio connector, `command`/`args`/`[.env]`. Reserved names (`aoa`, `playwright`) filtered via `stripReservedMcpServerNames`. Assert the emitted TOML contains no secret value.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: implement.** Extend `renderMcpBlock` with a transport switch; loop external specs inside the fence. Use `stripReservedMcpServerNames` (NOT `mergeExternalMcpServers` — codex concatenates strings and builds no destination map). Skip-and-continue on an unsupported transport rather than failing the run.
- [ ] **Step 4: read `ctx.mcpServers` in `execute.ts`.** Restructure the `:347-361` condition so the write happens when EITHER `ctx.mcpBridge` OR `ctx.mcpServers` is present (today it is gated on `mcpBridge` alone, so a connectors-only run would skip). Leave the `sandbox-docker` skip in place but log that connectors are also skipped there (pre-existing gap, documented).
- [ ] **Step 5:** tests + typecheck. **Commit** `feat(mcp): codex writer emits external connectors (flat bearer_token_env_var form)`.

---

## Task 6 — opencode + gemini writers (gemini CONDITIONAL on Task 1)

**Files:** `opencode-config-json.ts`, `gemini-settings-json.ts`, both `execute.ts` + tests.

- [ ] **Step 1: failing tests.** opencode: external http → `{type:"remote", url, headers:{Authorization:"Bearer {env:AOA_MCP_X_TOKEN}"}}` (note `{env:VAR}` syntax, per B2); external stdio → the existing `type:"local"` combined-array shape. gemini: **only if Task 1 verified header expansion** → `{httpUrl, headers:{Authorization:"Bearer ${AOA_MCP_X_TOKEN}"}}`; otherwise gemini emits stdio connectors only and http connectors are skipped with a warn. Both: multi-server, reserved names filtered, no plaintext secret, user-authored entries preserved, AoA-managed stale entries removed (B5 — these writers build maps, so track AoA-managed names in the emitted structure or strip by a known prefix/marker).
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: implement** both writers with a transport switch, using `mergeExternalMcpServers` (they build destination maps — this gives reserved-name filtering + the null-prototype destination in one call, per Plan-1 A14). Keep the existing atomic temp+rename and the `syncAdapterExecutionTargetFile` remote push.
- [ ] **Step 4: read `ctx.mcpServers`** in both `execute.ts` call sites (same restructure as codex: write when bridge OR connectors present).
- [ ] **Step 5:** tests + typecheck. **Commit** `feat(mcp): opencode + gemini writers emit external connectors`.

---

## Task 7 — End-to-end verification

- [ ] **Step 1:** `pnpm vitest run server/src`, `pnpm vitest run packages/adapter-utils`, and each adapter package's tests. Only accepted pre-existing failures: `github-integration` (env-host), `discussions-routes-contract` (perf flake). Any other failure is a regression — investigate.
- [ ] **Step 2:** `pnpm -r typecheck` clean; `pnpm check:tokens` clean.
- [ ] **Step 3: live** — extend `server/src/__tests__/mcp-connectors-plan2-e2e.integration.test.ts` (or a sibling) to drive the REAL delivery for a non-claude adapter against embedded-postgres: resolve connectors for a codex agent, invoke the REAL codex writer, and assert the emitted `config.toml` contains the connector's flat `bearer_token_env_var` form, the `aoa` block, **no plaintext secret**, and that a previously-written stale block is gone (B5). Per amendment A33: drive the real writers, never hand-assembled output.
- [ ] **Step 4: commit.**

---

## Deferred follow-ups

- **Commander codex connectors** — separate turn loop (`runCodexTurn`); needs its own resolve, `extraMcpServers` in its `mcpParams` literal, and `connectorEnv` merged into its `spawnEnv` before spawn. Note: codex Commander rewrites its config every turn, so it does NOT have the claude path's P2N2 staleness limitation.
- **Commander opencode** — unsupported by construction (`resolveCliInvocation` returns `null`).
- **codex `sandbox-docker`** — MCP config (bridge AND connectors) is skipped for that target; pre-existing.
- **codex remote targets** — `CODEX_HOME` points at a remote path while the writer writes locally, with no sync step; pre-existing.
- **opencode repo pollution** — `opencode.json` is written into the agent's working directory (often a real repo). Only placeholders, but the placeholder NAMES enumerate the company's connectors. Pre-existing pattern (the `aoa` bridge already does this); connectors widen it.

---

## Task 1 GATE RESULT (2026-07-24)

| CLI | Secret mechanism | Verified? | Decision |
|---|---|---|---|
| **claude** | `${VAR}` expansion in args/env/headers | ✅ Plan 1 Task 4, live | shipped |
| **codex** | **env-var-NAME indirection** — flat `url` + `bearer_token_env_var`; also `env_http_headers` (header→var-name map). NOT `${VAR}` expansion. | ✅ live, against installed `codex-cli 0.144.1` (`codex mcp add --help` + hand-written blocks round-tripped through `codex mcp get --json`) | **HTTP connectors viable — build it (B4 flat form)** |
| **gemini** | `env` block documented to expand `$VAR`/`${VAR}`; **`headers` expansion NOT documented and NOT verifiable here** | ❌ **BLOCKED** — `gemini-cli 0.52.0` fetches fine via npx, but exits at an auth wall (`Please set an Auth method … GEMINI_API_KEY / GOOGLE_GENAI_USE_VERTEXAI / GOOGLE_GENAI_USE_GCA`) **before ever connecting the MCP server**. The local listener was never contacted. Verifying requires a Google credential, which is the founder's to supply — not something to set up here. | **DEFER HTTP connectors (B6).** gemini has NO env-var-name fallback, so an unexpanded header authenticates as no-one, silently. |
| **opencode** | `{env:VAR}` (externally documented) | ❌ **BLOCKED** — not installed, and no `opencode` / `opencode-ai` / `@opencode-ai/opencode` package resolves on npm from here. Could not probe. | **DEFER HTTP connectors (B6).** |

**Consequence — Plan 2b scope narrows to codex + the shared server wiring.** Tasks 2, 3, 4, 5, 7 proceed as written. **Task 6 is cut** to a deferred follow-up: gemini and opencode HTTP writers wait until their mechanisms can be verified on a machine with those CLIs authenticated. The server-side plural-carrier wiring (Task 3) is adapter-agnostic, so when those writers are built later they plug into a delivery path that already works.

**To un-block later:** run the same probe method (local HTTP listener recording the inbound `Authorization` header, driven by a real one-shot session) on a machine where `gemini` is authenticated and `opencode` is installed. Do NOT ship either HTTP writer on documentation alone — codex's documented-looking `${VAR}` assumption turned out to be wrong, which is exactly why this gate exists.

### GATE RESULT — UPDATE 2 (opencode VERIFIED, auth-free)

**opencode is verified.** `opencode mcp list` (via `npx -y opencode-ai@latest`, v1.18.4) actually CONNECTS to configured servers to report status — no provider auth required. Probe: `opencode.json` with `{"mcp":{"probe":{"type":"remote","url":"http://127.0.0.1:8994/mcp","enabled":true,"headers":{"Authorization":"Bearer {env:AOA_PROBE_TOKEN}"}}}}`, run with `AOA_PROBE_TOKEN=sentinel-77777`. The local listener received **`Authorization: Bearer sentinel-77777`** — expanded. So **`{env:VAR}` works in opencode `headers`; opencode HTTP connectors are viable.**

Revised status: **codex ✅ / opencode ✅ / gemini ❌ (auth-blocked)**.

`opencode mcp list` is also the ideal regression probe for Plan 2b's opencode work — it exercises the real config file the adapter writes, with no model call.

**A NEW PRE-EXISTING BUG FOUND WHILE PROBING (not connector-related — worth its own fix):**

**B7 — AoA's gemini adapter never passes `--skip-trust`, so MCP servers may be silently disabled.** gemini-cli has a workspace-trust model: in an untrusted folder it prints *"MCP servers are configured but disabled because this folder is untrusted. User-level servers are also suppressed…"* and disables **every** MCP server — which would include AoA's own `aoa` bridge, not just connectors. `grep -rnE "skip-trust|skipTrust|trust" packages/adapters/gemini-local/src/` returns NOTHING, and the argv built in `gemini-local/src/server/execute.ts:302-312` is `["--output-format","stream-json", …, "--approval-mode","yolo", "--sandbox…", "--prompt", …]` — no trust flag. **Consequence: gemini agents running in an untrusted workspace may be getting ZERO AoA tools, silently.** Needs (a) confirming what gemini treats as trusted (a git repo? a previously-approved folder?) and (b) most likely passing `--skip-trust` in the adapter. This is independent of connectors and should be fixed regardless of whether gemini connectors ship.

### GATE RESULT — FINAL (all three verified; full scope restored)

**gemini is VERIFIED.** With an auth method configured in `~/.gemini/settings.json`, a real `gemini --skip-trust -p "say ok"` run from a dir containing `.gemini/settings.json` with `{"mcpServers":{"probe":{"httpUrl":"http://127.0.0.1:8993/mcp","headers":{"Authorization":"Bearer ${AOA_PROBE_TOKEN}"}}}}` and `AOA_PROBE_TOKEN=sentinel-98765` delivered **`Authorization: Bearer sentinel-98765`** to the local listener — **expanded**. So `${VAR}` DOES resolve in gemini `headers`.

Method note for re-runs: gemini connects MCP servers at STARTUP, before the model call. The probe's model call returned 403 (key invalid/quota) and the answer was still obtained — an auth *method* must be configured to get past the pre-flight check, but a working model quota is NOT required.

| CLI | Secret mechanism | Verified | Writer form |
|---|---|---|---|
| claude | `${VAR}` in args/env/headers | ✅ Plan 1 | shipped |
| **codex** | env-var **NAME** indirection | ✅ live | flat `url` + `bearer_token_env_var` (B4) |
| **opencode** | `{env:VAR}` | ✅ live, auth-free via `opencode mcp list` | `{type:"remote", url, headers:{...{env:VAR}}}` |
| **gemini** | `${VAR}` | ✅ live | `{httpUrl, headers:{...${VAR}}}` |

**FULL SCOPE RESTORED. Task 6 (opencode + gemini writers) is back IN, unconditional.** B6's gemini-defer clause is void. B2 stands and is now fully specified: three different auth renderings, one per adapter — codex reads `authTokenEnvVar` (B3), opencode emits `{env:<name>}`, gemini emits `${<name>}`. Each writer renders its own; do NOT share a single placeholder string across adapters.

**Regression probes for Plan 2b (all auth-free or near-enough):**
- codex: `codex mcp get <name> --json` (reports the full transport struct)
- opencode: `opencode mcp list` (connects, no provider auth needed)
- gemini: `gemini --skip-trust -p …` with an auth method configured (model quota not required)

## Execution notes (Plan 2b)

**B2N1 — `ctx.mcpServers` is set for `claude_local` TOO, and must stay INERT there (constraint on Tasks 4-6).** Task 3 populates the carrier at both `adapter.execute` sites unconditionally, including claude runs. Claude already receives connectors via its generated `--mcp-config` file. **If any task adds a `ctx.mcpServers` reader to `packages/adapters/claude-local/`, claude gets DOUBLE delivery** (file + carrier) — duplicate servers, or a merge conflict between the two. Do not add a carrier reader to claude-local. (Alternative if ever needed: have the claude call sites pass `undefined`.) Only codex/opencode/gemini writers read the carrier.

**B2N2 — the tmp claude-shaped `--mcp-config` file is now written on non-claude crew runs too.** `runner.ts` builds `buildMcpConfig({...mcpParams, extraMcpServers})` and writes it unconditionally, even for codex/opencode/gemini. Harmless today (placeholders only; not referenced by their argv; unlinked in `finally`). **Tasks 4-6 must NOT point those CLIs at this file** — each writes its own native config (TOML / opencode.json / .gemini/settings.json). If a task ever wants to skip that write for non-claude, that is a separate cleanup, not a Task 4-6 change.

**B2N3 — Commander is a THIRD `resolveAgentConnectors` call site with a different value domain.** `cli-mode.ts` gates on `config.cliTool === "claude_cli"` (a `cliTool` value), not `agent.adapterType`. `adapterSupportsConnectors()` does NOT apply there. Un-gating Commander for codex needs its own parallel predicate over `cliTool` — deferred (Commander codex is out of Plan 2b scope), recorded so it isn't forgotten.

**B2N4 — placement rationale correction.** The `adapterSupportsConnectors` predicate lives in the pure `mcp-connectors.ts` (not the loader) because `aoa-runner.test.ts` factory-mocks the loader module exporting ONLY `resolveAgentConnectors`. A predicate defined in the loader would be `undefined` under that suite and calling it throws `TypeError: adapterSupportsConnectors is not a function` — a hard crash, NOT a silent falsy gate (the original writeup said "silently evaluate falsy", which is wrong). The placement decision is correct; only the stated mechanism needed fixing.

**B2N5 — TASK 5 CONSTRAINT: there must be exactly ONE fenced writer.** `writeCodexMcpConfigToml` strips ALL fenced regions and re-emits ONE fenced block. If Task 5 adds a SECOND function that also fences its own region, whichever runs second deletes the first's region — **the bridge and the connectors would alternately erase each other, run to run**, producing an agent that has MCP tools on some runs and not others. Task 5 must EXTEND `writeCodexMcpConfigToml` (accept the `ctx.mcpServers` map alongside `mcpBridge` and render both into ONE fenced body), never add a parallel writer. Nothing in the code enforces this — add a comment at `stripAoaManagedFencedRegions` stating the single-writer invariant.

**B2N6 — TASK 5 CONSTRAINT: hoist the strip out of the `ctx.mcpBridge` gate.** Today the fence cleanup only happens as a side effect of writing the bridge block (`codex-local/src/server/execute.ts` ~:353, gated on `ctx.mcpBridge`). Both producers always set `mcpBridge` so it is safe today — but the field is typed OPTIONAL, and the day it becomes conditional (e.g. an agent with MCP disabled), stale fenced connector blocks would survive forever. That is precisely the failure the fence exists to close. Task 5 must run the strip regardless of whether a bridge is being written — i.e. gate the WRITE on `mcpBridge || mcpServers`, but run the CLEANUP unconditionally.

**B2N7 — Commander IS in this commit's blast radius (contrary to the task framing).** `cli-mode.ts:512` calls the shared `writeCodexMcpConfigToml`, so Commander's codex `config.toml` now gets fenced too. Signature unchanged, Commander's home is a managed tmpdir with no user content, its tests mock the writer, and the effect is strictly an improvement — but a future reader should NOT conclude "Commander is unaffected by codex writer changes" and skip its tests. Always run the Commander codex suites when touching `codex-config-toml.ts`.

**B2N8 — deferred cleanups from the Task 4 review (not blocking):** (a) `CODEX_ENV_TEST_AGENT_ID` is reachable by normalization — any id starting with a non-allowlisted char followed by `env-test` collapses onto `_env-test`; unreachable from the DB (uuid PKs), but moving the probe to a sibling root (e.g. `aoa-env-probe/<companyId>`) would make collision structurally impossible. (b) Orphaned legacy per-company homes (`~/.codex/aoa-instances/<companyId>/{auth.json,config.toml}`) are no longer read and are not swept. (c) `docs/aoa/plans/2026-06-24-provider-switching-watched-walkthrough.md:98,116,128,146` still documents the per-company path and cites stale line numbers.
