// task-run-batch-workload.test.ts — CLI-006 / Blocker A.
//
// The builder is the ONLY thing that decides what a canary task run executes inside a
// sandbox, and argv is the only channel. Every arm here corresponds to a way the previous
// design would have produced a run that PASSES the acceptance verifier while proving
// nothing: a claude-shaped argv for an `http` agent, a one-second deadline, a silently
// truncated prompt, or a non-deterministic digest that 409s on replay.
import { describe, expect, it } from "vitest";
import { batchWorkloadV1Schema } from "@armyofagents/worker-protocol";
import { CODING_ADAPTER_DISPOSITIONS } from "../services/sandbox-coding-disposition.js";
import { resolveHeartbeatRunTimeoutPolicy } from "../services/heartbeat-stop-metadata.js";
import {
  FROZEN_MAX_ARG_CHARS,
  SUBMISSION_MAX_INPUT_BYTES,
  TASK_RUN_DEFAULT_MAX_RUNTIME_SECONDS,
  buildTaskRunBatchWorkload,
  maxRuntimeSecondsForPolicy,
  resolveTaskRunMaxRuntimeSeconds,
  type TaskRunBatchWorkloadInput,
} from "../services/task-run-batch-workload.js";

const PROMPT = "## Task AOA-1\n\nShip the thing.";

function input(over: Partial<TaskRunBatchWorkloadInput> = {}): TaskRunBatchWorkloadInput {
  return {
    adapterType: "claude_local",
    runtimeCommandSpec: { command: "claude" },
    adapterConfig: {},
    currentTaskMarkdown: PROMPT,
    ...over,
  };
}

// ★ THE MATRIX IS THE SOURCE OF TRUTH, NOT A HAND-COPIED LIST.
//
// A hardcoded list of refused adapters was the first draft, and mutation testing killed it:
// deleting the `dispositionForAdapter` gate from the builder left all of those tests GREEN,
// because `buildArgsFor` already returns `null` for anything that is not one of the two
// shapes and produces the SAME `adapter_not_v1_scope` reason. The two guards are
// behaviourally equivalent today, so no example-based test can tell them apart.
//
// What a hardcoded list cannot catch is DRIFT: the day the matrix admits a third adapter to
// `v1`, the argv switch would silently refuse it and the distributed path would go dark for
// that adapter with no test going red. Deriving the cases from
// `CODING_ADAPTER_DISPOSITIONS` — the same matrix `execution-secret-handle-mint.ts` gates
// the credential on — is what makes "the builder admits exactly the v1 bucket" checkable
// rather than asserted.
describe("the disposition gate (derived from the matrix, not a copy of it)", () => {
  const ENTRIES = Object.entries(CODING_ADAPTER_DISPOSITIONS);
  const V1 = ENTRIES.filter(([, d]) => d.bucket === "v1").map(([type]) => type);
  const NON_V1 = ENTRIES.filter(([, d]) => d.bucket !== "v1");

  it("the matrix still has a non-empty v1 bucket (else every case below is vacuous)", () => {
    expect(V1.length).toBeGreaterThan(0);
    expect(NON_V1.length).toBeGreaterThan(0);
  });

  it.each(V1)("ADMITS %s — the matrix says v1, so the builder must have an argv shape", (adapterType) => {
    const result = buildTaskRunBatchWorkload(
      input({ adapterType, runtimeCommandSpec: { command: "bin" } }),
    );
    expect(result.ok, `${adapterType} is v1 in the matrix but the builder refused it`).toBe(true);
  });

  // The canary fork in heartbeat.ts has NO adapter gate, so every one of these reaches the
  // builder. `http` is the sharpest case: `command: "http"` passes
  // `z.string().min(1).max(256)`, so without a gate the supervisor would run a nonexistent
  // binary inside a sandbox while the real webhook stayed suppressed.
  it.each(NON_V1.map(([type, d]) => [type, d.bucket] as const))(
    "refuses %s (%s bucket)",
    (adapterType) => {
      const result = buildTaskRunBatchWorkload(
        input({ adapterType, runtimeCommandSpec: { command: adapterType } }),
      );
      expect(result).toEqual({ ok: false, reason: "adapter_not_v1_scope" });
    },
  );

  it("refuses an unregistered adapter type (fail closed on the unknown)", () => {
    const result = buildTaskRunBatchWorkload(input({ adapterType: "totally_new_local" }));
    expect(result).toEqual({ ok: false, reason: "adapter_not_v1_scope" });
  });

  it("covers every REGISTERED adapter type — no type escapes the gate untested", () => {
    // `evaluateDispositionCoverage` already proves the matrix covers the registry; this
    // proves the BUILDER is exercised against every entry of that matrix, so a newly
    // registered adapter cannot reach the seam without a decision recorded here.
    expect(new Set([...V1, ...NON_V1.map(([t]) => t)]).size).toBe(ENTRIES.length);
  });
});

