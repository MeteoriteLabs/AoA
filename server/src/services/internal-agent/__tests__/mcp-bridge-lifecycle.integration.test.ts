import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";

const BRIDGE = path.resolve(__dirname, "../mcp-bridge.ts");
const DB_URL = process.env.AOA_TEST_DATABASE_URL ?? "postgres://paperclip:paperclip@127.0.0.1:54440/paperclip";
const COMPANY = process.env.AOA_TEST_COMPANY_ID ?? "8d7569f2-43e9-4b57-8709-2a4687364e44";
const THREAD = process.env.AOA_TEST_THREAD_ID ?? "376592a2-91e6-4327-81fb-8fb7e498b6c4";

/**
 * F5 robustness: quick TCP probe of the DB host:port parsed from DB_URL.
 * If the DB is unreachable, the regression can't exercise the async tools/call
 * path, so we skip LOUDLY rather than failing opaquely.
 */
function probeDb(url: string, timeoutMs = 3_000): Promise<boolean> {
  return new Promise((resolve) => {
    let host = "127.0.0.1";
    let port = 5432;
    try {
      const u = new URL(url);
      host = u.hostname || host;
      port = u.port ? Number(u.port) : port;
    } catch {
      // Unparseable URL → treat as unreachable.
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

function runBridge(input: string, opts: { closeStdinAfterMs: number }): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    // NOTE: shell:true is required on Windows so the launcher resolves `tsx.cmd`.
    // With shell:true the args are concatenated (not escaped), so a bridge path
    // containing spaces (e.g. "...\Claude Data\...") would be split by the shell
    // and tsx would try to load the wrong file. JSON.stringify quotes the path so
    // it survives shell concatenation on every platform. This is a spawn-launch
    // robustness fix only — it does not change what is executed.
    const proc = spawn("tsx", [JSON.stringify(BRIDGE)], {
      env: {
        ...process.env,
        AOA_SESSION_COMPANY_ID: COMPANY,
        AOA_SESSION_USER_ID: "aoa-subagent",
        AOA_SESSION_USER_ROLE: "founder",
        AOA_SESSION_ENABLED_CAPABILITIES: "discussion_processing,system_actions",
        AOA_AGENT_KIND: "aoa",
        AOA_TOOL_ALLOWLIST: "thread.listEntries,get_thread_summary,thread.updateSummary",
        AOA_EFFECTIVE_AUTONOMY: "2",
        DATABASE_URL: DB_URL,
      },
      shell: true,
    });
    let stdout = "", stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => resolve({ stdout, stderr, code }));
    proc.stdin.write(input);
    setTimeout(() => proc.stdin.end(), opts.closeStdinAfterMs);
    setTimeout(() => proc.kill(), 30_000);
  });
}

describe("mcp-bridge EOF-mid-call (regression)", () => {
  it("delivers the tools/call response even when stdin EOFs immediately after the call", async () => {
    const reachable = await probeDb(DB_URL);
    if (!reachable) {
      // F5: skip loudly — do not fail opaquely when no DB backs the bridge.
      console.warn(`[skip] no DB reachable at ${DB_URL} — skipping EOF-mid-call regression`);
      return;
    }

    const input =
      JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1, params: {} }) + "\n" +
      JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 2 }) + "\n" +
      JSON.stringify({ jsonrpc: "2.0", method: "tools/call", id: 3, params: { name: "thread.listEntries", arguments: { threadId: THREAD } } }) + "\n";
    const { stdout } = await runBridge(input, { closeStdinAfterMs: 5 });
    const ids = stdout.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l).id; } catch { return null; } });
    expect(ids).toContain(3); // the tools/call response MUST land (result OR isError)
  }, 40_000);
});
