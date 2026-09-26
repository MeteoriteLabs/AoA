// server/src/__tests__/cli-017-output-root-directive.test.ts
//
// CLI-017-A — **PC-12**, the pin `E7-D11` makes a condition of ruling F7, plus acceptance rows
// 1, 3, 4 and the DIRECTIVE half of row 5.
//
// The review's §6 pin census recorded that SD-1b moves none of the 16 existing pins, and then
// refused to call that a win:
//
//   "SD-1b's 'none' is a search result, not a proof. No test asserts the staged prompt bytes at
//    the heartbeat call site … The emit build therefore owes a new pin at that site, because an
//    unpinned directive can be deleted silently."
//
// So this file pins BOTH halves of the chain, because either one alone passes against a real
// defect:
//
//   • the BEHAVIOURAL half — `applySandboxOutputRootDirective`'s exact bytes and its two gates,
//     and the directive surviving all the way into the STAGED PROMPT BYTES that
//     `buildTaskRunBatchWorkload` produces (the real builder, not a double). Deleting or editing
//     the directive text reds this.
//   • the CALL-SITE half — that `heartbeat.ts`'s canary block actually feeds
//     `buildTaskRunBatchWorkload` through that function rather than handing it
//     `context.currentTaskMarkdown` raw. Deleting the append from `heartbeat.ts` reds this, and
//     NOTHING ELSE IN THE SUITE WOULD: the behavioural half would stay green with the production
//     seam severed, which is the precise shape of "an unpinned directive can be deleted
//     silently". A source pin is the honest instrument here — the alternative is booting the
//     whole heartbeat, and a pin that expensive is one nobody keeps.
//
// ★ ACCEPTANCE ROW 4 (`codex_local` is untouched) is carried by the codex arms below AND by the
// census pins staying green UNEDITED — `cli-008-unit-b-byte-source.integration.test.ts` rows 4
// and 7 are not touched by this ticket, and they call `buildTaskRunBatchWorkload` directly, so a
// mutant that appended the directive for codex would red them there as well as here.
//
// ★ ACCEPTANCE ROW 5, DIRECTIVE HALF (founder ruling F10, MULTI-TENANT). Two Organizations
// dispatching concurrently each get the directive in their OWN run's prompt, and neither run's
// directive reads the other's state. The same-tenant positive control sits beside it.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  SANDBOX_OUTPUT_ROOT,
  SANDBOX_OUTPUT_ROOT_DIRECTIVE,
  applySandboxOutputRootDirective,
} from "../services/sandbox-output-root.js";
import { buildTaskRunBatchWorkload } from "../services/task-run-batch-workload.js";
import { STAGED_PROMPT_PATH } from "../services/task-run-sandbox-invocation.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const HEARTBEAT_SOURCE = join(HERE, "..", "services", "heartbeat.ts");

/** The claude runtime command spec shape `buildTaskRunBatchWorkload` accepts. Mirrors the one in
 * `cli-008-unit-b-byte-source.integration.test.ts` so the staged bytes are the real ones. */
const CLAUDE_SPEC = { command: "claude", args: [] as string[] } as const;

function stagedPromptText(input: { adapterType: string; markdown: string }): string {
  const built = buildTaskRunBatchWorkload({
    adapterType: input.adapterType,
    runtimeCommandSpec: CLAUDE_SPEC,
    adapterConfig: {},
    currentTaskMarkdown: input.markdown,
    instructions: null,
    aoaMcpConfig: null,
  });
  if (!built.ok) throw new Error(`workload build refused: ${built.reason}`);
  const prompt = built.stagedFiles.find((file) => file.path === STAGED_PROMPT_PATH);
  if (!prompt) throw new Error(`no staged prompt at ${STAGED_PROMPT_PATH}`);
  return new TextDecoder().decode(prompt.bytes);
}

