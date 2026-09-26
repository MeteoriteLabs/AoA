import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

// -----------------------------------------------------------------------------
// CLI-011 — P-011, THE OUTPUT PROBE. ONE DISPATCH, TWO PARTS, EVERY §10.5 ROW DECIDED.
//
// Design: `docs/replatform/epics/E7-coding-e2b/tickets/CLI-011-review.md` §10.
// Lane:   `.github/workflows/keyed-e2b-cli-011-output-probe.yml` (dispatch only).
// Core:   `scripts/lib/cli-011-output-probe.mjs` — every DECISION is a pure function there,
//         proven on every PR by `scripts/lib/__tests__/cli-011-output-probe.test.mjs`. This
//         file only OBSERVES a real sandbox and hands its observations to the core.
//
// P-011a (sandbox S1, shell only, no model tokens): S-P0 template control for R, PC-1 (a
// planted file must be seen), S-P1 staged baseline, PC-2 (with R = /home/user the staged set
// must be found), S-P2 depth/type, S-P3 non-zero exit (runCommand AND provider.execute),
// S-P4 unwritable redirect, S-P5 symlinks, S-P6 size metadata, S-P7 env secret in a file.
//
// P-011b (claude, model tokens): A-neg (the CLI's own writes, preceded by the C-census
// control), A-dir (SD-1b directive), A-cwd (SD-1a cwd = R, probe-local), A-decl (option 1b).
// ★ EACH MODEL ARM GETS A FRESH SANDBOX. §10.4 draws them in one sandbox "S2"; that would
// let A-neg's first-run CLI writes (session state created once) be ALREADY PRESENT when
// A-cwd runs, so A-cwd's "the CLI drags files into cwd = R" could read false only because
// the CLI had nothing left to create. Production runs one attempt per fresh sandbox
// (review §9.1 A-O2-12), so a fresh sandbox per arm is the faithful shape. Cost: four short
// sandboxes instead of one long one; the same four claude turns.
//
// ★ THE CLAUDE ARMS RUN THE SHIPPED LITERAL. `buildSandboxInvocation` is imported, never
// pasted; the no-bundle, no-MCP-config claude branch is used (the production default while
// the Unit C tool surface is off). A-cwd's prefix is applied INSIDE this probe by
// `withCwdPrefix`, which throws unless its anchor occurs exactly once.
//
// ★ CLEANUP ON EVERY PATH. Every sandbox is made inside `withSandbox`, whose `finally`
// terminates it and records the result in the durable record's `sandboxes` list — proven
// without a key below. Every arm is individually guarded: an arm that throws is
// `inconclusive`, and the others still run and still report.
//
// ★ SECRETS. E2B_API_KEY and ANTHROPIC_API_KEY (and S-P7's synthetic canary) are redacted
// from every string this file prints or records. The model key reaches the sandbox only as a
// per-command env var.
//
// Without E2B_API_KEY the keyed block SKIPS; the workflow's own step reds that skip.
// -----------------------------------------------------------------------------

import {
  STAGED_PROMPT_PATH,
  buildSandboxInvocation,
} from "../../../../server/src/services/task-run-sandbox-invocation.js";
import {
  A_NEG_PROMPT,
  ARM_STDOUT_LIMIT,
  CENSUS_DEPTH,
  HELLO_FILE,
  HOME_DIR,
  LISTING_RECORD_LIMIT,
  MODEL_ARMS,
  MODEL_ARMS_FOR_MODE,
  OUTPUT_ROOT,
  buildProbeRecord,
  censusDelta,
  compliancePrompt,
  diffSnapshots,
  evaluateControls,
  evaluateDecisionTable,
  listingForRecord,
  normaliseEntry,
  notRun,
  packDisposition,
  readClaudeStream,
  redactSecrets,
  renderReport,
  resolveArmsMode,
  resolveTemplate,
  verdictANeg,
  verdictCensusControl,
  verdictCompliance,
  verdictDepthAndType,
  verdictEnvSecret,
  verdictNonZeroExit,
  verdictRootPresence,
  verdictSizeMetadata,
  verdictStaged,
  verdictSymlinks,
  verdictUnwritableRedirect,
  withCwdPrefix,
} from "../../../../scripts/lib/cli-011-output-probe.mjs";
import { isE2bNotFound } from "../real-transport-helpers.js";
import { E2bTransportNotFoundError } from "../transport.js";
import type { E2bTransport } from "../transport.js";

const HAS_KEY = typeof process.env.E2B_API_KEY === "string" && process.env.E2B_API_KEY.length > 0;
const describeKeyed = HAS_KEY ? describe : describe.skip;

const TEMPLATE_RESOLUTION = resolveTemplate(process.env.E2B_TEMPLATE);
const TEMPLATE = TEMPLATE_RESOLUTION.templateId;
const ARMS_MODE = resolveArmsMode(process.env.CLI011_ARMS);

const RUN_NONCE = `P011-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`.toUpperCase();
/** S-P7's SYNTHETIC canary. Never a real key (§10.4). Redacted like one anyway. */
const CANARY = `P011-CANARY-${Math.random().toString(36).slice(2, 12)}-${Date.now().toString(36)}`;

const SECRETS: string[] = [process.env.E2B_API_KEY, process.env.ANTHROPIC_API_KEY, CANARY].filter(
  (v): v is string => typeof v === "string" && v.length > 0,
);
const safe = (text: unknown, max = 1200): string => redactSecrets(String(text ?? ""), SECRETS).slice(0, max);

const SHELL_SANDBOX_TTL_MS = 600_000;
const AGENT_SANDBOX_TTL_MS = 600_000;
const SHELL_TIMEOUT_MS = 60_000;
/** §10.4: every model arm is capped at 180 s, as in W7U1. */
const AGENT_TIMEOUT_MS = 180_000;
/** A transport `listDir` over a symlink loop must not eat the job. */
const LIST_DIR_TIMEOUT_MS = 60_000;
const BIG_BYTES = 3_145_728;

const DEC = new TextDecoder();

type Verdict = { arm: string; state: string; reason: string; findings: Record<string, unknown> };
type Outcome = "ok" | "not-found" | "faulted";
type Listing = { outcome: Outcome; entries: ReturnType<typeof normaliseEntry>[]; detail: string };

