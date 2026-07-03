# Codex `app-server` protocol — W5c runtime-decision bridge (Task 1 verdict)

**Gate outcome: PASS — command + file-change.** Live-verified against real
`codex app-server` (codex-cli **0.130.0**, ChatGPT auth) on Windows. No descope.

The W5c bridge re-platforms `codex_local` from `codex exec` (one-shot, no callback)
to `codex app-server` (stateful JSON-RPC over stdio), which exposes a **blocking
approve/deny callback** the current `exec` spawn does not have.

Harness: `packages/adapters/codex-local/src/server/__tests__/appserver-spike.test.ts`
(live half gated on `AOA_CODEX_APPSERVER_LIVE=1`; parser half always-on).
Raw captured turn stream: `.../__tests__/fixtures/appserver-turn.json`.

---

## 1. Transport & handshake

`codex app-server` speaks **newline-delimited JSON-RPC 2.0 over stdio**. Spawn on
Windows as `spawn("codex", ["app-server"], { shell: true, cwd, stdio: [pipe,pipe,pipe] })`.

Client sequence:

1. `initialize` (id=1) → wait for response.
2. `initialized` notification (no id).
3. `thread/start` (id=2) `{ cwd, approvalPolicy }` → response carries `result.thread.id`.
   (A `thread/started` notification also carries the id.)
4. `turn/start` (id=N) `{ threadId, approvalPolicy, input: [{ type: "text", text }] }`.

During a turn the **server** sends approval **requests** (frames with BOTH a
`method` and an `id`). The client must answer each with a JSON-RPC **response**
`{ jsonrpc, id, result: { decision } }`. This blocking loop is the heart of the bridge.

---

## 2. Approval policy — chosen: `untrusted`

v2 `AskForApproval` = `"untrusted" | "on-failure" | "on-request" | { granular } | "never"`.

| Policy | benign/trusted cmd (`echo hi`) | risky cmd (network) | file write |
|--------|-------------------------------|---------------------|------------|
| `untrusted`  | **auto-approve** (no request) | **prompt** | **prompt** |
| `on-request` | prompt (every command) | prompt | prompt |

**Winner: `untrusted`.** It is the only policy that both auto-approves benign
commands AND prompts for risky commands + file changes — the "let trusted work
flow, gate the dangerous" behavior the bridge needs. `on-request` prompts for
*every* command (even `echo hi`), which would drown the founder in approvals.

