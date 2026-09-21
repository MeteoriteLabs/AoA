// CLI-011 P-011 — the output probe's decision logic, proven WITHOUT a key, on every PR
// (`policy` job). The keyed lane runs once, on the planning session's dispatch; every
// decision it makes is a pure function exercised here first.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  A_NEG_PROMPT,
  CLI_BEARING_TEMPLATE_ALIAS,
  CwdPrefixAnchorError,
  HOME_DIR,
  MODEL_ARMS,
  OUTPUT_DIRECTIVE,
  OUTPUT_ROOT,
  PROBE_RECORD_SCHEMA,
  SHELL_ARMS,
  buildProbeRecord,
  censusDelta,
  classifyPath,
  compliancePrompt,
  diffSnapshots,
  evaluateControls,
  evaluateDecisionTable,
  evaluateWorkflowShape,
  normaliseEntry,
  notRun,
  packDisposition,
  readClaudeStream,
  readDeclaration,
  readJobGates,
  redactSecrets,
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
} from "../cli-011-output-probe.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WORKFLOW = path.join(ROOT, ".github", "workflows", "keyed-e2b-cli-011-output-probe.yml");
const KEYED_TEST = path.join(ROOT, "packages", "sandbox-e2b-provider", "src", "__tests__", "keyed-cli-011-output-probe.test.ts");
const INVOCATION = path.join(ROOT, "server", "src", "services", "task-run-sandbox-invocation.ts");

const STAGED = [`${HOME_DIR}/.aoa-run-prompt.md`, `${HOME_DIR}/.aoa-run-instructions.md`, `${HOME_DIR}/.aoa-run-mcp.json`];
const file = (p, extra = {}) => ({ path: p, type: "file", size: 1, mtime: "t0", symlinkTarget: null, ...extra });
const dir = (p, extra = {}) => ({ path: p, type: "dir", size: 4096, mtime: "t0", symlinkTarget: null, ...extra });
const ok = (entries = []) => ({ outcome: "ok", entries });
const NF = { outcome: "not-found", entries: [] };

// A claude stream with a real model answer (billed usage) and the init frame.
const stream = (finalText = "OK") =>
  [
    JSON.stringify({ type: "system", subtype: "init", cwd: HOME_DIR, permissionMode: "bypassPermissions" }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: finalText }] } }),
    JSON.stringify({ type: "result", subtype: "success", is_error: false, result: finalText, usage: { output_tokens: 3 } }),
  ].join("\n");

function modelObs(arm, { delta, hello = null, final = "OK", nonce = "N-1", elsewhere = [] } = {}) {
  return {
    cli: { present: true },
    keyPresent: true,
    census: { before: { outcome: "ok" }, after: { outcome: "ok" } },
    exec: { channel: "returned", exitCode: 0 },
    stream: readClaudeStream(stream(final)),
    delta: delta ?? censusDelta(diffSnapshots([], []), { staged: STAGED }),
    nonce,
    helloAtRoot: hello ?? { outcome: "not-found" },
    helloElsewhere: elsewhere,
    arm,
  };
}