describe("the command", () => {
  it("uses the adapter's real binary from the runtime command spec", () => {
    const result = buildTaskRunBatchWorkload(input());
    expect(result.ok && result.workload.command).toBe("claude");
  });

  it("honors a founder adapterConfig.command override (already resolved into the spec)", () => {
    const result = buildTaskRunBatchWorkload(
      input({ runtimeCommandSpec: { command: "/opt/bin/claude-pinned" } }),
    );
    expect(result.ok && result.workload.command).toBe("/opt/bin/claude-pinned");
  });

  // 5 of the 14 registered adapters have no `getRuntimeCommandSpec`, so `runtimeCommandSpec`
  // is `null`. A null is a REFUSAL — never a fallback to the registry key.
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a spec with no command", {}],
    ["a non-string command", { command: 7 }],
    ["a whitespace-only command", { command: "   " }],
  ])("refuses %s", (_label, spec) => {
    const result = buildTaskRunBatchWorkload(
      input({ runtimeCommandSpec: spec as TaskRunBatchWorkloadInput["runtimeCommandSpec"] }),
    );
    expect(result).toEqual({ ok: false, reason: "no_runtime_command_spec" });
  });

  it("never emits the adapter TYPE as the command (the shadow comparator's bug)", () => {
    const result = buildTaskRunBatchWorkload(input());
    expect(result.ok && result.workload.command).not.toBe("claude_local");
  });
});

describe("the per-adapter argv shapes", () => {
  it("emits the claude shape with the prompt as a positional", () => {
    const result = buildTaskRunBatchWorkload(input({ adapterType: "claude_local" }));
    expect(result.ok && result.workload.args).toEqual([
      "--print",
      PROMPT,
      "--output-format",
      "stream-json",
      "--verbose",
    ]);
  });

  it("emits the codex shape — NOT the claude flags, which are meaningless to it", () => {
    const result = buildTaskRunBatchWorkload(
      input({ adapterType: "codex_local", runtimeCommandSpec: { command: "codex" } }),
    );
    expect(result.ok && result.workload.args).toEqual(["exec", "--json", PROMPT]);
  });

  it("never emits a stdin placeholder — there is no stdin channel into the sandbox", () => {
    for (const adapterType of ["claude_local", "codex_local"]) {
      const result = buildTaskRunBatchWorkload(input({ adapterType }));
      expect(result.ok && result.workload.args).not.toContain("-");
    }
  });

  it("leaves stdinArtifactId null (zero consumers anywhere in the daemon)", () => {
    const result = buildTaskRunBatchWorkload(input());
    expect(result.ok && result.workload.stdinArtifactId).toBeNull();
  });
});