/** Which sandboxes were made, and whether each was terminated. Carried in the record. */
export const SANDBOXES: { lane: string; sandboxId: string; terminated: boolean; detail: string }[] = [];
/** Per-arm raw evidence (redacted, bounded), so every verdict can be re-derived from the record. */
const ARM_EVIDENCE: Record<string, unknown>[] = [];

async function realTransport(): Promise<E2bTransport> {
  const { RealE2bTransport } = await import("../real-transport.js");
  return new RealE2bTransport({});
}

/**
 * Create a sandbox, run `fn`, and TERMINATE IT IN `finally` — on success, throw or timeout.
 * `deps` exists so the teardown is proven without a key (see the no-key block below).
 */
export async function withSandbox<T>(
  lane: string,
  create: (t: E2bTransport, report: (id: string) => void) => Promise<string>,
  fn: (t: E2bTransport, sandboxId: string) => Promise<T>,
  deps: { transport?: () => Promise<E2bTransport> } = {},
): Promise<T> {
  const t = await (deps.transport ?? realTransport)();
  // ★★★ A SANDBOX THAT EXISTS BUT WAS NEVER RETURNED MUST STILL BE TORN DOWN. Codex review
  // (PR #551): `E2bSandboxProvider.create` calls `transport.create` and THEN `setTimeout`, so a
  // throw in the second step leaves a live E2B sandbox whose id never reached this function —
  // it would run to its TTL while the probe recorded only an inconclusive arm. The `report`
  // callback hands the id over the moment it exists, and a create that throws afterwards is
  // terminated here.
  let reported: string | null = null;
  const report = (id: string) => {
    if (typeof id === "string" && id.length > 0 && reported === null) reported = id;
  };
  let sandboxId: string;
  try {
    sandboxId = await create(t, report);
  } catch (err) {
    if (reported !== null) {
      const partial = { lane: `${lane}(partial-create)`, sandboxId: reported, terminated: false, detail: "" };
      SANDBOXES.push(partial);
      try {
        await t.terminate(reported);
        partial.terminated = true;
        partial.detail = "terminated after the create step threw";
      } catch (teardown) {
        partial.detail = safe((teardown as Error)?.message ?? teardown, 200);
      }
    }
    throw err;
  }
  const rec = { lane, sandboxId, terminated: false, detail: "" };
  SANDBOXES.push(rec);
  // eslint-disable-next-line no-console
  console.log(`[cli-011/${lane}] sandboxId = ${sandboxId} (template=${TEMPLATE})`);
  try {
    return await fn(t, sandboxId);
  } finally {
    try {
      await t.terminate(sandboxId);
      rec.terminated = true;
    } catch (err) {
      rec.detail = safe((err as Error)?.message ?? err, 200);
    }
  }
}

/**
 * A transport that hands the sandbox id to `report` the moment `create` resolves, and passes
 * everything else straight through.
 *
 * ★★★ EVERY PASS-THROUGH IS BOUND TO THE TARGET, AND THAT IS NOT STYLE. Codex review (PR #551):
 * `Reflect.get(target, prop, receiver)` returns a class method UNBOUND, so calling it through the
 * proxy runs it with `this` = the proxy — and `RealE2bTransport`'s `#sdk`/`#apiKey` private fields
 * then fail the brand check with a `TypeError`. `E2bSandboxProvider.create` calls `setTimeout`
 * right after `transport.create`, so on the real keyed lane EVERY P-011a creation would have
 * thrown, taken the partial-create path, and left the pack with one inconclusive arm — the
 * authorised dispatch could never have produced a measured result.
 */
export function reportingTransport(target: E2bTransport, report: (id: string) => void): E2bTransport {
  return new Proxy(target, {
    get(t, prop) {
      if (prop === "create") {
        return async (req: Parameters<E2bTransport["create"]>[0]) => {
          const created = await t.create(req);
          report(created.sandboxId);
          return created;
        };
      }
      const value = Reflect.get(t, prop, t) as unknown;
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(t) : value;
    },
  });
}

const plainCreate = (lane: string, ttlMs: number) => async (t: E2bTransport, report: (id: string) => void) => {
  const { sandboxId } = await t.create({ templateId: TEMPLATE, timeoutMs: ttlMs, metadata: { aoa_lane: `cli-011-${lane}` }, envVars: {} });
  report(sandboxId);
  return sandboxId;
};

type Exec = { channel: "returned" | "timedOut" | "threw"; exitCode: number | null; stdout: string; stderr: string; detail: string };

/** Run one command and NEVER throw: for a probe a thrown fault is data. */
async function run(
  t: E2bTransport,
  sandboxId: string,
  command: string,
  args: readonly string[],
  opts: { timeoutMs?: number; envVars?: Record<string, string> } = {},
): Promise<Exec> {
  let stdout = "";
  let stderr = "";
  try {
    const res = await t.runCommand(
      { sandboxId, command, args: [...args], envVars: opts.envVars ?? {}, timeoutMs: opts.timeoutMs ?? SHELL_TIMEOUT_MS },
      { onStdout: (c) => void (stdout += c), onStderr: (c) => void (stderr += c) },
    );
    return { channel: res.timedOut ? "timedOut" : "returned", exitCode: res.exitCode, stdout, stderr, detail: `crashed=${String(res.crashed)}` };
  } catch (err) {
    const e = err as { name?: unknown; message?: unknown };
    const detail = `${String(e?.name ?? "Error")}: ${String(e?.message ?? err)}`;
    return { channel: detail.toLowerCase().includes("timeout") ? "timedOut" : "threw", exitCode: null, stdout, stderr, detail };
  }
}

const sh = (t: E2bTransport, id: string, script: string, opts: { timeoutMs?: number; envVars?: Record<string, string> } = {}) =>
  run(t, id, "sh", ["-c", script], opts);

/** A read through the TRANSPORT (the production read path), classified by error class. */
export async function readBack(t: E2bTransport, sandboxId: string, path: string): Promise<{ outcome: Outcome; bytes: Uint8Array | null; detail: string }> {
  try {
    return { outcome: "ok", bytes: await t.readFile(sandboxId, path), detail: "" };
  } catch (err) {
    return {
      outcome: err instanceof E2bTransportNotFoundError ? "not-found" : "faulted",
      bytes: null,
      detail: safe(`${String((err as Error)?.name)}: ${String((err as Error)?.message ?? err)}`, 300),
    };
  }
}

/**
 * A listing through the RAW SDK — the transport discards `type`, `size` and `symlinkTarget`
 * (review §3.3), and those are what S-P2/S-P5/S-P6 observe. `depth` undefined = the SDK
 * default, which is what S-P2's first call measures.
 */