/** A full, all-observed verdict set in which every control holds. */
function baseline({ aNegDelta, dirWrites = true, cwdWrites = true, decl = "AOA-OUTPUT: hello.txt" } = {}) {
  const helloDelta = censusDelta(diffSnapshots([], [dir(OUTPUT_ROOT), file(`${OUTPUT_ROOT}/hello.txt`)]), { staged: STAGED });
  const noDelta = censusDelta(diffSnapshots([], []), { staged: STAGED });
  const hello = (w) => (w ? { outcome: "ok", content: "N-1\n" } : { outcome: "not-found" });
  return [
    verdictRootPresence("S-P0", { rootList: NF, rootRead: { outcome: "not-found" }, home: ok([file(STAGED[0])]) }),
    verdictRootPresence("S-PC1", { rootList: ok([file(`${OUTPUT_ROOT}/.pc1`)]), rootRead: { outcome: "not-found" }, home: ok([file(`${OUTPUT_ROOT}/.pc1`)]) }),
    verdictStaged("S-P1", { home: ok(STAGED.map((p) => file(p))), staged: STAGED, root: OUTPUT_ROOT }),
    verdictStaged("S-PC2", { home: ok(STAGED.map((p) => file(p))), staged: STAGED, root: HOME_DIR }),
    verdictDepthAndType({
      defaultList: ok([file(`${OUTPUT_ROOT}/a.txt`), dir(`${OUTPUT_ROOT}/sub`)]),
      deepList: ok([file(`${OUTPUT_ROOT}/a.txt`), dir(`${OUTPUT_ROOT}/sub`), file(`${OUTPUT_ROOT}/sub/b.txt`)]),
      reads: [{ path: `${OUTPUT_ROOT}/a.txt`, outcome: "ok", bytes: "N1", expected: "N1" }],
    }),
    verdictNonZeroExit({
      viaRunCommand: { channel: "returned", exitCode: 3, expected: "N3", read: { outcome: "ok", content: "N3" } },
      viaProviderExecute: { channel: "returned", exitCode: 3, expected: "N3b", read: { outcome: "ok", content: "N3b" } },
    }),
    verdictUnwritableRedirect({ channel: "returned", exitCode: 1, stdout: "", stderr: "sh: cannot create", marker: "SHOULD_NOT_RUN" }),
    verdictSymlinks({
      list: ok([file(`${OUTPUT_ROOT}/l1`, { symlinkTarget: STAGED[0] }), dir(`${OUTPUT_ROOT}/l2`, { symlinkTarget: HOME_DIR })]),
      readL1: { outcome: "ok", equalsPrompt: true },
    }),
    verdictSizeMetadata({ list: ok([file(`${OUTPUT_ROOT}/big.bin`, { size: 3145728 })]), read: { outcome: "ok", bytes: 3145728, ms: 900 }, expectedBytes: 3145728, shaMatches: true }),
    verdictEnvSecret({ envSeenByShell: true, read: { outcome: "ok", content: "CANARY-1" }, nonce: "CANARY-1" }),
    verdictCensusControl({ delta: censusDelta(diffSnapshots([], [file(`${OUTPUT_ROOT}/.census-pc`), file(`${HOME_DIR}/census-pc.txt`)]), { staged: STAGED }), expectRoot: `${OUTPUT_ROOT}/.census-pc`, expectCwd: `${HOME_DIR}/census-pc.txt` }),
    verdictANeg(modelObs("A-neg", { delta: aNegDelta ?? noDelta })),
    verdictCompliance("A-dir", modelObs("A-dir", { delta: dirWrites ? helloDelta : noDelta, hello: hello(dirWrites) })),
    verdictCompliance("A-cwd", modelObs("A-cwd", { delta: cwdWrites ? helloDelta : noDelta, hello: hello(cwdWrites) })),
    verdictCompliance("A-decl", modelObs("A-decl", { delta: helloDelta, hello: hello(true), final: `Done.\n${decl}` })),
  ];
}

const rowOf = (rows, id) => rows.find((r) => r.id === id);

// ── inputs ────────────────────────────────────────────────────────────────────

test("an omitted template resolves to the CLI-bearing aoa-base, never bare base (reused from W7U1)", () => {
  assert.equal(resolveTemplate("").templateId, CLI_BEARING_TEMPLATE_ALIAS);
  assert.equal(resolveTemplate("  ").source, "default-cli-bearing");
  assert.equal(resolveTemplate("custom").templateId, "custom");
});

test("the arms mode defaults to all, accepts shell-only, and REFUSES anything else", () => {
  assert.deepEqual(resolveArmsMode(""), { mode: "all", source: "default" });
  assert.equal(resolveArmsMode("shell-only").mode, "shell-only");
  assert.throws(() => resolveArmsMode("shell"), /unknown arms mode/);
});

test("the redactor removes a secret wherever it appears (reused from W7U1)", () => {
  assert.equal(redactSecrets("key=sk-ant-0123456789 end", ["sk-ant-0123456789"]).includes("sk-ant"), false);
});

// ── A-cwd's probe-local transform, against the REAL shipped literal ──────────

test("withCwdPrefix inserts `mkdir -p R && cd R &&` before the ONE exec in the shipped claude literal", () => {
  const src = readFileSync(INVOCATION, "utf8");
  // The no-bundle, no-config claude literal the claude arms run, read from source.
  const m = /script = hasInstructions\s*\?[^:]+:\s*`(\$\{guard\}; exec "\$0" --print - --dangerously-skip-permissions --output-format stream-json --verbose < "\$1")`;/.exec(src);
  assert.ok(m, "the shipped no-bundle claude literal was not found — the transform's anchor may have moved");
  const script = m[1].replace("${guard}", "for f in \"$1\"; do :; done");
  const out = withCwdPrefix(script);
  assert.ok(out.includes(`; mkdir -p ${OUTPUT_ROOT} && cd ${OUTPUT_ROOT} && exec "$0" --print -`));
  assert.equal(out.replace(`mkdir -p ${OUTPUT_ROOT} && cd ${OUTPUT_ROOT} && `, ""), script);
});

test("withCwdPrefix THROWS on zero or two anchors, so A-cwd cannot silently equal A-dir", () => {
  assert.throws(() => withCwdPrefix("claude --print"), CwdPrefixAnchorError);
  assert.throws(() => withCwdPrefix('a; exec "$0" x; exec "$0" y'), CwdPrefixAnchorError);
});