describe("the prompt", () => {
  it("carries the REAL assembled task markdown, trimmed", () => {
    const result = buildTaskRunBatchWorkload(input({ currentTaskMarkdown: `\n\n${PROMPT}\n\n` }));
    expect(result.ok && result.workload.args[1]).toBe(PROMPT);
  });

  it.each([
    ["absent", undefined],
    ["null", null],
    ["non-string", 42],
    ["empty", ""],
    ["whitespace-only", "   \n\t "],
  ])("refuses a %s prompt rather than running an empty task", (_label, markdown) => {
    const result = buildTaskRunBatchWorkload(input({ currentTaskMarkdown: markdown }));
    expect(result).toEqual({ ok: false, reason: "empty_prompt" });
  });

  it("accepts a prompt exactly at the frozen 8192-char arg ceiling", () => {
    const result = buildTaskRunBatchWorkload(
      input({ currentTaskMarkdown: "x".repeat(FROZEN_MAX_ARG_CHARS) }),
    );
    expect(result.ok).toBe(true);
  });

  // REFUSE, never truncate: a truncated prompt still creates a sandbox, still terminalizes,
  // and still satisfies the acceptance verifier while the agent works from a mutilated task.
  it("REFUSES an oversized prompt — it does not truncate it", () => {
    const oversized = "x".repeat(FROZEN_MAX_ARG_CHARS + 1);
    const result = buildTaskRunBatchWorkload(input({ currentTaskMarkdown: oversized }));
    expect(result).toEqual({ ok: false, reason: "prompt_too_large" });
  });

  // HONESTY ABOUT THE 64 KiB BACKSTOP. It cannot fire today, and this test says WHY rather
  // than pretending to exercise it. The worst-case JSON expansion of a JS string is 6 bytes
  // per UTF-16 unit (a control char escapes to a six-character `backslash-u-XXXX`); a
  // non-BMP emoji is only 2 bytes per unit. So ONE arg capped at 8192 units reaches at most
  // ~48 KiB, and both argv shapes carry exactly one large arg. The `workload_too_large` arm
  // is a backstop for a future shape with a SECOND large arg (Unit 2's system-prompt
  // delivery is the obvious one). If either constant moves — so the backstop becomes
  // reachable, or so the cap stops guaranteeing the bound — this assertion tells you.
  it("the frozen arg ceiling structurally guarantees the 64 KiB submission bound", () => {
    const WORST_CASE_JSON_BYTES_PER_UNIT = 6; // the widest JSON escape for one UTF-16 unit
    const worstCaseOneArg = FROZEN_MAX_ARG_CHARS * WORST_CASE_JSON_BYTES_PER_UNIT;

    // Empirical, not assumed: 8192 control chars really do encode to 6 bytes each.
    const probe = String.fromCharCode(1).repeat(FROZEN_MAX_ARG_CHARS);
    expect(new TextEncoder().encode(JSON.stringify(probe)).byteLength).toBe(
      worstCaseOneArg + 2, // + the two surrounding quotes
    );

    // A control-char prompt at the exact ceiling therefore still BUILDS — the backstop does
    // not fire, which is the fact this test pins.
    const built = buildTaskRunBatchWorkload(input({ currentTaskMarkdown: probe }));
    expect(built.ok).toBe(true);
    if (built.ok) {
      const encoded = new TextEncoder().encode(JSON.stringify(built.workload)).byteLength;
      expect(encoded).toBeLessThanOrEqual(SUBMISSION_MAX_INPUT_BYTES);
    }

    // ONE large arg can never reach the bound; TWO could. That is the backstop's remit.
    expect(worstCaseOneArg).toBeLessThan(SUBMISSION_MAX_INPUT_BYTES);
    expect(worstCaseOneArg * 2).toBeGreaterThan(SUBMISSION_MAX_INPUT_BYTES);
  });

});

