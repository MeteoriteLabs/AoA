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
    let stdout = "", stderr = "", done = false;

    // The bridge no longer self-exits on stdin EOF (watchdog-only lifecycle), so
    // we cannot wait for proc.on("close"). Resolve as soon as the id-3 response
    // lands, then reap the whole process tree. On Windows proc.pid is the shell's
    // (cmd.exe) pid; proc.kill() only kills cmd.exe and leaves tsx + the bridge
    // orphaned — taskkill /T kills the tree. On POSIX SIGKILL the shell's group.
    const finish = () => {
      if (done) return;
      done = true;
      if (process.platform === "win32") {
        if (proc.pid !== undefined) {
          try { spawn("taskkill", ["/PID", String(proc.pid), "/T", "/F"]); } catch { /* best-effort */ }
        }
      } else {
        try { proc.kill("SIGKILL"); } catch { /* best-effort */ }
      }
      resolve({ stdout, stderr, code: proc.exitCode ?? null });
    };

    const sawId3 = () =>
      stdout.split("\n").some((l) => { try { return JSON.parse(l).id === 3; } catch { return false; } });

    proc.stdout.on("data", (d) => {
      stdout += d.toString();
      if (sawId3()) finish();
    });
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", finish);
    proc.stdin.write(input);
    setTimeout(() => proc.stdin.end(), opts.closeStdinAfterMs);
    // Safety: resolve + tree-kill even if id 3 never arrives (e.g. bridge wedged).
    setTimeout(finish, 15_000);
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