test("the prompts are §10.4's, and only A-dir/A-decl carry the directive", () => {
  assert.equal(A_NEG_PROMPT, "Reply with the single word OK. Do not create, modify or delete any file.");
  assert.ok(compliancePrompt("A-dir", "N").includes(OUTPUT_DIRECTIVE));
  assert.ok(compliancePrompt("A-decl", "N").includes("AOA-OUTPUT:"));
  assert.equal(compliancePrompt("A-cwd", "N").includes(OUTPUT_ROOT), false, "A-cwd names NO location");
  assert.throws(() => compliancePrompt("A-neg", "N"));
});

// ── census ────────────────────────────────────────────────────────────────────

test("normaliseEntry keeps type, size and symlinkTarget — the three fields the transport discards", () => {
  const e = normaliseEntry({ name: "l1", path: "/x/l1", type: "file", size: 5, symlinkTarget: "/y", modifiedTime: new Date(0) });
  assert.deepEqual(e, { path: "/x/l1", type: "file", size: 5, mtime: "1970-01-01T00:00:00.000Z", symlinkTarget: "/y" });
  assert.equal(normaliseEntry({ path: "/x", symlinkTarget: "" }).symlinkTarget, null);
});

test("classifyPath: root wins; staged is never cwd-other; CLI home state is reported apart", () => {
  const o = { staged: STAGED };
  assert.equal(classifyPath(`${OUTPUT_ROOT}/x`, o), "under-root");
  assert.equal(classifyPath(OUTPUT_ROOT, o), "under-root");
  assert.equal(classifyPath(STAGED[0], o), "staged");
  assert.equal(classifyPath(`${HOME_DIR}/.claude/projects/s.jsonl`, o), "cli-home-state");
  assert.equal(classifyPath(`${HOME_DIR}/.claude.json`, o), "cli-home-state");
  assert.equal(classifyPath(`${HOME_DIR}/notes.md`, o), "cwd-other");
  assert.equal(classifyPath(`${HOME_DIR}/aoa-outputX/y`, o), "cwd-other", "a sibling sharing the prefix is NOT under R");
  // PC-2's mutant at the unit layer: with R = /home/user the staged set IS under the root.
  assert.equal(classifyPath(STAGED[0], { staged: STAGED, root: HOME_DIR }), "under-root");
});

test("diffSnapshots/censusDelta see added and modified files, and never count a directory as a file", () => {
  const before = [file(`${HOME_DIR}/a.md`), file(`${HOME_DIR}/.claude.json`, { mtime: "t0" })];
  const after = [file(`${HOME_DIR}/a.md`), file(`${HOME_DIR}/.claude.json`, { mtime: "t1" }), dir(OUTPUT_ROOT), file(`${OUTPUT_ROOT}/x`), file(`${HOME_DIR}/new.md`)];
  const d = censusDelta(diffSnapshots(before, after), { staged: STAGED });
  assert.deepEqual(d.filesUnderRoot, [`${OUTPUT_ROOT}/x`]);
  assert.deepEqual(d.filesCwdOther, [`${HOME_DIR}/new.md`]);
  assert.deepEqual(d.filesCliHomeState, [`${HOME_DIR}/.claude.json`]);
  assert.equal(d.rootCreated, true);
  // Anti-vacuity: identical snapshots produce NOTHING.
  const none = censusDelta(diffSnapshots(before, before), { staged: STAGED });
  assert.equal(none.changed.length, 0);
});

// ── the claude stream ─────────────────────────────────────────────────────────

test("readClaudeStream reads permissionMode, cwd and the FINAL result; frames alone are not model contact", () => {
  const s = readClaudeStream(stream("hi"));
  assert.equal(s.permissionMode, "bypassPermissions");
  assert.equal(s.initCwd, HOME_DIR);
  assert.equal(s.finalResultText, "hi");
  assert.equal(s.modelContact, true);
  // An auth-failed run still emits init + an is_error result (§3.8): NOT contact.
  const failed = readClaudeStream(
    [JSON.stringify({ type: "system", subtype: "init" }), JSON.stringify({ type: "result", is_error: true, result: "401" })].join("\n"),
  );
  assert.equal(failed.initSeen, true);
  assert.equal(failed.modelContact, false);
});