describe("maxRuntimeSeconds", () => {
  // ★ THE ONE-SECOND TRAP. `defaultTimeoutSecForAdapter` returns 0 for EVERY adapter, so an
  // unconfigured agent has `effectiveTimeoutSec === 0`. A bare `clamp(sec, 1, 86400)` would
  // yield 1 — every default-configured agent killed after one second, terminalizing `failed`
  // while the verifier's clauses still pass.
  it("applies the 600s default when no timeout is configured (NOT a 1s clamp of the 0 default)", () => {
    const result = buildTaskRunBatchWorkload(input({ adapterConfig: {} }));
    expect(result.ok && result.workload.maxRuntimeSeconds).toBe(
      TASK_RUN_DEFAULT_MAX_RUNTIME_SECONDS,
    );
    expect(result.ok && result.workload.maxRuntimeSeconds).not.toBe(1);
  });

  it("applies the 600s default for a null/absent adapter config", () => {
    for (const adapterConfig of [null, undefined]) {
      const result = buildTaskRunBatchWorkload(input({ adapterConfig }));
      expect(result.ok && result.workload.maxRuntimeSeconds).toBe(600);
    }
  });

  it("honors a configured timeout below the ceiling", () => {
    const result = buildTaskRunBatchWorkload(input({ adapterConfig: { timeoutSec: 45 } }));
    expect(result.ok && result.workload.maxRuntimeSeconds).toBe(45);
  });

  it("clamps a configured timeout to the 600s server ceiling", () => {
    const result = buildTaskRunBatchWorkload(input({ adapterConfig: { timeoutSec: 7_200 } }));
    expect(result.ok && result.workload.maxRuntimeSeconds).toBe(600);
  });

  // ★ THE FLOOR HAS EXACTLY ONE PRODUCER, AND IT IS NOT claude_local.
  //
  // A `{ timeoutSec: 45.9 }` case against `claude_local` looks like it tests the floor and
  // does not: `resolveHeartbeatRunTimeoutPolicy` ALREADY applies `Math.floor` on its
  // non-http branch, so `effectiveTimeoutSec` is integral before this module sees it, and
  // deleting our `Math.floor` leaves that test green (mutation-verified). The ONLY fractional
  // producer is the `http` branch (`timeoutMs / 1000`, no floor) — which the disposition gate
  // keeps out of `buildTaskRunBatchWorkload` entirely. So the floor is exercised HERE, at the
  // exported resolver, against the producer that actually emits a fraction. If a future
  // widening ever routes a fractional policy to the builder, `.int()` would 400 the
  // submission; this is the assertion that keeps the backstop honest and non-vacuous.
  it("floors a fractional timeout — the frozen schema is .int()", () => {
    expect(resolveTaskRunMaxRuntimeSeconds("http", { timeoutMs: 45_900 })).toBe(45);
    expect(resolveTaskRunMaxRuntimeSeconds("http", { timeoutMs: 1_500 })).toBe(1);

    // The upstream producer for the gated adapters is already integral — this pins WHY the
    // claude_local form of this test would be vacuous, so nobody re-adds it.
    expect(resolveHeartbeatRunTimeoutPolicy("claude_local", { timeoutSec: 45.9 })
      .effectiveTimeoutSec).toBe(45);
    expect(resolveHeartbeatRunTimeoutPolicy("http", { timeoutMs: 45_900 })
      .effectiveTimeoutSec).toBe(45.9);

    // A sub-1 configured value: the clamp raises it to 1 BEFORE the floor, so it never
    // reaches 0 (which the frozen `.min(1)` would reject).
    expect(resolveTaskRunMaxRuntimeSeconds("http", { timeoutMs: 500 })).toBe(1);

    // …whereas a sub-1 timeoutSec floors to 0 UPSTREAM, so timeoutConfigured is false and the
    // 600s default applies. Not 1 — the difference between the two branches matters.
    expect(resolveTaskRunMaxRuntimeSeconds("claude_local", { timeoutSec: 0.5 })).toBe(600);
  });

  // The widened `number | null` on HeartbeatRunTimeoutPolicy: a null/NaN must fall to the
  // 600s DEFAULT, never to Math.max(1, null) === 1 — the one-second trap in a second guise.
  // Unreachable through the public resolver today, which is exactly why it is tested here.
  it.each([
    ["a null effectiveTimeoutSec", null],
    ["a NaN effectiveTimeoutSec", Number.NaN],
    ["an Infinity effectiveTimeoutSec", Number.POSITIVE_INFINITY],
  ])("falls to the 600s default for %s even when timeoutConfigured is true", (_l, effectiveTimeoutSec) => {
    expect(
      maxRuntimeSecondsForPolicy({ effectiveTimeoutSec, timeoutConfigured: true }),
    ).toBe(TASK_RUN_DEFAULT_MAX_RUNTIME_SECONDS);
  });

  it("always emits an integer within the frozen 1..86400 bound", () => {
    for (const [adapterType, config] of [
      ["claude_local", { timeoutSec: 1 }],
      ["claude_local", { timeoutSec: 45 }],
      ["claude_local", { timeoutSec: 599 }],
      ["claude_local", { timeoutSec: 600 }],
      ["claude_local", { timeoutSec: 601 }],
      ["claude_local", { timeoutSec: 86_400 }],
      ["claude_local", { timeoutSec: 999_999 }],
      ["http", { timeoutMs: 1 }],
      ["http", { timeoutMs: 2_500 }],
      ["http", { timeoutMs: 599_999 }],
      ["http", { timeoutMs: 999_999_999 }],
    ] as const) {
      const timeoutSec = JSON.stringify(config);
      const seconds = resolveTaskRunMaxRuntimeSeconds(adapterType, config);
      expect(Number.isInteger(seconds), `timeoutSec=${timeoutSec}`).toBe(true);
      expect(seconds).toBeGreaterThanOrEqual(1);
      expect(seconds).toBeLessThanOrEqual(600);
    }
  });
});