export async function sdkList(
  sandboxId: string,
  path: string,
  depth?: number,
  deps: { connect?: (id: string) => Promise<{ files: { list: (p: string, o?: object) => Promise<unknown[]> } }>; isNotFound?: (e: unknown) => boolean } = {},
): Promise<Listing> {
  // The SAME not-found classifier the real transport uses (`isE2bNotFound`), so a listing and
  // a read cannot disagree about what "absent" means.
  const isNotFound = deps.isNotFound ?? isE2bNotFound;
  let connect = deps.connect;
  if (!connect) {
    const e2b = await import("e2b");
    connect = async (id: string) => (await e2b.Sandbox.connect(id)) as never;
  }
  try {
    const sandbox = await connect(sandboxId);
    const raw = depth === undefined ? await sandbox.files.list(path) : await sandbox.files.list(path, { depth });
    return { outcome: "ok", entries: raw.map(normaliseEntry).sort((a, b) => (a.path < b.path ? -1 : 1)), detail: "" };
  } catch (err) {
    return {
      outcome: isNotFound(err) ? "not-found" : "faulted",
      entries: [],
      detail: safe(`${String((err as Error)?.name)}: ${String((err as Error)?.message ?? err)}`, 300),
    };
  }
}

/**
 * ★★★ CLI-012 CHANGED THE INSTRUMENT, AND THE CHANGE IS RECORDED RATHER THAN HIDDEN.
 *
 * `t.listDir` returned `readonly string[]` when this probe ran (run `35833717162`) and now returns
 * per-entry `{path, sizeBytes, symlink}` (ruling F7, `E7-D11`). `paths` keeps its old MEANING — the
 * paths the transport returned — so `includesL1` still reads what it always read and the committed
 * record's `S-P5` reading stays comparable. `markedLinks` is ADDED, not substituted: on a re-run it
 * records the fact CLI-012 created, namely that the link is no longer indistinguishable from a
 * file. **The committed record (`tickets/CLI-011-probe-record.json`) is a measurement of the OLD
 * transport and is not rewritten.**
 */
async function transportListDir(t: E2bTransport, id: string, path: string) {
  try {
    const entries = await Promise.race([
      t.listDir(id, path),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`listDir exceeded ${LIST_DIR_TIMEOUT_MS} ms`)), LIST_DIR_TIMEOUT_MS)),
    ]);
    return {
      outcome: "ok",
      paths: entries.map((entry) => entry.path),
      markedLinks: entries.filter((entry) => entry.symlink).map((entry) => entry.path),
    };
  } catch (err) {
    return {
      outcome: "threw",
      paths: [] as string[],
      markedLinks: [] as string[],
      error: safe(`${String((err as Error)?.name)}: ${String((err as Error)?.message ?? err)}`, 300),
    };
  }
}

const inconclusive = (arm: string, reason: string): Verdict => ({ arm, state: "inconclusive", reason, findings: {} });

async function guarded(arm: string, fn: () => Promise<Verdict>): Promise<Verdict> {
  try {
    return await fn();
  } catch (err) {
    return inconclusive(arm, `probe-threw: ${safe(`${String((err as Error)?.name)}: ${String((err as Error)?.message ?? err)}`, 300)}`);
  }
}

const evidence = (arm: string, data: Record<string, unknown>) => ARM_EVIDENCE.push({ arm, ...data });

// ─────────────────────────────────────────────────────────────────────────────
// P-011a — one sandbox, shell only
// ─────────────────────────────────────────────────────────────────────────────

const LABELS = {
  organizationId: "org_cli011_probe",
  companyId: "co_cli011_probe",
  jobId: "job_cli011_probe",
  attempt: 1,
  leaseId: "lease_cli011_probe",
  workerId: "worker_cli011_probe",
  targetId: "target_cli011_probe",
  deviceGeneration: 1,
};

/** S-P1's staged set: the EXACT builder output, with instructions AND an MCP config (§10.4). */
const S_P1_PROMPT = `P-011 staged prompt ${RUN_NONCE}\n`;
const S_P1_INVOCATION = buildSandboxInvocation({
  adapterType: "claude_local",
  binary: "claude",
  prompt: S_P1_PROMPT,
  instructions: "P-011 staged instructions\n",
  aoaMcpConfig: JSON.stringify({ mcpServers: { aoa: { type: "http", url: "https://mcp.invalid/p011" } } }),
});

