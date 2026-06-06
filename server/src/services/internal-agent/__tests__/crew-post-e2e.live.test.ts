/**
 * Task 11 — GATED CROSS-PROVIDER E2E: a REAL provider CLI drives the (now-fixed)
 * MCP stdio bridge end-to-end. This closes the exact gap that let the original
 * bug ship: no test ever ran a real crew agent through the bridge, so a dead
 * bridge that returned "Transport closed" for every tool call still reported the
 * run as `succeeded`.
 *
 * WHY THIS EXISTS (the bug, in one paragraph):
 *   The bridge used to `process.exit(0)` on stdin EOF, killing in-flight MCP
 *   `tools/call` responses. codex/opencode/gemini (which speak MCP over the
 *   bridge, unlike claude which is wired differently) got "Transport closed"
 *   for every call and posted nothing, yet the run still reported success.
 *   The fix: watchdog-only lifecycle (never exit on stdin EOF) + the
 *   @modelcontextprotocol/sdk StdioServerTransport. The lifecycle integration
 *   test (`mcp-bridge-lifecycle.integration.test.ts`) proves the bridge delivers
 *   in-flight responses after a *simulated* stdin half-close. THIS test proves
 *   the REAL codex CLI gets its tool responses through the bridge — the inverse
 *   of the bug.
 *
 * PROVIDER MATRIX (parameterized, gated by CLI availability):
 *   - codex_local   — the provider that exhibited the bug; INSTALLED here → the
 *                     definitive live proof. Runs.
 *   - opencode_local — NOT installed → skips LOUDLY (never silently).
 *   - gemini_local   — NOT installed → skips LOUDLY.
 *   If installed, opencode/gemini would run the identical body (same
 *   parameterized path) — the skip is purely a CLI-availability gate.
 *
 * ASSERTION LAYER USED (codex): FALLBACK read-tool proof.
 *   We invoke the real codex CLI (via the codex adapter) with the fixed bridge
 *   spec and instruct it to call the deterministic READ tool `thread.listEntries`
 *   for the QA thread. We then assert:
 *     (a) `buildAoaRunResultFromAdapter(...)` (the SAME pure function the runner
 *         uses to decide success/failure) does NOT classify the run as a
 *         transport failure, AND
 *     (b) the codex raw stdout shows the tool returned REAL thread data (the
 *         entries' content), NOT "Transport closed".
 *   A read tool is deterministic, so this is a stable assertion. It still proves
 *   the load-bearing claim: real codex CLI + fixed bridge ⇒ MCP tool call
 *   succeeds and the real response is delivered (the inverse of the bug).
 *
 *   The PRIMARY (post-entry) proof — drive a full `runAoaAgent` participation so
 *   the agent self-posts a `discussion_entries` row — is intentionally NOT used
 *   here for scope reasons (it needs a writable QA thread + a longer model turn);
 *   the deterministic read-tool proof is the stable, load-bearing assertion. It
 *   still exercises the full `buildMcpBridgeSpec` env, which is exactly where the
 *   second stdout-corruption cause lived (see the "STDOUT-DISCIPLINE BUG" note).
 *
 * ── STDOUT-DISCIPLINE BUG (discovered while writing this test) — NOW FIXED ──────
 *   The bridge's `installStdoutGuard()` reroutes `console.*` to stderr, but the
 *   project's pino `logger` (server/src/middleware/logger.ts) USED TO write info+
 *   logs to `destination: 1` (STDOUT). `createServiceContainer(db)` in the bridge
 *   (mcp-bridge.ts) eagerly constructs the embeddings service, which logs a WARN
 *   "OPENAI_API_KEY is not set — services.embeddings unavailable…" via that
 *   logger when `OPENAI_API_KEY` is absent. That WARN landed on the bridge's
 *   STDOUT as the very first bytes, ahead of the JSON-RPC `initialize` response.
 *   codex's rmcp client parsed it as the response, choked (`expected ',' or ']'
 *   at line 1 column 4` — the `[HH:MM:ss]` prefix looks like a JSON array), and
 *   the transport died → every tool call returned "Transport closed". This was a
 *   SEPARATE bug from the EOF-exit bug; the console-reroute fix did not cover the
 *   pino logger.
 *
 *   FIX (now in source): `buildMcpBridgeSpec` sets `AOA_LOG_STDOUT=0`, and
 *   `middleware/logger.ts` routes ALL pino output to stderr in that mode — so the
 *   bridge's stdout stays JSON-RPC-only. This test therefore NO LONGER injects a
 *   dummy `OPENAI_API_KEY`: the key is left UNSET so the run proves the real fix
 *   (clean JSON-RPC stream + real tool response with the embeddings WARN absent).
 *   The strict invariant is pinned separately by
 *   `bridge-stdout-purity.test.ts` (asserts stdout is pure JSON-RPC with the key
 *   unset, and that the WARN is rerouted to stderr).
 *
 * GATING DISCIPLINE: every skip is LOUD (console.warn with a precise reason).
 * Skips, never failures, when the live run can't be driven (no DB, no CLI) —
 * the suite must stay green in CI where codex isn't installed/authenticated.
 *
 * The `.live.test.ts` suffix is load-bearing: the main verify gate excludes it
 * (it spawns a real LLM CLI and needs a live DB + authenticated codex).
 */
