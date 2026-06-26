import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

// ── child_process.spawn mock ────────────────────────────────────────────────
//
// Each test configures `nextSpawn` to script the fake process' behavior. The
// mock returns an EventEmitter with stdin/stdout/stderr so extraction-cli's
// stdin-write + stdout-collect + close/error wiring can be exercised without
// touching the real `claude` / `codex` binaries.

interface SpawnScript {
  /** stdout chunks emitted before close. */
  stdout?: string[];
  /** stderr chunks emitted before close. */
  stderr?: string[];
  /** close exit code (mutually exclusive with `error`). */
  exitCode?: number;
  /** spawn error (e.g. { code: "ENOENT" }) — emits "error" instead of close. */
  error?: NodeJS.ErrnoException;
}

interface SpawnCall {
  command: string;
  args: string[];
  stdinWrites: string[];
  stdinEnded: boolean;
}

let nextSpawn: SpawnScript = { stdout: [], exitCode: 0 };
const spawnCalls: SpawnCall[] = [];

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: vi.fn((command: string, args: string[]) => {
      const call: SpawnCall = { command, args, stdinWrites: [], stdinEnded: false };
      spawnCalls.push(call);

      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        stdin: { writable: boolean; write: (s: string) => void; end: () => void };
        kill: (sig?: string) => void;
        exitCode: number | null;
        signalCode: string | null;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.exitCode = null;
      child.signalCode = null;
      child.kill = vi.fn();
      child.stdin = {
        writable: true,
        write: (s: string) => call.stdinWrites.push(s),
        end: () => {
          call.stdinEnded = true;
        },
      };

      // Drive the scripted behavior on the next microtask so the caller has
      // attached its listeners + written stdin first.
      queueMicrotask(() => {
        const script = nextSpawn;
        if (script.error) {
          child.emit("error", script.error);
          return;
        }
        for (const chunk of script.stdout ?? []) {
          child.stdout.emit("data", Buffer.from(chunk));
        }
        for (const chunk of script.stderr ?? []) {
          child.stderr.emit("data", Buffer.from(chunk));
        }
        child.exitCode = script.exitCode ?? 0;
        child.emit("close", script.exitCode ?? 0);
        // codex-exec listens on "exit"; claude listens on "close". Emit both so
        // either transport resolves regardless of which event it awaits.
        child.emit("exit", script.exitCode ?? 0);
      });

      return child;
    }),
  };
});

// fs/promises.writeFile is used by the claude path to drop the system prompt to
// a temp file — stub it so the test never touches disk.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    writeFile: vi.fn(async () => {}),
    mkdir: vi.fn(async () => {}),
  };
});

beforeEach(() => {
  spawnCalls.length = 0;
  nextSpawn = { stdout: [], exitCode: 0 };
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── classifyCliError ─────────────────────────────────────────────────────────

describe("classifyCliError", () => {
  it("ENOENT spawn error → not_installed", async () => {
    const { classifyCliError } = await import("../services/extraction-cli.ts");
    expect(classifyCliError({ code: "ENOENT" }, "", null)).toBe("not_installed");
  });

  it("timedOut → timeout", async () => {
    const { classifyCliError } = await import("../services/extraction-cli.ts");
    expect(classifyCliError({ timedOut: true }, "", null)).toBe("timeout");
  });

  it("auth stderr → not_authed", async () => {
    const { classifyCliError } = await import("../services/extraction-cli.ts");
    expect(classifyCliError(null, "Error: not logged in", 1)).toBe("not_authed");
    expect(classifyCliError(null, "401 unauthorized", 1)).toBe("not_authed");
    expect(classifyCliError(null, "Missing bearer or basic authentication", 1)).toBe(
      "not_authed",
    );
  });

  it("nonzero exit (no auth signal) → nonzero_exit", async () => {
    const { classifyCliError } = await import("../services/extraction-cli.ts");
    expect(classifyCliError(null, "some crash", 2)).toBe("nonzero_exit");
  });

  it("exit 0 with no spawn error → unparseable fall-through", async () => {
    const { classifyCliError } = await import("../services/extraction-cli.ts");
    expect(classifyCliError(null, "", 0)).toBe("unparseable");
  });

  it("ENOENT takes precedence over a nonzero exit", async () => {
    const { classifyCliError } = await import("../services/extraction-cli.ts");
    expect(classifyCliError({ code: "ENOENT" }, "", 1)).toBe("not_installed");
  });
});

// ── extractViaCli (claude) ───────────────────────────────────────────────────

describe("extractViaCli — claude happy path", () => {
  it("parses a JSON array of items from claude stdout", async () => {
    const items = [
      {
        type: "task",
        title: "Ship the extractor",
        description: "Implement the one-shot CLI extractor.",
        priority: "high",
      },
    ];
    nextSpawn = { stdout: [JSON.stringify(items)], exitCode: 0 };

    const { extractViaCli } = await import("../services/extraction-cli.ts");
    const result = await extractViaCli("claude", "SYSTEM", "do the thing");

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "task",
      title: "Ship the extractor",
      priority: "high",
    });

    // Sanity: spawned `claude`, content delivered over stdin + closed (one-shot).
    const call = spawnCalls.find((c) => c.command === "claude");
    expect(call).toBeDefined();
    expect(call!.args).toContain("--print");
    expect(call!.args).toContain("--system-prompt-file");
    // SECURITY (P1): built-in tools MUST be disabled — `--tools` followed by the
    // empty value ("" on POSIX). Otherwise a prompt-injected entry could run
    // Read/Bash against the server user's home/temp/env.
    const toolsIdx = call!.args.indexOf("--tools");
    expect(toolsIdx).toBeGreaterThanOrEqual(0);
    // Disable-all sentinel: "" on POSIX, '""' (empty-quoted token) on Windows.
    expect(["", '""']).toContain(call!.args[toolsIdx + 1]);
    expect(call!.stdinWrites.join("")).toContain("do the thing");
    expect(call!.stdinEnded).toBe(true);
  });

  it("accepts both 'claude' and 'claude_cli' tool aliases", async () => {
    nextSpawn = { stdout: ["[]"], exitCode: 0 };
    const { extractViaCli } = await import("../services/extraction-cli.ts");
    const result = await extractViaCli("claude_cli", "SYSTEM", "content");
    expect(result).toEqual([]);
  });
});