async function p011a(): Promise<Verdict[]> {
  const out: Verdict[] = [];
  const { E2bSandboxProvider } = await import("../e2b-provider.js");
  let provider: InstanceType<typeof E2bSandboxProvider> | null = null;
  await withSandbox(
    "p011a",
    async (t, report) => {
      // The provider runs the PRODUCTION create path (`spec.env` -> transport `envVars`), and the
      // transport is wrapped so the sandbox id reaches `withSandbox` the instant it exists —
      // `provider.create` calls `setTimeout` after `transport.create`, and a throw there would
      // otherwise leak a live sandbox (Codex review, PR #551).
      provider = new E2bSandboxProvider({ transport: reportingTransport(t, report), templateId: TEMPLATE });
      // S-P7's canary rides the PRODUCTION env channel: `provider.create`'s spec.env ->
      // transport `envVars` (the [Cred-1] path), not a per-command env.
      const created = await provider.create(
        { resourceLabels: LABELS, command: "sh", args: ["-c", "true"], env: { AOA_PROBE_CANARY: CANARY }, workloadType: "batch" } as never,
        { deadlineMs: SHELL_SANDBOX_TTL_MS, idempotencyKey: `cli-011-${RUN_NONCE}` },
      );
      return created.sandboxId;
    },
    async (t, id) => {
      // S-P0 — BEFORE any writeFiles or exec.
      const rootPresence = async (arm: string) => {
        const rootList = await sdkList(id, OUTPUT_ROOT);
        const rootRead = await readBack(t, id, OUTPUT_ROOT);
        const home = await sdkList(id, HOME_DIR, 3);
        evidence(arm, { rootList: { outcome: rootList.outcome, detail: rootList.detail, entries: rootList.entries }, rootRead: { outcome: rootRead.outcome, detail: rootRead.detail }, home: { outcome: home.outcome, detail: home.detail, ...listingForRecord(home.entries) } });
        return verdictRootPresence(arm, { rootList, rootRead: { outcome: rootRead.outcome }, home }) as Verdict;
      };
      out.push(await guarded("S-P0", () => rootPresence("S-P0")));

      // PC-1 — plant a file in R, then run the SAME check: it must report present.
      out.push(
        await guarded("S-PC1", async () => {
          await t.writeFiles(id, [{ path: `${OUTPUT_ROOT}/.pc1-planted`, bytes: new TextEncoder().encode("pc1") }]);
          const v = await rootPresence("S-PC1");
          const rm = await sh(t, id, `rm -rf ${OUTPUT_ROOT}`);
          const after = await sdkList(id, OUTPUT_ROOT);
          evidence("S-PC1-cleanup", { rmExit: rm.exitCode, rootAfterCleanup: after.outcome });
          if (after.outcome !== "not-found") return inconclusive("S-PC1", `planted root not removed (${after.outcome})`);
          return v;
        }),
      );

      // S-P1 and PC-2 — the staged baseline, read from ONE listing.
      const stagedPaths = (S_P1_INVOCATION?.stagedFiles ?? []).map((f) => f.path);
      let b0: Listing | null = null;
      out.push(
        await guarded("S-P1", async () => {
          if (!S_P1_INVOCATION) throw new Error("buildSandboxInvocation returned null for claude_local");
          await t.writeFiles(id, S_P1_INVOCATION.stagedFiles.map((f) => ({ path: f.path, bytes: f.bytes })));
          b0 = await sdkList(id, HOME_DIR, CENSUS_DEPTH);
          evidence("S-P1", { staged: stagedPaths, b0: { outcome: b0.outcome, detail: b0.detail, ...listingForRecord(b0.entries) } });
          return verdictStaged("S-P1", { home: b0, staged: stagedPaths, root: OUTPUT_ROOT }) as Verdict;
        }),
      );
      out.push(
        await guarded("S-PC2", async () =>
          b0 === null ? inconclusive("S-PC2", "no-S-P1-listing") : (verdictStaged("S-PC2", { home: b0, staged: stagedPaths, root: HOME_DIR }) as Verdict),
        ),
      );

      // S-P2 — depth and type.
      out.push(
        await guarded("S-P2", async () => {
          const w = await sh(t, id, `mkdir -p ${OUTPUT_ROOT}/sub && printf N1 > ${OUTPUT_ROOT}/a.txt && printf N2 > ${OUTPUT_ROOT}/sub/b.txt`);
          if (w.channel !== "returned" || w.exitCode !== 0) return inconclusive("S-P2", `setup-exec-${w.channel}-${String(w.exitCode)}`);
          const defaultList = await sdkList(id, OUTPUT_ROOT);
          const deepList = await sdkList(id, OUTPUT_ROOT, 8);
          const reads = [];
          for (const [p, expected] of [[`${OUTPUT_ROOT}/a.txt`, "N1"], [`${OUTPUT_ROOT}/sub/b.txt`, "N2"]] as const) {
            const r = await readBack(t, id, p);
            reads.push({ path: p, outcome: r.outcome, bytes: r.bytes ? DEC.decode(r.bytes) : null, expected });
          }
          const tl = await transportListDir(t, id, OUTPUT_ROOT);
          evidence("S-P2", { defaultList, deepList, reads, transportListDir: tl });
          return verdictDepthAndType({ defaultList, deepList, reads, transportListDir: tl }) as Verdict;
        }),
      );

      // S-P3 — a file written before a non-zero exit, via runCommand AND provider.execute.
      out.push(
        await guarded("S-P3", async () => {
          const a = await sh(t, id, `printf N3 > ${OUTPUT_ROOT}/c.txt; exit 3`);
          const ar = await readBack(t, id, `${OUTPUT_ROOT}/c.txt`);
          let bChannel: Exec["channel"] = "returned";
          let bExit: number | null = null;
          let bDetail = "";
          try {
            const r = await provider!.execute(
              { sandboxId: id, command: "sh", args: ["-c", `printf N3b > ${OUTPUT_ROOT}/c2.txt; exit 3`], env: {} },
              { deadlineMs: SHELL_TIMEOUT_MS, idempotencyKey: `cli-011-exec-${RUN_NONCE}` },
            );
            bExit = r.exitCode;
            if (r.timedOut) bChannel = "timedOut";
          } catch (err) {
            bChannel = "threw";
            bDetail = safe(`${String((err as Error)?.name)}: ${String((err as Error)?.message ?? err)}`, 300);
          }
          const br = await readBack(t, id, `${OUTPUT_ROOT}/c2.txt`);
          const obs = {
            viaRunCommand: { channel: a.channel, exitCode: a.exitCode, expected: "N3", read: { outcome: ar.outcome, content: ar.bytes ? DEC.decode(ar.bytes) : null } },
            viaProviderExecute: { channel: bChannel, exitCode: bExit, expected: "N3b", detail: bDetail, read: { outcome: br.outcome, content: br.bytes ? DEC.decode(br.bytes) : null } },
          };
          evidence("S-P3", obs);
          return verdictNonZeroExit(obs) as Verdict;
        }),
      );

      // S-P4 — an unwritable redirect.
      out.push(
        await guarded("S-P4", async () => {
          // The premise is checked, not assumed: the target directory must be absent first.
          const dirBefore = (await sdkList(id, "/nonexistent-dir")).outcome;
          const r = await sh(t, id, "exec printf SHOULD_NOT_RUN > /nonexistent-dir/x");
          // ★ The command's stdout is REDIRECTED, so an empty stdout is empty either way. The
          // decisive readback is the redirect TARGET (Codex review, PR #551).
          const target = await readBack(t, id, "/nonexistent-dir/x");
          const obs = {
            channel: r.channel,
            exitCode: r.exitCode,
            stdout: safe(r.stdout, 400),
            stderr: safe(r.stderr, 400),
            marker: "SHOULD_NOT_RUN",
            dirBefore,
            target: { outcome: target.outcome, content: target.bytes ? DEC.decode(target.bytes) : null },
          };
          evidence("S-P4", obs);
          return verdictUnwritableRedirect(obs) as Verdict;
        }),
      );

      // S-P5 — symlinks: is the link EXPOSED by list, and does read FOLLOW it?
      out.push(
        await guarded("S-P5", async () => {
          const w = await sh(t, id, `ln -s ${STAGED_PROMPT_PATH} ${OUTPUT_ROOT}/l1 && ln -s ${HOME_DIR} ${OUTPUT_ROOT}/l2`);
          if (w.channel !== "returned" || w.exitCode !== 0) return inconclusive("S-P5", `setup-exec-${w.channel}-${String(w.exitCode)}`);
          const list = await sdkList(id, OUTPUT_ROOT, 8);
          const r = await readBack(t, id, `${OUTPUT_ROOT}/l1`);
          const readL1 = { outcome: r.outcome, equalsPrompt: r.bytes !== null && DEC.decode(r.bytes) === S_P1_PROMPT, detail: r.detail };
          const tl = await transportListDir(t, id, OUTPUT_ROOT);
          evidence("S-P5", { list: { outcome: list.outcome, detail: list.detail, ...listingForRecord(list.entries) }, readL1, transportListDir: { ...tl, paths: tl.paths.slice(0, LISTING_RECORD_LIMIT), count: tl.paths.length } });
          return verdictSymlinks({ list, readL1, transportListDir: { outcome: tl.outcome, count: tl.paths.length, includesL1: tl.paths.includes(`${OUTPUT_ROOT}/l1`), markedAsLink: tl.markedLinks.includes(`${OUTPUT_ROOT}/l1`), error: (tl as { error?: string }).error ?? null } }) as Verdict;
        }),
      );

      // S-P6 — size metadata of a 3 MiB file.
      out.push(
        await guarded("S-P6", async () => {
          const w = await sh(t, id, `head -c ${BIG_BYTES} /dev/urandom > ${OUTPUT_ROOT}/big.bin && sha256sum ${OUTPUT_ROOT}/big.bin`);
          if (w.channel !== "returned" || w.exitCode !== 0) return inconclusive("S-P6", `setup-exec-${w.channel}-${String(w.exitCode)}`);
          const inSandboxSha = w.stdout.trim().split(/\s+/)[0] ?? "";
          const list = await sdkList(id, OUTPUT_ROOT);
          const t0 = Date.now();
          const r = await readBack(t, id, `${OUTPUT_ROOT}/big.bin`);
          const ms = Date.now() - t0;
          const readSha = r.bytes ? createHash("sha256").update(r.bytes).digest("hex") : "";
          const obs = { list, read: { outcome: r.outcome, bytes: r.bytes?.byteLength ?? null, ms }, expectedBytes: BIG_BYTES, shaMatches: readSha.length > 0 && readSha === inSandboxSha };
          evidence("S-P6", { listSize: list.entries.find((e) => e.path === `${OUTPUT_ROOT}/big.bin`)?.size ?? null, read: obs.read, shaMatches: obs.shaMatches });
          return verdictSizeMetadata(obs) as Verdict;
        }),
      );

      // S-P7 — a create-time env secret written into a file under R.
      out.push(
        await guarded("S-P7", async () => {
          const w = await sh(t, id, `if [ -n "$AOA_PROBE_CANARY" ]; then echo ENV_SET; fi; printf "%s" "$AOA_PROBE_CANARY" > ${OUTPUT_ROOT}/env.txt`);
          const r = await readBack(t, id, `${OUTPUT_ROOT}/env.txt`);
          const obs = { channel: w.channel, exitCode: w.exitCode, envSeenByShell: w.stdout.includes("ENV_SET"), read: { outcome: r.outcome, content: r.bytes ? DEC.decode(r.bytes) : null }, nonce: CANARY };
          evidence("S-P7", { envSeenByShell: obs.envSeenByShell, readOutcome: r.outcome, noncePresent: obs.read.content?.includes(CANARY) ?? false });
          return verdictEnvSecret(obs) as Verdict;
        }),
      );
      return out;
    },
  );
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// P-011b — the claude arms, one fresh sandbox each
// ─────────────────────────────────────────────────────────────────────────────

type ModelArm = "A-neg" | "A-dir" | "A-cwd" | "A-decl";

async function claudeArm(arm: ModelArm, out: Verdict[]): Promise<void> {
  const key = process.env.ANTHROPIC_API_KEY;
  const keyPresent = typeof key === "string" && key.length > 0;
  const nonce = `${RUN_NONCE}-${arm}`;
  if (!keyPresent) {
    out.push(verdictANeg({ cli: { present: true }, keyPresent: false }) as Verdict);
    out[out.length - 1]!.arm = arm;
    if (arm === "A-neg") out.push(notRun("C-census", "no model key: A-neg did not run") as Verdict);
    return;
  }
  await withSandbox(arm, plainCreate(arm, AGENT_SANDBOX_TTL_MS), async (t, id) => {
    const which = await sh(t, id, 'command -v claude && claude --version 2>&1 | head -1');
    const binary = which.stdout.trim().split("\n")[0] ?? "";
    const cli = { present: which.channel === "returned" && which.exitCode === 0 && binary.startsWith("/"), binary, version: safe(which.stdout.trim().split("\n")[1] ?? "", 120) };

    // C-census — A-neg's control: the census must SEE a shell write under R and in cwd.
    if (arm === "A-neg") {
      out.push(
        await guarded("C-census", async () => {
          const pcRoot = `${OUTPUT_ROOT}/.census-pc`;
          const pcCwd = `${HOME_DIR}/census-pc.txt`;
          const before = await sdkList(id, HOME_DIR, CENSUS_DEPTH);
          const w = await sh(t, id, `mkdir -p ${OUTPUT_ROOT} && printf x > ${pcRoot} && printf x > ${pcCwd}`);
          const after = await sdkList(id, HOME_DIR, CENSUS_DEPTH);
          await sh(t, id, `rm -rf ${OUTPUT_ROOT} ${pcCwd}`);
          if (before.outcome !== "ok" || after.outcome !== "ok" || w.exitCode !== 0) return inconclusive("C-census", "census-control-setup-failed");
          const delta = censusDelta(diffSnapshots(before.entries, after.entries), { staged: [] });
          evidence("C-census", { changed: delta.changed.slice(0, LISTING_RECORD_LIMIT) });
          return verdictCensusControl({ delta, expectRoot: pcRoot, expectCwd: pcCwd }) as Verdict;
        }),
      );
    }

    out.push(
      await guarded(arm, async () => {
        const prompt = arm === "A-neg" ? `${A_NEG_PROMPT}\n` : compliancePrompt(arm, nonce);
        const inv = cli.present ? buildSandboxInvocation({ adapterType: "claude_local", binary: cli.binary, prompt, instructions: null, aoaMcpConfig: null }) : null;
        if (cli.present && !inv) throw new Error("buildSandboxInvocation returned null for claude_local");
        const args = inv ? [...inv.args] : [];
        if (inv && arm === "A-cwd") args[1] = withCwdPrefix(String(args[1]));
        const staged = (inv?.stagedFiles ?? []).map((f) => f.path);
        let before: Listing = { outcome: "faulted", entries: [], detail: "not taken" };
        let after: Listing = { outcome: "faulted", entries: [], detail: "not taken" };
        let exec: Exec = { channel: "threw", exitCode: null, stdout: "", stderr: "", detail: "not run" };
        if (inv) {
          await t.writeFiles(id, inv.stagedFiles.map((f) => ({ path: f.path, bytes: f.bytes })));
          before = await sdkList(id, HOME_DIR, CENSUS_DEPTH);
          exec = await run(t, id, inv.command, args, { timeoutMs: AGENT_TIMEOUT_MS, envVars: { ANTHROPIC_API_KEY: key! } });
          after = await sdkList(id, HOME_DIR, CENSUS_DEPTH);
        }
        const delta = censusDelta(diffSnapshots(before.entries, after.entries), { staged });
        const hello = await readBack(t, id, `${OUTPUT_ROOT}/${HELLO_FILE}`);
        const redactedStdout = safe(exec.stdout, Number.MAX_SAFE_INTEGER);
        const stream = readClaudeStream(redactedStdout);
        const obs = {
          cli,
          keyPresent,
          census: { before: { outcome: before.outcome }, after: { outcome: after.outcome } },
          exec: { channel: exec.channel, exitCode: exec.exitCode },
          stream,
          delta,
          nonce,
          helloAtRoot: { outcome: hello.outcome, content: hello.bytes ? DEC.decode(hello.bytes) : null },
          helloElsewhere: delta.changed.filter((e) => e.path.endsWith(`/${HELLO_FILE}`) && e.path !== `${OUTPUT_ROOT}/${HELLO_FILE}`).map((e) => e.path),
        };
        evidence(arm, {
          cli,
          script: inv ? safe(args[1], 2000) : null,
          exec: { channel: exec.channel, exitCode: exec.exitCode, detail: safe(exec.detail, 300) },
          stdoutTruncated: redactedStdout.length > ARM_STDOUT_LIMIT,
          stdout: redactedStdout.slice(0, ARM_STDOUT_LIMIT),
          stderr: safe(exec.stderr, 2000),
          census: { beforeCount: before.entries.length, afterCount: after.entries.length, beforeDetail: before.detail, afterDetail: after.detail, changed: delta.changed.slice(0, LISTING_RECORD_LIMIT), changedCount: delta.changed.length },
          helloAtRoot: { outcome: hello.outcome, containsNonce: obs.helloAtRoot.content?.includes(nonce) ?? false },
        });
        // eslint-disable-next-line no-console
        console.log(`[cli-011/${arm}] channel=${exec.channel} exit=${String(exec.exitCode)} contact=${String(stream.modelContact)} permissionMode=${String(stream.permissionMode)} changed=${delta.changed.length} hello=${hello.outcome}`);
        return (arm === "A-neg" ? verdictANeg(obs) : verdictCompliance(arm, obs)) as Verdict;
      }),
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// The record
// ─────────────────────────────────────────────────────────────────────────────

const COMMIT_SHA = process.env.GITHUB_SHA && process.env.GITHUB_SHA.length > 0 ? process.env.GITHUB_SHA : "unknown";
const RUN_URL = process.env.CLI011_RUN_URL && process.env.CLI011_RUN_URL.length > 0 ? process.env.CLI011_RUN_URL : "unknown";

/**
 * Whether the durable JSON record actually reached disk.
 *
 * ★★★ IT IS ASSERTED, NOT LOGGED. Codex review (PR #551): a failed `writeFileSync` used to be
 * caught and logged, so a run that MEASURED everything could finish green while the only artefact
 * it published was the workflow's `inconclusive` fallback — E7-F025's "fired and unrecorded",
 * reached from the other side. `skipped` is the local, no-`CLI011_RECORD_PATH` case; a keyed run
 * asserts `written`.
 */
export const RECORD_STATUS: { written: boolean; skipped: boolean; detail: string } = {
  written: false,
  skipped: true,
  detail: "not attempted",
};

/** Log + `$GITHUB_STEP_SUMMARY` + the JSON record at `CLI011_RECORD_PATH`. The JSON record is
 *  REQUIRED (see {@link RECORD_STATUS}); the other two channels are best-effort. */
export async function emitDurableRecord(verdicts: Verdict[]): Promise<void> {
  const controls = evaluateControls(verdicts);
  const decisionTable = evaluateDecisionTable(verdicts, ARMS_MODE.mode);
  const disposition = packDisposition(verdicts, controls, ARMS_MODE.mode);
  const base = { verdicts, controls, decisionTable, disposition, template: TEMPLATE, templateSource: TEMPLATE_RESOLUTION.source, armsMode: ARMS_MODE.mode, commitSha: COMMIT_SHA, runNonce: RUN_NONCE };
  const text = safe(renderReport(base), Number.MAX_SAFE_INTEGER);
  // eslint-disable-next-line no-console
  console.log(text);
  const { appendFileSync, mkdirSync, writeFileSync } = await import("node:fs");
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    try {
      appendFileSync(summary, `\n\`\`\`\n${text}\n\`\`\`\n`, "utf8");
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[cli-011] step summary append failed: ${safe(String(err), 200)}`);
    }
  }
  const recordPath = process.env.CLI011_RECORD_PATH;
  if (!recordPath) {
    RECORD_STATUS.skipped = true;
    RECORD_STATUS.written = false;
    RECORD_STATUS.detail = "CLI011_RECORD_PATH is unset (a local run): no durable record was owed";
    return;
  }
  RECORD_STATUS.skipped = false;
  try {
    const { dirname } = await import("node:path");
    const record = buildProbeRecord({ ...base, generatedAt: new Date().toISOString(), workflowRunUrl: RUN_URL, armEvidence: ARM_EVIDENCE, sandboxes: SANDBOXES });
    mkdirSync(dirname(recordPath), { recursive: true });
    writeFileSync(recordPath, `${redactSecrets(JSON.stringify(record, null, 2), SECRETS)}\n`, "utf8");
    RECORD_STATUS.written = true;
    RECORD_STATUS.detail = recordPath;
  } catch (err) {
    RECORD_STATUS.written = false;
    RECORD_STATUS.detail = safe(`${String((err as Error)?.name)}: ${String((err as Error)?.message ?? err)}`, 300);
    // eslint-disable-next-line no-console
    console.error(`[cli-011] could not write the durable record: ${RECORD_STATUS.detail}`);
  }
}

describeKeyed("CLI-011 P-011 — the output probe, against REAL E2B", () => {
  it(
    "answers every §10.5 row from a real sandbox and a real claude, with controls that can go the other way",
    async () => {
      const verdicts: Verdict[] = [];
      try {
        verdicts.push(...(await p011a().catch((err) => [inconclusive("S-P0", `p011a-threw: ${safe(String((err as Error)?.message ?? err), 300)}`)])));
        // ★ The MODE decides which model arms run, and the skipped ones are recorded `not-run`
        //   with the mode named — never silently absent. `a-neg-only` (ruling F8's pre-M1b re-run)
        //   runs A-neg alone, and `claudeArm` emits its C-census control inside that same arm, so
        //   the one turn still carries its positive control.
        const asked = MODEL_ARMS_FOR_MODE[ARMS_MODE.mode] as readonly ModelArm[];
        for (const arm of MODEL_ARMS as readonly ModelArm[]) {
          if (!asked.includes(arm)) continue;
          await claudeArm(arm, verdicts).catch((err) => verdicts.push(inconclusive(arm, `sandbox-threw: ${safe(String((err as Error)?.message ?? err), 300)}`)));
        }
        for (const arm of MODEL_ARMS as readonly ModelArm[]) {
          if (!asked.includes(arm)) verdicts.push(notRun(arm, `arms=${ARMS_MODE.mode}`) as Verdict);
        }
        if (!asked.includes("A-neg" as ModelArm)) verdicts.push(notRun("C-census", `arms=${ARMS_MODE.mode}`) as Verdict);
      } finally {
        await emitDurableRecord(verdicts);
      }
      const d = packDisposition(verdicts, evaluateControls(verdicts), ARMS_MODE.mode);
      // Every sandbox this run made was terminated.
      expect(SANDBOXES.filter((s) => !s.terminated), "a sandbox was not terminated").toEqual([]);
      // ★ The verdict must be PUBLISHED, not merely computed. Without this, a measured run whose
      // record could not be written finishes green while the workflow uploads its `inconclusive`
      // fallback, so the run reads as "no measurement" and nobody notices (Codex review, PR #551).
      expect(
        RECORD_STATUS.skipped || RECORD_STATUS.written,
        `the durable record was not written: ${RECORD_STATUS.detail}`,
      ).toBe(true);
      expect(d.disposition, d.detail).toBe("measured");
    },
    40 * 60 * 1000,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Proven WITHOUT a key, on every PR (the package's own `verify` run)
// ─────────────────────────────────────────────────────────────────────────────

describe("CLI-011 P-011 — wiring proven without a key", () => {
  const stubTransport = (over: Partial<E2bTransport> & { terminated?: string[] }) => {
    const terminated: string[] = [];
    const t = {
      create: async () => ({ sandboxId: "sbx-stub" }),
      terminate: async (id: string) => void terminated.push(id),
      ...over,
    } as unknown as E2bTransport;
    return { t, terminated };
  };

  it("the reporting proxy reports the id AND keeps private-field methods callable", async () => {
    // ★ The real transport keeps `#sdk`/`#apiKey` as PRIVATE fields, and `provider.create` calls
    // `setTimeout` through this proxy right after `create`. An unbound pass-through would run that
    // method with `this` = the proxy and throw a brand-check TypeError (Codex review, PR #551), so
    // the double below has a private field for exactly that reason.
    class PrivateFieldTransport {
      #calls: string[] = [];
      async create() {
        this.#calls.push("create");
        return { sandboxId: "sbx-proxy" };
      }
      async setTimeout(_id: string, _ms: number) {
        this.#calls.push("setTimeout");
      }
      calls() {
        return [...this.#calls];
      }
    }
    const real = new PrivateFieldTransport();
    const reported: string[] = [];
    const proxied = reportingTransport(real as unknown as E2bTransport, (id) => reported.push(id));
    const created = await proxied.create({} as never);
    expect(created.sandboxId).toBe("sbx-proxy");
    expect(reported).toEqual(["sbx-proxy"]);
    // The pass-through call is the one that used to throw.
    await proxied.setTimeout("sbx-proxy", 1000);
    expect(real.calls()).toEqual(["create", "setTimeout"]);
  });

  it("POSITIVE CONTROL: a sandbox allocated before the create step threw is still terminated", async () => {
    // `provider.create` = transport.create THEN setTimeout; a throw in the second step used to
    // leak the live sandbox (Codex review, PR #551).
    const { t, terminated } = stubTransport({});
    const before = SANDBOXES.length;
    await expect(
      withSandbox(
        "stub",
        async (x, report) => {
          const { sandboxId } = await x.create({} as never);
          report(sandboxId);
          throw new Error("setTimeout failed");
        },
        async () => 1,
        { transport: async () => t },
      ),
    ).rejects.toThrow("setTimeout failed");
    expect(terminated).toEqual(["sbx-stub"]);
    expect(SANDBOXES.slice(before)).toEqual([
      { lane: "stub(partial-create)", sandboxId: "sbx-stub", terminated: true, detail: "terminated after the create step threw" },
    ]);
    SANDBOXES.length = before;
  });

  it("withSandbox terminates the sandbox when the arm THROWS, and records it", async () => {
    const { t, terminated } = stubTransport({});
    const before = SANDBOXES.length;
    await expect(
      withSandbox("stub", async (x, report) => { const { sandboxId } = await x.create({} as never); report(sandboxId); return sandboxId; }, async () => { throw new Error("arm blew up"); }, { transport: async () => t }),
    ).rejects.toThrow("arm blew up");
    expect(terminated).toEqual(["sbx-stub"]);
    expect(SANDBOXES.slice(before)).toEqual([{ lane: "stub", sandboxId: "sbx-stub", terminated: true, detail: "" }]);
    SANDBOXES.length = before;
  });

  it("POSITIVE CONTROL: a failing terminate is recorded as NOT terminated (the run assertion then reds)", async () => {
    const { t } = stubTransport({ terminate: async () => { throw new Error("e2b 500"); } });
    const before = SANDBOXES.length;
    await withSandbox("stub", async () => "sbx-2", async () => 1, { transport: async () => t });
    expect(SANDBOXES[before]).toMatchObject({ sandboxId: "sbx-2", terminated: false });
    expect(SANDBOXES[before]!.detail).toContain("e2b 500");
    SANDBOXES.length = before;
  });

  it("readBack: a transport not-found is `not-found`; any other throw is `faulted`", async () => {
    const nf = { readFile: async () => { throw new E2bTransportNotFoundError("x"); } } as unknown as E2bTransport;
    const f = { readFile: async () => { throw new Error("ECONNRESET"); } } as unknown as E2bTransport;
    expect((await readBack(nf, "s", "/p")).outcome).toBe("not-found");
    expect((await readBack(f, "s", "/p")).outcome).toBe("faulted");
  });

  it("sdkList keeps type/size/symlinkTarget, and classifies not-found apart from a fault", async () => {
    class NF extends Error {}
    const connect = async () => ({ files: { list: async () => [{ name: "l1", path: "/r/l1", type: "file", size: 3, symlinkTarget: "/t" }] } });
    const ok = await sdkList("s", "/r", 8, { connect, isNotFound: (e) => e instanceof NF });
    expect(ok).toMatchObject({ outcome: "ok", entries: [{ path: "/r/l1", type: "file", size: 3, symlinkTarget: "/t" }] });
    const thrower = (e: Error) => async () => ({ files: { list: async () => { throw e; } } });
    expect((await sdkList("s", "/r", 8, { connect: thrower(new NF("gone")), isNotFound: (e) => e instanceof NF })).outcome).toBe("not-found");
    expect((await sdkList("s", "/r", 8, { connect: thrower(new Error("boom")), isNotFound: (e) => e instanceof NF })).outcome).toBe("faulted");
  });

  it("the claude arms run the SHIPPED no-bundle literal, and A-cwd's prefix applies to it exactly once", () => {
    const inv = buildSandboxInvocation({ adapterType: "claude_local", binary: "/usr/bin/claude", prompt: "p", instructions: null, aoaMcpConfig: null });
    expect(inv).not.toBeNull();
    const script = String(inv!.args[1]);
    expect(script).toContain('exec "$0" --print -');
    const prefixed = withCwdPrefix(script);
    expect(prefixed).toContain(`mkdir -p ${OUTPUT_ROOT} && cd ${OUTPUT_ROOT} && exec "$0"`);
    expect(prefixed.replace(`mkdir -p ${OUTPUT_ROOT} && cd ${OUTPUT_ROOT} && `, "")).toBe(script);
  });

  it("S-P1 stages the full set (prompt + instructions + MCP config), none under R", () => {
    const paths = (S_P1_INVOCATION?.stagedFiles ?? []).map((f) => f.path);
    expect(paths).toHaveLength(3);
    expect(paths.some((p) => p.startsWith(`${OUTPUT_ROOT}/`))).toBe(false);
  });

  it("an omitted template resolves to aoa-base, never bare base", () => {
    const raw = process.env.E2B_TEMPLATE;
    if (typeof raw !== "string" || raw.trim().length === 0) expect(TEMPLATE).toBe("aoa-base");
    else expect(TEMPLATE).toBe(raw.trim());
  });

  it("POSITIVE CONTROL: a record that cannot be written is REPORTED, not swallowed", async () => {
    const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "cli011-unwritable-"));
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "not a directory", "utf8");
    const prev = { r: process.env.CLI011_RECORD_PATH, s: process.env.GITHUB_STEP_SUMMARY };
    // The parent of the record path is a FILE, so `mkdirSync` cannot create it.
    process.env.CLI011_RECORD_PATH = join(blocker, "record.json");
    process.env.GITHUB_STEP_SUMMARY = join(dir, "summary.md");
    try {
      await emitDurableRecord([{ arm: "S-P0", state: "observed", reason: "root-absent", findings: { present: false, presentPaths: [] } }]);
      expect(RECORD_STATUS.written).toBe(false);
      expect(RECORD_STATUS.skipped).toBe(false);
      expect(RECORD_STATUS.detail).not.toBe("not attempted");
    } finally {
      if (prev.r === undefined) delete process.env.CLI011_RECORD_PATH;
      else process.env.CLI011_RECORD_PATH = prev.r;
      if (prev.s === undefined) delete process.env.GITHUB_STEP_SUMMARY;
      else process.env.GITHUB_STEP_SUMMARY = prev.s;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("emitDurableRecord writes a redacted record with the decision table, and the summary block", async () => {
    const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "cli011-record-"));
    const prev = { r: process.env.CLI011_RECORD_PATH, s: process.env.GITHUB_STEP_SUMMARY };
    process.env.CLI011_RECORD_PATH = join(dir, "nested", "record.json");
    process.env.GITHUB_STEP_SUMMARY = join(dir, "summary.md");
    const evBefore = ARM_EVIDENCE.length;
    ARM_EVIDENCE.push({ arm: "stub", leaked: `canary=${CANARY}` });
    try {
      await emitDurableRecord([{ arm: "S-P0", state: "observed", reason: "root-absent", findings: { present: false, presentPaths: [] } }]);
      const raw = readFileSync(process.env.CLI011_RECORD_PATH, "utf8");
      const rec = JSON.parse(raw);
      expect(rec.schema).toBe("aoa.cli-011.output-probe-record/1");
      expect(rec.template.resolved).toBe(TEMPLATE);
      expect(rec.decisionTable).toHaveLength(12);
      expect(rec.disposition.disposition).toBe("inconclusive");
      expect(raw.includes(CANARY)).toBe(false);
      expect(raw).toContain("«redacted»");
      expect(readFileSync(process.env.GITHUB_STEP_SUMMARY, "utf8")).toContain("§10.5 decision table");
      expect(RECORD_STATUS).toMatchObject({ written: true, skipped: false });
    } finally {
      ARM_EVIDENCE.length = evBefore;
      if (prev.r === undefined) delete process.env.CLI011_RECORD_PATH;
      else process.env.CLI011_RECORD_PATH = prev.r;
      if (prev.s === undefined) delete process.env.GITHUB_STEP_SUMMARY;
      else process.env.GITHUB_STEP_SUMMARY = prev.s;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