test("readDeclaration reads only the last line of the final result, relative to R", () => {
  const w = [`${OUTPUT_ROOT}/hello.txt`];
  assert.deepEqual(readDeclaration("Done.\nAOA-OUTPUT: hello.txt", w), { present: true, declared: "hello.txt", resolved: `${OUTPUT_ROOT}/hello.txt`, relative: true, matchesWritten: true });
  assert.equal(readDeclaration("Done.\nAOA-OUTPUT: ./hello.txt", w).matchesWritten, true);
  // Codex review (PR #551): the contract is a RELATIVE path; every other form is refused, even
  // one that would resolve to the written file.
  for (const bad of [`${OUTPUT_ROOT}/hello.txt`, "~/aoa-output/hello.txt", "../aoa-output/hello.txt", "sub/../hello.txt", "a//hello.txt", "sub\\hello.txt"]) {
    const r = readDeclaration(`Done.\nAOA-OUTPUT: ${bad}`, [...w, `${OUTPUT_ROOT}/a/hello.txt`]);
    assert.equal(r.present, true, bad);
    assert.equal(r.relative, false, bad);
    assert.equal(r.matchesWritten, false, bad);
  }
  assert.equal(readDeclaration("Done.\nAOA-OUTPUT: other.txt", w).matchesWritten, false);
  assert.equal(readDeclaration("AOA-OUTPUT: hello.txt\nthen more text", w).present, false);
  assert.equal(readDeclaration(null, w).present, false);
});

// ── per-arm verdicts: each distinguishes, and each refuses to guess ─────────

test("S-P0: not-found everywhere is `root-absent`; a faulted read is inconclusive, never absent", () => {
  assert.equal(verdictRootPresence("S-P0", { rootList: NF, rootRead: { outcome: "not-found" }, home: ok([]) }).findings.present, false);
  assert.equal(verdictRootPresence("S-P0", { rootList: { outcome: "faulted" }, rootRead: { outcome: "not-found" }, home: ok([]) }).state, "inconclusive");
  // PC-1 at the unit layer: the SAME function on a planted file reports present.
  assert.equal(verdictRootPresence("S-PC1", { rootList: NF, rootRead: { outcome: "not-found" }, home: ok([file(`${OUTPUT_ROOT}/p`)]) }).findings.present, true);
});

test("S-P1 is inconclusive if the listing cannot even see the staged set", () => {
  assert.equal(verdictStaged("S-P1", { home: ok([]), staged: STAGED, root: OUTPUT_ROOT }).reason, "listing-does-not-show-the-staged-set");
});

test("S-P3: only a RETURNED non-zero exit counts; timed out, threw or exit 0 is inconclusive", () => {
  const leg = (channel, exitCode) => ({ channel, exitCode, expected: "N3", read: { outcome: "ok", content: "N3" } });
  const ok = verdictNonZeroExit({ viaRunCommand: leg("returned", 3), viaProviderExecute: leg("returned", 3) });
  assert.equal(ok.state, "observed");
  assert.equal(ok.findings.viaRunCommand.fileSurvived, true);
  // Codex review (PR #551): the file may predate the deadline; no exit was observed.
  const t1 = verdictNonZeroExit({ viaRunCommand: leg("timedOut", null), viaProviderExecute: leg("returned", 3) });
  assert.equal(t1.state, "inconclusive");
  assert.match(t1.reason, /viaRunCommand-channel-timedOut/);
  assert.equal(verdictNonZeroExit({ viaRunCommand: leg("returned", 3), viaProviderExecute: leg("timedOut", null) }).state, "inconclusive");
  // Codex review (PR #551, second pass): a non-zero exit must be OBSERVED on both legs.
  const threw = verdictNonZeroExit({ viaRunCommand: leg("threw", null), viaProviderExecute: leg("returned", 3) });
  assert.equal(threw.state, "inconclusive");
  assert.match(threw.reason, /viaRunCommand-channel-threw/);
  const zero = verdictNonZeroExit({ viaRunCommand: leg("returned", 3), viaProviderExecute: leg("returned", 0) });
  assert.equal(zero.state, "inconclusive");
  assert.match(zero.reason, /viaProviderExecute-no-non-zero-exit-observed\(0\)/);
  assert.equal(verdictNonZeroExit({ viaRunCommand: leg("returned", null), viaProviderExecute: leg("returned", 3) }).state, "inconclusive");
});

test("S-P7 is inconclusive when its command did not return", () => {
  assert.equal(verdictEnvSecret({ channel: "timedOut", envSeenByShell: true, read: { outcome: "ok", content: "C" }, nonce: "C" }).state, "inconclusive");
  assert.equal(verdictEnvSecret({ channel: "returned", envSeenByShell: true, read: { outcome: "ok", content: "C" }, nonce: "C" }).state, "observed");
});

test("S-P4 distinguishes a redirect that failed first from one that let the command run", () => {
  assert.equal(verdictUnwritableRedirect({ channel: "returned", exitCode: 2, stdout: "", marker: "M" }).findings.failedClosed, true);
  assert.equal(verdictUnwritableRedirect({ channel: "returned", exitCode: 0, stdout: "M", marker: "M" }).reason, "command-ran-despite-redirect");
});