Note: command-vs-command classification is about command **content**, not policy —
under `untrusted`, `echo hi` auto-approves but an arbitrary
`powershell -Command "Write-Output hi"` invocation prompts (codex's trusted-command
list doesn't cover ad-hoc powershell on Windows). The bridge should treat any
`item/commandExecution/requestApproval` as a real gate regardless of how "benign"
the command looks.

---

## 3. File-change approval — CONFIRMED firing

Under `untrusted`, prompting the model to write a file in `cwd` fires:

- **method:** `item/fileChange/requestApproval`
- **params:** `{ threadId, turnId, itemId, startedAtMs, reason?: string|null, grantRoot?: string|null }`
  (live capture: `reason` and `grantRoot` were both `null`.)
- The actual patch/diff is delivered separately on the `item/started` /
  `item/completed` frames for the `fileChange` item (`params.item.changes[]` with
  `{ path, kind: { type: "add"|... }, diff }`) and on `turn/diff/updated`.

Not descoped — the bridge ships **command + file-change**.

---

## 4. Decision enums (codex 0.130 v2)

Answer with `result.decision` = one of:

- **command** (`CommandExecutionApprovalDecision`):
  `"accept" | "acceptForSession" | { "acceptWithExecpolicyAmendment": {...} } | { "applyNetworkPolicyAmendment": {...} } | "decline" | "cancel"`
- **file-change** (`FileChangeApprovalDecision`):
  `"accept" | "acceptForSession" | "decline" | "cancel"`

The bridge uses **`accept`** (approve), **`decline`** (deny), and optionally
**`acceptForSession`** (approve + remember for the session).

Pitfalls:
- These are the **v2** camelCase enums. The **legacy** top-level `ReviewDecision`
  (snake_case: `approved | approved_for_session | denied | abort | ...`) pairs with
  the legacy `execCommandApproval` / `applyPatchApproval` server requests. Under
  `app-server` v2 the requests are `item/.../requestApproval` and expect the v2
  enum. Sending a legacy variant to a v2 request fails to deserialize.
- The live command-approval payload advertised `availableDecisions:
  ["accept", { acceptWithExecpolicyAmendment: {...} }, "cancel"]` — `decline` was
  **not** listed, yet sending `{ decision: "decline" }` was accepted and the server
  rejected the command (stderr: `exec command rejected by user`). So `decline` is a
  valid universal deny even when omitted from `availableDecisions`.

---

## 5. Request method + params — both approval kinds

Command approval (`CommandExecutionRequestApprovalParams`):

```
method: "item/commandExecution/requestApproval"
id:     <RequestId>            // answer with this id
params: {
  threadId, turnId, itemId, startedAtMs,
  approvalId?: string|null,    // null for regular shell/exec; UUID for zsh-bridge subcmds
  reason?: string|null,        // e.g. network-access rationale
  networkApprovalContext?: ... |null,
  command?: string|null,       // the command string
  cwd?: string|null,
  commandActions?: CommandAction[]|null,
  proposedExecpolicyAmendment?: ExecPolicyAmendment|null,
  proposedNetworkPolicyAmendments?: NetworkPolicyAmendment[]|null,
  availableDecisions?: [...]   // advisory; not exhaustive (see §4)
}
```

File-change approval (`FileChangeRequestApprovalParams`):

```
method: "item/fileChange/requestApproval"
id:     <RequestId>
params: { threadId, turnId, itemId, startedAtMs, reason?: string|null, grantRoot?: string|null }
```

Answer both with `{ jsonrpc: "2.0", id, result: { decision: <enum> } }`. The server
then emits a `serverRequest/resolved` `{ threadId, requestId }` notification.

---

## 6. Token usage — `thread/tokenUsage/updated` (cached tokens ARE present)

```
method: "thread/tokenUsage/updated"
params: {
  threadId, turnId,
  tokenUsage: {
    total: TokenUsageBreakdown,
    last:  TokenUsageBreakdown,
    modelContextWindow: number | null
  }
}

TokenUsageBreakdown = {
  totalTokens:            number,
  inputTokens:            number,
  cachedInputTokens:      number,   // <-- PRESENT (camelCase). Cost under-reports without it.
  outputTokens:           number,
  reasoningOutputTokens:  number
}
```

Cost accounting must subtract/discount `cachedInputTokens` from `inputTokens` (cached
input is billed at a lower rate). The field is camelCase `cachedInputTokens` — **not**
snake_case `cached_input_tokens`.

---

## 7. Notification stream shapes (for the parser)

Captured in the fixture (raw, in order). Relevant `ServerNotification` methods:

- `thread/started` `{ threadId | thread }`
- `turn/started` / `turn/completed` / `turn/failed` (`turn/failed` carries `turn.error`)
- `item/started` / `item/completed` — `params.item.type` ∈
  `userMessage | reasoning | commandExecution | fileChange | agentMessage`.
  - `commandExecution` item: `{ id, command, status, ... }`
  - `fileChange` item: `{ id, changes: [{ path, kind, diff }], status }`
  - `agentMessage` item: `{ id, text, phase: "commentary"|"final_answer", ... }`
- `item/agentMessage/delta` `{ threadId, turnId, itemId, delta }` — streamed text tokens.
- `item/reasoning/textDelta` / `item/reasoning/summaryTextDelta` — reasoning stream
  (not always emitted; depends on model/effort — none in this capture).
- `thread/tokenUsage/updated` (see §6).
- `thread/status/changed` `{ status: { type: "active"|"idle", activeFlags: [...] } }` —
  `activeFlags` includes `"waitingOnApproval"` while a request is outstanding.
- `turn/diff/updated` `{ threadId, turnId, diff }` — cumulative unified diff.
- `serverRequest/resolved` `{ threadId, requestId }` — emitted after an approval answer.
- `account/rateLimits/updated`, `mcpServer/startupStatus/updated`, `warning`,
  `remoteControl/status/changed` — ambient; the bridge can ignore these.
- `error` `{ ... willRetry ... }` — retryable-error notification. Not captured in this
  run (no error occurred); the parser should still handle it (`ErrorNotification`).

---

## 8. JSONL framing — partial-line buffering is REQUIRED

Confirmed live: stdout frames **split across chunks** and **multiple frames arrive in
one chunk**. The read loop MUST carry a partial-line buffer and split on `\n`,
`JSON.parse` each complete line, and keep the trailing partial for the next chunk.
A naive "one chunk = one frame" reader will corrupt the stream. See
`makeFrameReader` in the harness for the canonical loop; the framing test asserts
both the split-across-chunks and multiple-in-one-chunk cases.

A server **request** is distinguished from a **notification** by the presence of an
`id`: `method && id !== undefined` ⇒ must be answered; `method` only ⇒ fire-and-forget.

---

## 8b. Cross-path session resume (supervision toggle)

Supervision is decided **per run**, so a stored session id may have been created
by the legacy `codex exec` path and later encountered by the `app-server` driver
(or vice-versa). The driver (`app-server/driver.ts`) does **not** force a resume
of a possibly-non-portable id: it **attempts `thread/resume` and falls back to a
fresh `thread/start` on an unknown-session error** (`isCodexUnknownSessionError`,
same detector the `exec` path uses).

- If the id is portable across the two spawn modes, `thread/resume` just works and
  the turn continues on the stored thread.
- If it is **not** portable, codex returns an unknown-session error and the driver
  starts a fresh thread, capturing the new id. `clearSession` is set **only** when
  the resume was expected-missing **and no replacement id was obtained** (mirrors
  `execute.ts` `toResult`: `clearSessionOnMissingSession && !resolvedSessionId`) —
  a freshly created thread id is never wiped.

Net effect: toggling supervision at worst starts a **new** thread; it never
errors the run. Portability itself is not proved here — the guarded live harness
(`AOA_CODEX_APPSERVER_LIVE=1`) can confirm it later; this note documents the
safe-by-construction fallback the driver relies on.

---

## 9. Reproduce

```
# skip-clean (no codex needed): parser tests run, live test skips
pnpm test:run appserver-spike

# live (needs codex 0.130 logged in): drives real app-server, ~21s, 2 model turns
AOA_CODEX_APPSERVER_LIVE=1 pnpm test:run appserver-spike
```

Regenerate the reference protocol TS types with:
`codex app-server generate-ts --out <dir>` (v2 shapes live under `<dir>/v2/`).