describe("determinism", () => {
  // `job-submission.ts` hashes the whole command INCLUDING `input`; a differing digest under
  // the same idempotencyKey (= run.id) throws 409. Any timestamp, nonce or randomUUID here
  // would turn every redelivery into a hard conflict.
  it("produces a byte-identical workload from identical inputs", () => {
    const a = buildTaskRunBatchWorkload(input());
    const b = buildTaskRunBatchWorkload(input());
    expect(a.ok && b.ok).toBe(true);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("emits keys in a fixed order across adapters", () => {
    const claude = buildTaskRunBatchWorkload(input({ adapterType: "claude_local" }));
    const codex = buildTaskRunBatchWorkload(
      input({ adapterType: "codex_local", runtimeCommandSpec: { command: "codex" } }),
    );
    expect(claude.ok && Object.keys(claude.workload)).toEqual([
      "command",
      "args",
      "stdinArtifactId",
      "maxRuntimeSeconds",
    ]);
    expect(codex.ok && Object.keys(codex.workload)).toEqual(
      claude.ok ? Object.keys(claude.workload) : [],
    );
  });

  it("does not mutate its input", () => {
    const adapterConfig = { timeoutSec: 45 };
    const spec = { command: "claude" };
    buildTaskRunBatchWorkload(input({ adapterConfig, runtimeCommandSpec: spec }));
    expect(adapterConfig).toEqual({ timeoutSec: 45 });
    expect(spec).toEqual({ command: "claude" });
  });
});

describe("the frozen schema has the last word", () => {
  it("every accepted workload re-parses against batchWorkloadV1Schema", () => {
    for (const adapterType of ["claude_local", "codex_local"]) {
      const result = buildTaskRunBatchWorkload(input({ adapterType }));
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(batchWorkloadV1Schema.safeParse(result.workload).success).toBe(true);
    }
  });

  it("emits no field the strict frozen schema does not declare", () => {
    const result = buildTaskRunBatchWorkload(input());
    expect(result.ok && Object.keys(result.workload).sort()).toEqual([
      "args",
      "command",
      "maxRuntimeSeconds",
      "stdinArtifactId",
    ]);
  });
});