test("S-P7 is inconclusive if the canary never reached the shell (else `absent` would be vacuous)", () => {
  assert.equal(verdictEnvSecret({ envSeenByShell: false, read: { outcome: "ok", content: "" }, nonce: "C" }).state, "inconclusive");
  assert.equal(verdictEnvSecret({ envSeenByShell: true, read: { outcome: "ok", content: "C" }, nonce: "C" }).findings.noncePresent, true);
});

test("the census control is inconclusive when the census misses a planted write", () => {
  const blind = censusDelta(diffSnapshots([], [file(`${HOME_DIR}/census-pc.txt`)]), { staged: STAGED });
  assert.equal(verdictCensusControl({ delta: blind, expectRoot: `${OUTPUT_ROOT}/.census-pc`, expectCwd: `${HOME_DIR}/census-pc.txt` }).state, "inconclusive");
});

test("a model arm is NOT a measurement without a CLI, a key, a returned exec, or model contact", () => {
  const good = modelObs("A-neg");
  assert.equal(verdictANeg(good).state, "observed");
  assert.equal(verdictANeg({ ...good, cli: { present: false } }).reason, "template-without-cli");
  assert.equal(verdictANeg({ ...good, keyPresent: false }).reason, "no-model-provider-key");
  assert.equal(verdictANeg({ ...good, exec: { channel: "timedOut" } }).reason, "exec-timedOut");
  assert.equal(verdictANeg({ ...good, stream: { ...good.stream, modelContact: false } }).reason, "no-model-contact-evidence");
  assert.equal(verdictANeg({ ...good, census: { before: { outcome: "faulted" }, after: { outcome: "ok" } } }).reason, "census-listing-faulted");
});

test("compliance needs the nonce in R/hello.txt, not merely a file of that name", () => {
  const d = censusDelta(diffSnapshots([], [file(`${OUTPUT_ROOT}/hello.txt`)]), { staged: STAGED });
  assert.equal(verdictCompliance("A-dir", modelObs("A-dir", { delta: d, hello: { outcome: "ok", content: "wrong" } })).findings.wroteHelloAtRoot, false);
  assert.equal(verdictCompliance("A-dir", modelObs("A-dir", { delta: d, hello: { outcome: "faulted" } })).state, "inconclusive");
});

// ── §10.5, every row ──────────────────────────────────────────────────────────

test("the table has all twelve §10.5 rows, each with a boolean or `undecidable`", () => {
  const rows = evaluateDecisionTable(baseline());
  assert.equal(rowOf(rows, "R12").fired, false, "the all-observed baseline is a measurement");
  assert.deepEqual(rows.map((r) => r.id), ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "R10", "R11", "R12"]);
  for (const r of rows) assert.ok(r.fired === true || r.fired === false || r.fired === "undecidable", r.id);
});

test("R1 fires only when S-P0 sees something at R", () => {
  const v = baseline();
  assert.equal(rowOf(evaluateDecisionTable(v), "R1").fired, false);
  v[0] = verdictRootPresence("S-P0", { rootList: ok([file(`${OUTPUT_ROOT}/pre`)]), rootRead: { outcome: "not-found" }, home: ok([]) });
  assert.equal(rowOf(evaluateDecisionTable(v), "R1").fired, true);
});

test("R2 reads S-P2's default-depth directory entries", () => {
  assert.equal(rowOf(evaluateDecisionTable(baseline()), "R2").fired, true);
  const v = baseline();
  v[4] = verdictDepthAndType({ defaultList: ok([file(`${OUTPUT_ROOT}/a.txt`)]), deepList: ok([file(`${OUTPUT_ROOT}/sub/b.txt`)]), reads: [] });
  assert.equal(rowOf(evaluateDecisionTable(v), "R2").fired, false);
});

test("R3 fires only when the link is hidden from the list AND read follows it", () => {
  assert.equal(rowOf(evaluateDecisionTable(baseline()), "R3").fired, false);
  const v = baseline();
  v[7] = verdictSymlinks({ list: ok([file(`${OUTPUT_ROOT}/l1`), dir(`${OUTPUT_ROOT}/l2`)]), readL1: { outcome: "ok", equalsPrompt: true } });
  assert.equal(rowOf(evaluateDecisionTable(v), "R3").fired, true);
});

test("R4 reads S-P7", () => {
  assert.equal(rowOf(evaluateDecisionTable(baseline()), "R4").fired, true);
});