describe("extractViaCli — claude error paths", () => {
  it("unparseable stdout → CliExtractionError kind 'unparseable'", async () => {
    nextSpawn = { stdout: ["not json"], exitCode: 0 };
    const { extractViaCli, CliExtractionError } = await import(
      "../services/extraction-cli.ts"
    );
    await expect(extractViaCli("claude", "SYSTEM", "content")).rejects.toMatchObject({
      kind: "unparseable",
    });
    await expect(extractViaCli("claude", "SYSTEM", "content")).rejects.toBeInstanceOf(
      CliExtractionError,
    );
  });

  it("ENOENT spawn → CliExtractionError kind 'not_installed'", async () => {
    nextSpawn = { error: Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" }) };
    const { extractViaCli } = await import("../services/extraction-cli.ts");
    await expect(extractViaCli("claude", "SYSTEM", "content")).rejects.toMatchObject({
      kind: "not_installed",
    });
  });

  it("nonzero exit → CliExtractionError kind 'nonzero_exit'", async () => {
    nextSpawn = { stdout: [""], stderr: ["boom"], exitCode: 2 };
    const { extractViaCli } = await import("../services/extraction-cli.ts");
    await expect(extractViaCli("claude", "SYSTEM", "content")).rejects.toMatchObject({
      kind: "nonzero_exit",
    });
  });

  it("auth stderr on nonzero exit → CliExtractionError kind 'not_authed'", async () => {
    nextSpawn = { stdout: [""], stderr: ["Error: not logged in"], exitCode: 1 };
    const { extractViaCli } = await import("../services/extraction-cli.ts");
    await expect(extractViaCli("claude", "SYSTEM", "content")).rejects.toMatchObject({
      kind: "not_authed",
    });
  });
});

// ── extractViaCli (codex) ────────────────────────────────────────────────────
//
// The codex path delegates to runCodexExecJson, which uses the REAL
// parseCodexJsonl (pure function) but provisions auth + reads the shared model
// via codex helpers. Stub the disk/auth helpers so no real ~/.codex is touched;
// keep parseCodexJsonl real so the JSONL→summary→parse chain is exercised.

vi.mock("@armyofagents/adapter-codex-local/server", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@armyofagents/adapter-codex-local/server")
  >();
  return {
    ...actual,
    ensureCodexAuthInHome: vi.fn(async () => true),
    readSharedCodexModel: vi.fn(async () => null),
  };
});

/** Build a minimal codex JSONL stream whose agent_message text = `text`. */
function codexJsonl(text: string): string {
  return [
    JSON.stringify({ type: "thread.started", thread_id: "t-123" }),
    JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text },
    }),
    JSON.stringify({
      type: "turn.completed",
      usage: { input_tokens: 10, output_tokens: 5 },
    }),
  ].join("\n");
}

describe("extractViaCli — codex", () => {
  it("parses items from the codex assistant summary", async () => {
    const items = [
      { type: "decision", title: "Use stdin delivery", description: "Windows-safe." },
    ];
    nextSpawn = { stdout: [codexJsonl(JSON.stringify(items))], exitCode: 0 };

    const { extractViaCli } = await import("../services/extraction-cli.ts");
    const result = await extractViaCli("codex", "SYSTEM", "content");

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: "decision", title: "Use stdin delivery" });

    // codex spawned with `exec --json ... -` and prompt over stdin (closed).
    const call = spawnCalls.find((c) => c.command === "codex");
    expect(call).toBeDefined();
    expect(call!.args).toContain("exec");
    expect(call!.args).toContain("--json");
    expect(call!.args[call!.args.length - 1]).toBe("-");
    expect(call!.stdinEnded).toBe(true);
  });

  it("unparseable codex summary → CliExtractionError kind 'unparseable'", async () => {
    nextSpawn = { stdout: [codexJsonl("not json")], exitCode: 0 };
    const { extractViaCli } = await import("../services/extraction-cli.ts");
    await expect(extractViaCli("codex", "SYSTEM", "content")).rejects.toMatchObject({
      kind: "unparseable",
    });
  });

  it("codex nonzero exit → CliExtractionError kind 'nonzero_exit'", async () => {
    nextSpawn = { stdout: [""], stderr: ["crashed"], exitCode: 3 };
    const { extractViaCli } = await import("../services/extraction-cli.ts");
    await expect(extractViaCli("codex", "SYSTEM", "content")).rejects.toMatchObject({
      kind: "nonzero_exit",
    });
  });
});