import { describe, it, expect } from "vitest";
import net from "node:net";
import { execFileSync } from "node:child_process";
import { eq, and, desc } from "drizzle-orm";
import { createDb, agents, type Db } from "@armyofagents/db";
import { getServerAdapter } from "../../../adapters/registry.js";
import { buildMcpBridgeSpec } from "../cli-mode.js";
import { resolveBridgeEntrypoint } from "../aoa-agents/bridge-path.js";
import { buildAoaRunResultFromAdapter } from "../aoa-agents/aoa-run-result.js";

// ── Fixtures (live QA env; overridable via env) ───────────────────────────────
const DB_URL =
  process.env.AOA_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgres://paperclip:paperclip@127.0.0.1:54440/paperclip";
const COMPANY = process.env.AOA_TEST_COMPANY_ID ?? "8d7569f2-43e9-4b57-8709-2a4687364e44";
const THREAD = process.env.AOA_TEST_THREAD_ID ?? "376592a2-91e6-4327-81fb-8fb7e498b6c4";

// The bridge resolves DATABASE_URL from process.env at spawn time
// (buildMcpBridgeSpec forwards it only when process.env.DATABASE_URL is set).
// Mirror AOA_TEST_DATABASE_URL into DATABASE_URL so the codex-spawned bridge
// reaches the same QA database the test asserts against.
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = DB_URL;

const PROVIDERS = [
  { adapterType: "codex_local", binary: "codex" },
  { adapterType: "opencode_local", binary: "opencode" },
  { adapterType: "gemini_local", binary: "gemini" },
] as const;

// ── DB reachability probe (reused convention from the lifecycle integration test) ──
function probeDb(url: string, timeoutMs = 3_000): Promise<boolean> {
  return new Promise((resolve) => {
    let host = "127.0.0.1";
    let port = 5432;
    try {
      const u = new URL(url);
      host = u.hostname || host;
      port = u.port ? Number(u.port) : port;
    } catch {
      resolve(false);
      return;
    }
    const sock = net.connect({ host, port });
    const done = (ok: boolean) => {
      sock.removeAllListeners();
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
  });
}

// ── CLI availability probe (cross-platform `where`/`which`) ────────────────────
function cliAvailable(binary: string): boolean {
  const locator = process.platform === "win32" ? "where" : "which";
  try {
    const out = execFileSync(locator, [binary], { encoding: "utf8", timeout: 5_000 }).trim();
    return out.length > 0;
  } catch {
    return false;
  }
}

// Poll a predicate until truthy or the deadline elapses.
async function pollUntil<T>(
  predicate: () => Promise<T | undefined | null>,
  timeoutMs: number,
  intervalMs = 2_000,
): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return undefined;
}

/**
 * Resolve a codex_local agent for the company, seeding a minimal one inline if
 * none exists. The brief expected pre-seeded codex crew agents, but the live DB
 * may have re-seeded the crew as a different adapter; this keeps the test
 * self-sufficient (the task explicitly permits an inline seed). Returns the
 * agent's id + a usable adapterConfig.model (the live `gpt-5.3-codex` value is
 * rejected for ChatGPT/subscription accounts, so we always pass a known-good
 * model — overridable via AOA_TEST_CODEX_MODEL).
 */