test("R5/R6 split A-neg: under R, into cwd, or neither — and name OPTION 2 REFUTED when A-dir's R is dirty too", () => {
  let rows = evaluateDecisionTable(baseline());
  assert.equal(rowOf(rows, "R5").fired, false);
  assert.equal(rowOf(rows, "R6").fired, true);

  const cwdWrite = censusDelta(diffSnapshots([], [file(`${HOME_DIR}/CLAUDE.md`)]), { staged: STAGED });
  rows = evaluateDecisionTable(baseline({ aNegDelta: cwdWrite }));
  assert.equal(rowOf(rows, "R5").fired, false);
  assert.equal(rowOf(rows, "R6").fired, false, "a cwd write breaks R6 without firing R5");

  // Codex review (PR #551): a DELETION is a mutation. The A-neg prompt forbids it, so a CLI that
  // deletes a cwd file, or deletes or changes a staged input, must not read as "nothing".
  const deleted = censusDelta(diffSnapshots([file(`${HOME_DIR}/notes.md`)], []), { staged: STAGED });
  assert.deepEqual(deleted.removedCwdOther, [`${HOME_DIR}/notes.md`]);
  assert.deepEqual(deleted.filesCwdOther, [], "a removed path never appears among written files");
  rows = evaluateDecisionTable(baseline({ aNegDelta: deleted }));
  assert.equal(rowOf(rows, "R6").fired, false, "a deleted cwd file breaks R6");
  const stagedGone = censusDelta(diffSnapshots([file(STAGED[0])], []), { staged: STAGED });
  assert.equal(rowOf(evaluateDecisionTable(baseline({ aNegDelta: stagedGone })), "R6").fired, false, "a deleted staged input breaks R6");
  const rootGone = censusDelta(diffSnapshots([file(`${OUTPUT_ROOT}/pre`)], []), { staged: STAGED });
  rows = evaluateDecisionTable(baseline({ aNegDelta: rootGone }));
  assert.equal(rowOf(rows, "R5").fired, true, "a deletion under R fires R5");
  assert.equal(rowOf(rows, "R6").fired, false);

  const homeState = censusDelta(diffSnapshots([], [file(`${HOME_DIR}/.claude/projects/x.jsonl`)]), { staged: STAGED });
  assert.equal(rowOf(evaluateDecisionTable(baseline({ aNegDelta: homeState })), "R6").fired, true, "CLI home state is reported, not counted");

  const underRoot = censusDelta(diffSnapshots([], [file(`${OUTPUT_ROOT}/.session`)]), { staged: STAGED });
  const v = baseline({ aNegDelta: underRoot });
  const dirty = censusDelta(diffSnapshots([], [file(`${OUTPUT_ROOT}/hello.txt`), file(`${OUTPUT_ROOT}/.session`)]), { staged: STAGED });
  v[12] = verdictCompliance("A-dir", modelObs("A-dir", { delta: dirty, hello: { outcome: "ok", content: "N-1" } }));
  const r5 = rowOf(evaluateDecisionTable(v), "R5");
  assert.equal(r5.fired, true);
  assert.match(r5.because, /OPTION 2 REFUTED/);
});

test("R7–R10 are mutually exclusive and exactly one fires for each compliance outcome", () => {
  const cases = [
    [true, true, "R7"],
    [false, true, "R8"],
    [true, false, "R9"],
    [false, false, "R10"],
  ];
  for (const [dirW, cwdW, expected] of cases) {
    const rows = evaluateDecisionTable(baseline({ dirWrites: dirW, cwdWrites: cwdW }));
    const fired = ["R7", "R8", "R9", "R10"].filter((id) => rowOf(rows, id).fired === true);
    assert.deepEqual(fired, [expected], `A-dir=${dirW} A-cwd=${cwdW}`);
  }
});

test("R11 needs a correct declaration in the final frame", () => {
  assert.equal(rowOf(evaluateDecisionTable(baseline()), "R11").fired, true);
  assert.equal(rowOf(evaluateDecisionTable(baseline({ decl: `AOA-OUTPUT: ${OUTPUT_ROOT}/hello.txt` })), "R11").fired, false, "an absolute declaration never certifies option 1b");
  assert.equal(rowOf(evaluateDecisionTable(baseline({ decl: "no line" })), "R11").fired, false);
  assert.equal(rowOf(evaluateDecisionTable(baseline({ decl: "AOA-OUTPUT: elsewhere.txt" })), "R11").fired, false);
});

test("R12 fires on ANY inconclusive arm, and the rows that read it become undecidable, not false", () => {
  const v = baseline();
  v[11] = verdictANeg({ ...modelObs("A-neg"), keyPresent: false });
  const rows = evaluateDecisionTable(v);
  assert.equal(rowOf(rows, "R12").fired, true);
  assert.equal(rowOf(rows, "R5").fired, "undecidable");
  assert.equal(rowOf(rows, "R6").fired, "undecidable");
  assert.match(rowOf(rows, "R5").because, /A-neg=inconclusive/);
  assert.equal(rowOf(rows, "R1").fired, false, "rows that do not read A-neg still decide");
});