describe("CLI-017-A · PC-12 — the SD-1b directive reaches the agent", () => {
  it("row 3 (server half): `R` is the ruled value, verbatim", () => {
    // The worker-side half and the equality between them are checked in the `policy` job by
    // `scripts/check-sandbox-output-root.mjs`; this is the server-side literal the ruling names.
    expect(SANDBOX_OUTPUT_ROOT).toBe("/home/user/aoa-output");
  });

  it("row 1: the EXACT directive text is pinned byte-for-byte", () => {
    expect(SANDBOX_OUTPUT_ROOT_DIRECTIVE).toBe(
      [
        "## Where to write your output",
        "",
        "Write every file you produce for this task under `/home/user/aoa-output`.",
        "Create that directory if it does not already exist.",
        "Files written anywhere else are not collected and will not be delivered.",
      ].join("\n"),
    );
    // It names `R` and nothing tenant-, run- or path-specific.
    expect(SANDBOX_OUTPUT_ROOT_DIRECTIVE).toContain(SANDBOX_OUTPUT_ROOT);
  });

  it("row 1: a distributed claude_local run's STAGED PROMPT BYTES carry the exact directive", () => {
    const markdown = applySandboxOutputRootDirective({
      adapterType: "claude_local",
      runTargetsSandbox: true,
      currentTaskMarkdown: "# Task\n\nBuild the thing.",
    });
    const staged = stagedPromptText({ adapterType: "claude_local", markdown });
    expect(staged).toContain(SANDBOX_OUTPUT_ROOT_DIRECTIVE);
    // Non-vacuity: the ORIGINAL task text is still there. A directive that replaced the task
    // would satisfy `toContain` above while destroying the run.
    expect(staged).toContain("Build the thing.");
    // Appended, never prepended — the task is what the agent reads first.
    expect(staged.indexOf("Build the thing.")).toBeLessThan(staged.indexOf(SANDBOX_OUTPUT_ROOT_DIRECTIVE));
  });

  it("row 1 (empty base): the directive is the whole prompt, with no leading blank line", () => {
    expect(
      applySandboxOutputRootDirective({
        adapterType: "claude_local",
        runTargetsSandbox: true,
        currentTaskMarkdown: "",
      }),
    ).toBe(SANDBOX_OUTPUT_ROOT_DIRECTIVE);
    expect(
      applySandboxOutputRootDirective({
        adapterType: "claude_local",
        runTargetsSandbox: true,
        currentTaskMarkdown: undefined,
      }),
    ).toBe(SANDBOX_OUTPUT_ROOT_DIRECTIVE);
  });

  it("row 4: `codex_local` is UNTOUCHED — no directive, and its markdown is byte-identical", () => {
    const base = "# Task\n\nBuild the thing.";
    const codex = applySandboxOutputRootDirective({
      adapterType: "codex_local",
      runTargetsSandbox: true,
      currentTaskMarkdown: base,
    });
    expect(codex).toBe(base);
    expect(codex).not.toContain(SANDBOX_OUTPUT_ROOT);
    // And the same through the real builder, so the claim is about staged BYTES.
    const staged = stagedPromptText({ adapterType: "codex_local", markdown: codex });
    expect(staged).not.toContain(SANDBOX_OUTPUT_ROOT);
    // Positive control for this arm: the ONLY thing that changed is the adapter type.
    expect(
      applySandboxOutputRootDirective({
        adapterType: "claude_local",
        runTargetsSandbox: true,
        currentTaskMarkdown: base,
      }),
    ).toContain(SANDBOX_OUTPUT_ROOT);
  });

  it("a NON-distributed claude run is byte-identical — `R` exists only inside a sandbox", () => {
    const base = "# Task\n\nBuild the thing.";
    expect(
      applySandboxOutputRootDirective({
        adapterType: "claude_local",
        runTargetsSandbox: false,
        currentTaskMarkdown: base,
      }),
    ).toBe(base);
  });

  it("row 5 (F10, directive half): two Organizations dispatch concurrently and neither reads the other", async () => {
    // Two tenants, two distinct task bodies, resolved CONCURRENTLY through the same module —
    // the shape a shared mutable buffer or a module-level cache would fail.
    const orgA = { adapterType: "claude_local", runTargetsSandbox: true, currentTaskMarkdown: "# A\n\nOrg A secret task." };
    const orgB = { adapterType: "claude_local", runTargetsSandbox: true, currentTaskMarkdown: "# B\n\nOrg B secret task." };
    const [a, b] = await Promise.all([
      Promise.resolve().then(() => applySandboxOutputRootDirective(orgA)),
      Promise.resolve().then(() => applySandboxOutputRootDirective(orgB)),
    ]);

    // Each run carries its OWN task and the SAME directive (the directive is tenant-independent
    // by construction — it names `R` and nothing else).
    expect(a).toContain("Org A secret task.");
    expect(b).toContain("Org B secret task.");
    expect(a).toContain(SANDBOX_OUTPUT_ROOT_DIRECTIVE);
    expect(b).toContain(SANDBOX_OUTPUT_ROOT_DIRECTIVE);

    // CROSS-TENANT: neither run's prompt carries a single byte of the other's.
    expect(a).not.toContain("Org B secret task.");
    expect(b).not.toContain("Org A secret task.");

    // And the same through the real builder, so the claim is about STAGED BYTES, not strings.
    const stagedA = stagedPromptText({ adapterType: "claude_local", markdown: a });
    const stagedB = stagedPromptText({ adapterType: "claude_local", markdown: b });
    expect(stagedA).not.toContain("Org B secret task.");
    expect(stagedB).not.toContain("Org A secret task.");

    // SAME-TENANT POSITIVE CONTROL: the assertion above is not vacuously true because the
    // strings never appear anywhere — each one DOES appear in its own tenant's staged bytes.
    expect(stagedA).toContain("Org A secret task.");
    expect(stagedB).toContain("Org B secret task.");

    // Row 5's "swap the Organization on the second run's context → the assertion on the first
    // run's prompt must not move": re-resolving B does not perturb A.
    const bAgain = applySandboxOutputRootDirective(orgB);
    expect(bAgain).toBe(b);
    expect(applySandboxOutputRootDirective(orgA)).toBe(a);
  });

  // ──────────────────────────────────────────────────────────────────────────────────────────
  // PC-12's CALL-SITE half. This is the arm the review demanded, and it is the only one that
  // reds when the append is deleted from `heartbeat.ts` while this module stays intact.
  // ──────────────────────────────────────────────────────────────────────────────────────────
  describe("PC-12 call site — the distributed caller feeds the builder THROUGH the directive", () => {
    const source = readFileSync(HEARTBEAT_SOURCE, "utf8");

    it("`heartbeat.ts` imports the directive helper", () => {
      expect(source).toContain("applySandboxOutputRootDirective");
      expect(source).toContain('from "./sandbox-output-root.js"');
    });

    it("the canary block's `currentTaskMarkdown` is the DIRECTIVE's output, not the raw context", () => {
      // The exact property line handed to `buildTaskRunBatchWorkload`. If someone reverts it to
      // `currentTaskMarkdown: context.currentTaskMarkdown,` this reds — which is the whole point.
      expect(source).toContain("currentTaskMarkdown: applySandboxOutputRootDirective({");
      // ...and the builder's OWN argument object is the one that got it. A file-wide
      // `toContain` would stay green if someone left the helper call dead somewhere else and
      // handed the builder the raw context, so the window is anchored on the builder call.
      const call = source.indexOf("buildTaskRunBatchWorkload({");
      expect(call).toBeGreaterThan(-1);
      const builderArgs = source.slice(call, call + 1600);
      expect(builderArgs).toContain("currentTaskMarkdown: applySandboxOutputRootDirective({");
    });

    it("the call site passes BOTH gates — the adapter type and the sandbox target", () => {
      const start = source.indexOf("currentTaskMarkdown: applySandboxOutputRootDirective({");
      expect(start).toBeGreaterThan(-1);
      const window = source.slice(start, start + 400);
      expect(window).toContain("adapterType: agent.adapterType");
      expect(window).toContain("runTargetsSandbox");
      expect(window).toContain("currentTaskMarkdown: context.currentTaskMarkdown");
    });
  });
});