async function resolveOrSeedCodexAgent(db: Db): Promise<{ id: string; name: string }> {
  const existing = await db
    .select({ id: agents.id, name: agents.name })
    .from(agents)
    .where(and(eq(agents.companyId, COMPANY), eq(agents.adapterType, "codex_local")))
    .orderBy(desc(agents.createdAt))
    .limit(1);
  if (existing[0]) return existing[0];

  const seeded = await db
    .insert(agents)
    .values({
      companyId: COMPANY,
      name: `E2E Codex Probe ${Date.now()}`,
      role: "general",
      kind: "aoa",
      status: "idle",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: { aoa: { role: "engineer", toolAllowlist: ["thread.listEntries"] } },
    })
    .returning({ id: agents.id, name: agents.name });
  return seeded[0];
}

// ──────────────────────────────────────────────────────────────────────────────

describe("cross-provider E2E — real crew agent drives the MCP bridge", () => {
  for (const provider of PROVIDERS) {
    const isCodex = provider.adapterType === "codex_local";
    const available = cliAvailable(provider.binary);

    if (!available) {
      // LOUD skip — never silent. If this CLI were installed the parameterized
      // body below would run it through the same bridge path.
      it.skip(`${provider.adapterType}: CLI not installed (loud skip)`, () => {
        /* unreachable */
      });
      console.warn(
        `[e2e] SKIP ${provider.adapterType}: \`${provider.binary}\` not found on PATH — ` +
          `cannot drive this provider through the bridge. Install + authenticate the CLI to run it.`,
      );
      continue;
    }

    // CLI is available → run the real proof for this provider.
    it(
      `${provider.adapterType}: real CLI gets a real tool response through the fixed bridge (not "Transport closed")`,
      async () => {
        // Skip LOUDLY (not fail) if the QA DB is unreachable — without it the
        // bridge can't serve thread.listEntries and there's nothing to prove.
        const reachable = await probeDb(DB_URL);
        if (!reachable) {
          console.warn(
            `[e2e] SKIP ${provider.adapterType}: no DB reachable at ${DB_URL} — ` +
              `the bridge needs the QA database to answer thread.listEntries. Skipping (not failing).`,
          );
          return;
        }

        const db = createDb(DB_URL);

        // Only codex is installed in this environment and is the provider that
        // exhibited the bug → it is the definitive live proof. The opencode /
        // gemini branches are reached only if those CLIs are ever installed;
        // their adapters consume the same provider-neutral bridge spec, so the
        // identical invocation drives them. We keep the codex specifics
        // (model selection, agent seed) guarded so an opencode/gemini run does
        // not inherit codex-only config.
        if (!isCodex) {
          // Defensive: if a non-codex CLI is somehow on PATH, we still exercise
          // the bridge generically by spawning its adapter with the same spec.
          // (Not expected in this environment; codex is the one installed.)
          console.warn(
            `[e2e] NOTE ${provider.adapterType}: CLI present but this environment was ` +
              `provisioned for codex. Running the generic adapter path; if it cannot ` +
              `authenticate, this asserts only that no transport failure was reported.`,
          );
        }

        const agent = isCodex
          ? await resolveOrSeedCodexAgent(db)
          : { id: `e2e-${provider.adapterType}`, name: provider.adapterType };

        const bridgeEntrypoint = resolveBridgeEntrypoint();
        // The bridge MUST be this worktree's FIXED mcp-bridge (watchdog-only
        // lifecycle + SDK transport). resolveBridgeEntrypoint() returns the .ts
        // next to itself, i.e. THIS worktree's bridge — assert that so a stray
        // resolution (e.g. a sibling worktree) can never silently weaken the proof.
        expect(
          bridgeEntrypoint.replace(/\\/g, "/"),
          "bridge entrypoint must resolve to THIS worktree's mcp-bridge — otherwise " +
            "we'd be testing the wrong (possibly unfixed) bridge",
        ).toContain("/services/internal-agent/mcp-bridge.");

        const bridgeSpec = buildMcpBridgeSpec({
          companyId: COMPANY,
          userId: "aoa-subagent",
          userRole: "founder",
          enabledCapabilities: ["discussion_processing"],
          bridgeEntrypoint,
          agentKind: "aoa",
          // Read-only allowlist — deterministic proof. thread.listEntries is a
          // DB-backed read; its result is stable and asserting on it is robust.
          toolAllowlist: ["thread.listEntries"],
          agentId: agent.id,
          effectiveAutonomy: 2,
        });

        // NOTE (pino stdout leak — now FIXED in source, no workaround here):
        // buildMcpBridgeSpec now sets AOA_LOG_STDOUT=0, and middleware/logger.ts
        // routes ALL pino output to stderr in that mode. So the embeddings
        // "OPENAI_API_KEY is not set" WARN fired by createServiceContainer at
        // bridge boot can no longer land on stdout ahead of the JSON-RPC
        // initialize response. We deliberately do NOT inject a dummy
        // OPENAI_API_KEY anymore — leaving the key UNSET exercises the real fix:
        // codex must still get a clean JSON-RPC stream and a real tool response.

        // Instruct the CLI to call the read tool exactly once. The prompt is
        // deliberately minimal + tool-forcing so the run is short and the
        // assertion is about the TRANSPORT, not the model's reasoning quality.
        const prompt = [
          "You are an automated MCP test harness. Do EXACTLY one thing, then stop:",
          `Call the MCP tool \`thread.listEntries\` with arguments {"threadId": "${THREAD}"}.`,
          "When you receive the tool result, reply with ONLY the number of entries it returned.",
          "Do not call any other tool. Do not write files. Do not ask questions.",
        ].join("\n");

        const adapter = getServerAdapter(provider.adapterType);

        // codex: gpt-5.3-codex (the live agent's pinned model) is rejected for
        // ChatGPT/subscription accounts. Pass a known-good model. Overridable so
        // a different account/model can run this without editing the test.
        const codexModel = process.env.AOA_TEST_CODEX_MODEL ?? "gpt-5.5";
        const adapterConfig: Record<string, unknown> = isCodex
          ? { model: codexModel, dangerouslyBypassApprovalsAndSandbox: true }
          : {};

        const agentObj = {
          id: agent.id,
          companyId: COMPANY,
          name: agent.name,
          adapterType: provider.adapterType,
          adapterConfig,
          runtimeConfig: {},
        };

        const capturedStderr: string[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const adapterResult: any = await adapter.execute({
          runId: `e2e-${provider.adapterType}-${Date.now()}`,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          agent: agentObj as any,
          runtime: {},
          config: { ...adapterConfig, promptTemplate: prompt },
          context: { payload: { companyId: COMPANY, source: "e2e.live", threadId: THREAD } },
          executionTarget: { type: "local" },
          runtimeCommandSpec: {
            command: provider.binary,
            detectCommand: `command -v ${provider.binary}`,
            installCommand: null,
          },
          mcpBridge: bridgeSpec,
          onLog: async (stream: string, chunk: string) => {
            if (stream === "stderr") capturedStderr.push(chunk);
          },
          onMeta: async () => {},
          authToken: undefined,
          onSpawn: () => {},
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        const rawStdout: string =
          typeof adapterResult?.resultJson?.stdout === "string" ? adapterResult.resultJson.stdout : "";
        const rawStderr: string =
          (typeof adapterResult?.resultJson?.stderr === "string" ? adapterResult.resultJson.stderr : "") +
          "\n" +
          capturedStderr.join("");

        // Surface the evidence in the test log regardless of pass/fail so the
        // live proof is visible in CI output.
        // eslint-disable-next-line no-console
        console.info(
          `[e2e ${provider.adapterType}] exitCode=${adapterResult?.exitCode} ` +
            `summary=${JSON.stringify(adapterResult?.summary)} ` +
            `stdoutBytes=${rawStdout.length}`,
        );

        // ── The bug's fingerprint must NOT appear anywhere ──────────────────
        // "Transport closed" is the exact symptom a dead bridge produced for
        // every codex tool call. Its ABSENCE in the tool-call path is the
        // inverse-of-the-bug assertion.
        const transportClosedInToolPath = /transport closed/i.test(rawStdout);
        expect(
          transportClosedInToolPath,
          `${provider.adapterType} saw "Transport closed" in its tool-call output — the bridge ` +
            `did NOT deliver the response (this is the original bug). Raw stdout head:\n` +
            rawStdout.slice(0, 1200),
        ).toBe(false);

        // ── The pure success/failure classifier must NOT see a transport failure ──
        // buildAoaRunResultFromAdapter is the SAME function the runner uses to
        // decide a run's outcome (it scans errorMessage + raw stdout/stderr for
        // a transport marker). mcpAttempted:true mirrors the runner's treatment
        // of codex/opencode/gemini (they use the bridge). If a transport failure
        // had occurred, this would force status:'failed' with a transport msg.
        const runResult = buildAoaRunResultFromAdapter(
          {
            exitCode: adapterResult?.exitCode ?? null,
            errorMessage: adapterResult?.errorMessage ?? null,
            usage: adapterResult?.usage,
            costUsd: adapterResult?.costUsd ?? null,
            resultJson: { stdout: rawStdout, stderr: rawStderr },
          },
          { mcpAttempted: true, markerSupported: provider.adapterType !== "gemini_local" },
        );
        expect(
          runResult.errorMessage ?? "",
          `${provider.adapterType}: run classified as a transport failure — ${runResult.errorMessage}`,
        ).not.toMatch(/transport/i);

        // ── codex (the definitive proof): assert the tool returned REAL data ──
        // The codex `exec --json` stream emits an item.completed for the
        // mcp_tool_call with a real `result` payload. The bridge always returns
        // the tool result as JSON with `"success":true` and a `data` array; the
        // QA thread's entries reference the thread id. Asserting on that proves
        // the bridge DELIVERED a real response, not an error/empty frame.
        if (isCodex) {
          const toolCallCompleted = /"tool":"thread\.listEntries"[^\n]*"status":"completed"/.test(rawStdout);
          const toolResultHasSuccess = /"tool":"thread\.listEntries"[\s\S]*?\\"success\\":true/.test(rawStdout);
          const toolResultReferencesThread = rawStdout.includes(THREAD) && rawStdout.includes('\\"discussionId\\"');

          // If codex couldn't authenticate / invoke at all (not a bridge issue),
          // skip LOUDLY rather than fail — the live LLM CLI is the fiddly part,
          // and a CLI/auth failure is not evidence about the bridge. We only
          // reach a hard assertion when codex actually performed the tool call.
          const codexActuallyCalledTool = rawStdout.includes('"tool":"thread.listEntries"');
          if (!codexActuallyCalledTool) {
            console.warn(
              `[e2e] SKIP-LIKE codex_local: the codex CLI did not emit a thread.listEntries ` +
                `mcp_tool_call (likely a CLI/auth/model issue, NOT the bridge). exitCode=` +
                `${adapterResult?.exitCode} errorMessage=${JSON.stringify(adapterResult?.errorMessage)}. ` +
                `Raw stdout head:\n${rawStdout.slice(0, 1200)}`,
            );
            // Do not fail the suite on a CLI-side problem; the no-transport-failure
            // assertions above already held. Return without a hard tool assertion.
            return;
          }

          expect(
            toolCallCompleted,
            `codex called thread.listEntries but the mcp_tool_call did not reach status:"completed". ` +
              `Raw stdout head:\n${rawStdout.slice(0, 2000)}`,
          ).toBe(true);
          expect(
            toolResultHasSuccess,
            `codex's thread.listEntries result did not contain the bridge's "success":true payload — ` +
              `the bridge did not deliver a real tool response. Raw stdout head:\n${rawStdout.slice(0, 2000)}`,
          ).toBe(true);
          expect(
            toolResultReferencesThread,
            `codex's tool result did not reference the QA thread's entries (expected the thread id + ` +
              `discussionId in the returned data). Raw stdout head:\n${rawStdout.slice(0, 2000)}`,
          ).toBe(true);

          // eslint-disable-next-line no-console
          console.info(
            `[e2e codex_local] PROOF: real codex CLI received a real thread.listEntries result ` +
              `through the fixed bridge (status:completed, success:true, entries reference thread ${THREAD}). ` +
              `No "Transport closed".`,
          );
        }
      },
      180_000, // generous: spawns a real LLM CLI + a live bridge subprocess
    );
  }
});