// ── controls and disposition ──────────────────────────────────────────────────

test("every control holds on the baseline, and the pack is measured", () => {
  const v = baseline();
  const c = evaluateControls(v);
  assert.deepEqual(c.map((x) => [x.id, x.held]), [["PC-1", true], ["PC-2", true], ["C-census", true]]);
  assert.equal(packDisposition(v, c).disposition, "measured");
});

test("POSITIVE CONTROL: a control that did not produce its expected negative reds the whole pack", () => {
  const v = baseline();
  // PC-1's plant was NOT seen: the S-P0 check cannot distinguish, so S-P0's own `absent` means nothing.
  v[1] = verdictRootPresence("S-PC1", { rootList: NF, rootRead: { outcome: "not-found" }, home: ok([]) });
  const c = evaluateControls(v);
  assert.equal(c.find((x) => x.id === "PC-1").held, false);
  assert.equal(packDisposition(v, c).disposition, "inconclusive");
  assert.equal(rowOf(evaluateDecisionTable(v), "R12").fired, true, "a failed control makes the run not a measurement");

  const w = baseline();
  w[3] = verdictStaged("S-PC2", { home: ok(STAGED.map((p) => file(p))), staged: STAGED, root: OUTPUT_ROOT });
  assert.equal(evaluateControls(w).find((x) => x.id === "PC-2").held, false);
});

test("shell-only mode: model arms not-run is expected; a missing shell arm is not", () => {
  const shell = baseline().filter((x) => SHELL_ARMS.includes(x.arm));
  const v = [...shell, notRun("C-census", "shell-only"), ...MODEL_ARMS.map((a) => notRun(a, "shell-only"))];
  const c = evaluateControls(v);
  assert.equal(packDisposition(v, c, "shell-only").disposition, "measured");
  assert.equal(packDisposition(v, c, "all").disposition, "inconclusive", "in `all` mode a not-run model arm is a failure");
  assert.equal(packDisposition(v.filter((x) => x.arm !== "S-P6"), c, "shell-only").disposition, "inconclusive");
  assert.equal(rowOf(evaluateDecisionTable(v, "shell-only"), "R7").fired, "undecidable");
  assert.equal(rowOf(evaluateDecisionTable(v, "shell-only"), "R12").fired, false, "shell-only with every shell arm observed is a measurement");
  assert.equal(rowOf(evaluateDecisionTable(v, "all"), "R12").fired, true);
});

test("buildProbeRecord refuses a record with no template or no table, and carries the table", () => {
  const v = baseline();
  const controls = evaluateControls(v);
  const decisionTable = evaluateDecisionTable(v);
  const args = { verdicts: v, controls, decisionTable, disposition: packDisposition(v, controls), template: "aoa-base", templateSource: "default-cli-bearing", armsMode: "all", commitSha: "x", runNonce: "n", generatedAt: "t", workflowRunUrl: "u" };
  const r = buildProbeRecord(args);
  assert.equal(r.schema, PROBE_RECORD_SCHEMA);
  assert.equal(r.decisionTable.length, 12);
  assert.throws(() => buildProbeRecord({ ...args, template: "" }), /no resolved template/);
  assert.throws(() => buildProbeRecord({ ...args, decisionTable: [] }), /no decision table/);
});

// ── the workflow, as committed ────────────────────────────────────────────────

test("the committed workflow satisfies every shape rule", () => {
  const { violations } = evaluateWorkflowShape(readFileSync(WORKFLOW, "utf8"));
  assert.deepEqual(violations, []);
});

test("readJobGates reads every job and its job-level if (anti-vacuity)", () => {
  const jobs = readJobGates(readFileSync(WORKFLOW, "utf8"));
  assert.ok(jobs.length >= 1);
  for (const j of jobs) assert.equal(j.ifExpr, "github.event_name == 'workflow_dispatch'", j.name);
  assert.deepEqual(readJobGates("jobs:\n  a:\n    if: ${{ github.event_name == 'workflow_dispatch' }}\n    steps:\n      - if: always()\n  b:\n    runs-on: x\n"), [
    { name: "a", ifExpr: "github.event_name == 'workflow_dispatch'" },
    { name: "b", ifExpr: null },
  ]);
});

test("POSITIVE CONTROL: each workflow mutation reds with its own code", () => {
  const good = readFileSync(WORKFLOW, "utf8");
  const codes = (t) => evaluateWorkflowShape(t).violations.map((x) => x.code);
  const mutate = (from, to) => {
    assert.ok(good.includes(from), `mutation anchor missing: ${from}`);
    return good.replace(from, to);
  };
  // ── E6-D001's registration shape: each deviation reds with its own code ──
  const PATHS_LINE = '    paths: [".github/workflows/keyed-e2b-cli-011-output-probe.yml"]\n';
  const BRANCH_LINE = "    branches: [docs/replatform-program]\n";
  // push without the paths restriction
  assert.ok(codes(mutate(PATHS_LINE, "")).includes("push-without-paths"));
  // extra paths
  assert.ok(codes(mutate(PATHS_LINE, '    paths: [".github/workflows/keyed-e2b-cli-011-output-probe.yml", "packages/sandbox-e2b-provider/src/**"]\n')).includes("push-extra-paths"));
  // §10.2's trigger-file route instead of the workflow's own path
  assert.ok(codes(mutate(PATHS_LINE, '    paths: [".github/keyed-e2b-cli-011-output-probe-trigger"]\n')).includes("push-extra-paths"));
  // another branch
  assert.ok(codes(mutate(BRANCH_LINE, "    branches: [docs/replatform-program, main]\n")).includes("push-branch"));
  // another push filter
  assert.ok(codes(mutate(BRANCH_LINE, BRANCH_LINE + '    paths-ignore: ["docs/**"]\n')).includes("push-other-filter"));
  // no registration push at all
  assert.ok(codes(mutate("  push:\n" + BRANCH_LINE + PATHS_LINE, "")).includes("registration-push-missing"));
  // a job without the dispatch-only gate, or with a weaker one
  assert.ok(codes(mutate("    if: github.event_name == 'workflow_dispatch'\n", "")).includes("job-not-dispatch-gated"));
  assert.ok(codes(mutate("    if: github.event_name == 'workflow_dispatch'\n", "    if: always()\n")).includes("job-not-dispatch-gated"));
  // a SECOND job without the gate
  assert.ok(codes(`${good}\n  extra:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n`).includes("job-not-dispatch-gated"));
  // any other trigger
  for (const trig of ["pull_request:", "schedule:\n    - cron: '0 0 * * *'", "workflow_call:", "merge_group:", "workflow_run:\n    workflows: [PR]"]) {
    assert.ok(codes(mutate("\npermissions:", `  ${trig}\n\npermissions:`)).includes("non-dispatch-trigger"), trig);
  }
  assert.ok(codes(`${good}\n# secrets.OPENAI_API_KEY\n`.replace("# secrets.OPENAI_API_KEY", "      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}")).includes("secret-not-allowed"));
  assert.ok(codes(`${good}\n      - run: echo "\${{ secrets.E2B_API_KEY }}"\n`).includes("secret-interpolated"));
  assert.ok(codes(mutate("retention-days: 90", "retention-days: 1")).includes("record-retention"));
  assert.ok(codes(mutate('"resolved": ${TEMPLATE_JSON}', '"resolved": "${RESOLVED_TEMPLATE}"')).includes("fallback-unescaped-input"));
  assert.ok(codes(mutate('"armsMode": ${ARMS_JSON}', '"armsMode": "${ARMS_INPUT:-all}"')).includes("fallback-unescaped-input"));
  assert.ok(codes(good.replace(/name: cli-011-output-probe-record/, "name: something-else")).includes("record-upload-missing"));
  assert.ok(codes(mutate("timeout-minutes: 45", "timeout-minutes: 90")).includes("job-timeout"));
  assert.ok(codes(good.replace(/CLI011_DEFAULT_TEMPLATE: aoa-base/, "CLI011_DEFAULT_TEMPLATE: base")).includes("default-template-mismatch"));
  assert.ok(codes(good.replaceAll(PROBE_RECORD_SCHEMA, "aoa.cli-011.output-probe-record/0")).includes("fallback-schema-mismatch"));
  assert.ok(codes(good.replace(/exit 1/g, "exit 0")).includes("skip-guard-missing"));
});

// ── the keyed test, as committed: it runs the SHIPPED literal and always tears down ──

test("the keyed test imports buildSandboxInvocation (no pasted literal) and terminates every sandbox in finally", () => {
  const src = readFileSync(KEYED_TEST, "utf8");
  assert.match(src, /from "\.\.\/\.\.\/\.\.\/\.\.\/server\/src\/services\/task-run-sandbox-invocation\.js"/);
  assert.match(src, /buildSandboxInvocation\(/);
  assert.equal(src.includes('exec "$0" --print - --dangerously-skip-permissions'), false, "no claude literal is pasted into the probe");
  assert.match(src, /finally\s*\{[^}]*terminate\(/);
  assert.match(src, /from "\.\.\/\.\.\/\.\.\/\.\.\/scripts\/lib\/cli-011-output-probe\.mjs"/);
});
