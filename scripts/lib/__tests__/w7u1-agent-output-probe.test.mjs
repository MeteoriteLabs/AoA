// scripts/lib/__tests__/w7u1-agent-output-probe.test.mjs
//
// The no-key half of W7U1's probe pack. Every decision the keyed lane makes with the
// founder's ONE authorised run is decided here, without a key, in the required `policy`
// job — so the keyed run is not the first exercise of the code that reads it.
//
// ★ THE REAL SCRIPT LITERALS, NOT COPIES. The A2 anchor cases below run against the
// script `buildSandboxInvocation` ACTUALLY emits, imported from the production module.
// A pasted copy would be a test of the copy — the precise mistake
// `keyed-cli-008-unit-d-invocation.test.ts` was written to stop making. This file is
// `.mjs` and the module is `.ts`, so the four literals are reproduced HERE ONLY as
// inputs whose fidelity is itself asserted: `production script literals still match`
// reads `task-run-sandbox-invocation.ts` off disk and refuses if either anchor has
// moved. That is the same guarantee by a different route, and it fails LOUDLY.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  MIN_REDACTABLE_SECRET_LENGTH,
  PERMISSION_POSTURES,
  PermissionPostureAnchorError,
  REDACTION_MARKER,
  classifyProbeAArm,
  countOccurrences,
  isListingUsable,
  packDisposition,
  redactSecrets,
  verdictProbeA,
  verdictProbeB,
  verdictProbeC,
  withPermissionPosture,
} from "../w7u1-agent-output-probe.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..");
const INVOCATION_MODULE = path.join(
  REPO_ROOT,
  "server",
  "src",
  "services",
  "task-run-sandbox-invocation.ts",
);

// The four shapes, exactly as `buildSandboxInvocation` emits them (guard prefix elided;
// the anchors live in the tail). Their fidelity is asserted by the first test.
const CLAUDE_WITH_BUNDLE =
  'exec "$0" --print - --output-format stream-json --verbose --append-system-prompt-file "$2" < "$1"';
const CLAUDE_NO_BUNDLE = 'exec "$0" --print - --output-format stream-json --verbose < "$1"';
const CODEX_WITH_BUNDLE = '{ cat "$2"; echo; cat "$1"; } | "$0" exec --json -';
const CODEX_NO_BUNDLE = 'exec "$0" exec --json - < "$1"';

// ─────────────────────────────────────────────────────────────────────────────
// The premise, and the anchors A2 rewrites
// ─────────────────────────────────────────────────────────────────────────────

test("W7U1's premise holds: NONE of the four production script literals carries a permission posture", () => {
  const source = readFileSync(INVOCATION_MODULE, "utf8");
  // The switch body is where the four literals live; the file's prose header discusses
  // the legacy adapters, so scope the search to the emitter.
  const start = source.indexOf('case "claude_local":');
  const end = source.indexOf("return {", start);
  assert.ok(start > 0 && end > start, "could not locate the adapter switch in the production module");
  const emitter = source.slice(start, end);

  for (const flag of [
    "--dangerously-skip-permissions",
    "--dangerously-bypass-approvals-and-sandbox",
    "--allowedTools",
    "--settings",
  ]) {
    assert.ok(
      !emitter.includes(flag),
      `PREMISE REFUTED: the production emitter now contains ${flag}. W7U1 was chartered on its absence — ` +
        "report the refutation; do not keep probing a question the source has answered.",
    );
  }
});

test("production script literals still match the shapes this file feeds the A2 transform", () => {
  const source = readFileSync(INVOCATION_MODULE, "utf8");
  for (const [name, literal] of [
    ["claude with bundle", CLAUDE_WITH_BUNDLE],
    ["claude no bundle", CLAUDE_NO_BUNDLE],
    ["codex with bundle", CODEX_WITH_BUNDLE],
    ["codex no bundle", CODEX_NO_BUNDLE],
  ]) {
    assert.ok(
      source.includes(literal),
      `${name}: the production module no longer emits ${JSON.stringify(literal)}. The A2 transform's inputs are ` +
        "stale; re-derive them from task-run-sandbox-invocation.ts before running the keyed lane.",
    );
  }
});

test("A2 inserts claude's posture exactly once, in the legacy adapter's position", () => {
  const out = withPermissionPosture(CLAUDE_WITH_BUNDLE, "claude_local");
  assert.equal(countOccurrences(out, "--dangerously-skip-permissions"), 1);
  assert.ok(out.includes("--verbose --dangerously-skip-permissions --append-system-prompt-file"));
  // Nothing else moved: the stdin redirect and the bundle flag survive.
  assert.ok(out.endsWith('--append-system-prompt-file "$2" < "$1"'));
  assert.notEqual(out, CLAUDE_WITH_BUNDLE);

  const bare = withPermissionPosture(CLAUDE_NO_BUNDLE, "claude_local");
  assert.ok(bare.includes('--verbose --dangerously-skip-permissions < "$1"'));
});

test("A2 inserts codex's posture between `exec --json` and the `-` positional, both shapes", () => {
  const piped = withPermissionPosture(CODEX_WITH_BUNDLE, "codex_local");
  assert.ok(piped.endsWith('| "$0" exec --json --dangerously-bypass-approvals-and-sandbox -'));
  const redirected = withPermissionPosture(CODEX_NO_BUNDLE, "codex_local");
  assert.ok(redirected.includes('exec --json --dangerously-bypass-approvals-and-sandbox - < "$1"'));
});

// ★★★ THE ANTI-VACUITY GUARD. If the anchor ever stops matching, a permissive transform
// would return the script unchanged and A2 would become A1 — the differential comparing
// a thing with itself while the log still said "posture applied". Every way of failing
// to apply the flag must THROW.
test("A2 REFUSES rather than silently returning an unchanged script", () => {
  assert.throws(
    () => withPermissionPosture('exec "$0" --print - --output-format json < "$1"', "claude_local"),
    PermissionPostureAnchorError,
    "a moved claude anchor must refuse, not no-op",
  );
  assert.throws(
    () => withPermissionPosture('exec "$0" exec --jsonl - < "$1"', "codex_local"),
    PermissionPostureAnchorError,
    "a moved codex anchor must refuse, not no-op",
  );
  assert.throws(
    () => withPermissionPosture(CLAUDE_WITH_BUNDLE, "gemini_local"),
    PermissionPostureAnchorError,
    "an adapter with no defined posture must refuse",
  );
  // Two anchors: we cannot say where the flag would land.
  assert.throws(
    () => withPermissionPosture(`${CODEX_NO_BUNDLE} ; ${CODEX_NO_BUNDLE}`, "codex_local"),
    PermissionPostureAnchorError,
    "an ambiguous anchor must refuse",
  );
  // And the premise-collapse case: the flag is already there.
  assert.throws(
    () => withPermissionPosture(withPermissionPosture(CLAUDE_NO_BUNDLE, "claude_local"), "claude_local"),
    PermissionPostureAnchorError,
    "an already-postured script must refuse — the premise has collapsed and that is the finding",
  );
});

test("every declared posture's replacement genuinely contains its flag", () => {
  for (const [adapter, posture] of Object.entries(PERMISSION_POSTURES)) {
    assert.ok(
      posture.replacement.includes(posture.flag),
      `${adapter}: the replacement does not contain the flag it claims to add`,
    );
    assert.ok(
      posture.replacement.includes(posture.anchor.replace(/ -$/, "")) || posture.replacement !== posture.anchor,
      `${adapter}: the replacement is identical to the anchor`,
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Redaction
// ─────────────────────────────────────────────────────────────────────────────

test("redactSecrets removes every occurrence of a real-length secret", () => {
  const key = "sk-ant-EXAMPLEEXAMPLEEXAMPLE";
  const text = `error: bad key ${key}\nretry with ${key}`;
  const out = redactSecrets(text, [key, undefined, 42]);
  assert.ok(!out.includes(key), "the secret survived redaction");
  assert.equal(countOccurrences(out, REDACTION_MARKER), 2);
});

test("redactSecrets ignores values too short to be a credential", () => {
  const short = "a".repeat(MIN_REDACTABLE_SECRET_LENGTH - 1);
  const out = redactSecrets(`${short} is ordinary prose`, [short]);
  assert.ok(out.startsWith(short), "a short value must not eat the log");
});

// ─────────────────────────────────────────────────────────────────────────────
// Arm classification — "no file" / "hung" / "exited 127" are three answers
// ─────────────────────────────────────────────────────────────────────────────

const NONCE = "AOA-W7U1-NONCE-0001";
const arm = (over) => ({
  label: "A1",
  nonce: NONCE,
  targetPreExisted: false,
  execution: { channel: "returned", exitCode: 0 },
  // `errorKind: "not-found"` is the DEFAULT because that is what an ordinary absent file
  // looks like coming out of `readBack`: the transport raised `E2bTransportNotFoundError`
  // and the read was sound. A `faulted` kind is the exceptional case, and the tests below
  // pin that it can never produce a negative.
  file: { found: false, content: null, errorKind: "not-found", detail: "" },
  ...over,
});

test("an arm whose file carries the nonce WROTE", () => {
  const c = classifyProbeAArm(arm({ file: { found: true, content: `hello ${NONCE}\n` } }));
  assert.equal(c.state, "wrote");
});

test("an arm whose file exists WITHOUT the nonce is indeterminate, not a success", () => {
  const c = classifyProbeAArm(arm({ file: { found: true, content: "something else entirely" } }));
  assert.equal(c.state, "indeterminate");
  assert.equal(c.cause, "file-present-without-the-nonce");
});

test("a pre-existing target path makes the arm indeterminate before anything else is read", () => {
  const c = classifyProbeAArm(arm({ targetPreExisted: true, file: { found: true, content: NONCE } }));
  assert.equal(c.state, "indeterminate");
  assert.equal(c.cause, "target-path-already-existed");
});

test("exit 127 is indeterminate (the experiment did not happen), NOT a negative result", () => {
  const c = classifyProbeAArm(arm({ execution: { channel: "returned", exitCode: 127 } }));
  assert.equal(c.state, "indeterminate");
  assert.equal(c.cause, "binary-not-runnable");
});

test("a sandbox FAULT is indeterminate, not a negative — a throw must not become a capability answer", () => {
  const c = classifyProbeAArm(arm({ execution: { channel: "threw", exitCode: null, detail: "SandboxError: 502" } }));
  assert.equal(c.state, "indeterminate");
  assert.equal(c.cause, "arm-faulted");
});

test("a stall and a clean non-zero exit are BOTH negatives, and they are distinguishable", () => {
  const stalled = classifyProbeAArm(arm({ execution: { channel: "timedOut", exitCode: null } }));
  const exited = classifyProbeAArm(arm({ execution: { channel: "returned", exitCode: 1 } }));
  assert.equal(stalled.state, "did-not-write");
  assert.equal(exited.state, "did-not-write");
  assert.equal(stalled.cause, "stalled");
  assert.equal(exited.cause, "exited-1");
  assert.notEqual(stalled.cause, exited.cause, "a hang and an exit must not collapse into one answer");
});

// ─────────────────────────────────────────────────────────────────────────────
// The READ channel — an apparatus fault must never become a capability answer
//
// ★★★ THE DEFECT THIS PINS. `readBack` used to catch EVERY error and answer
// `found:false`, so a transport read fault was byte-identical to "the agent wrote
// nothing". A reviewer reproduced it: a read fault printed as
// `NO — a1-did-not-write-and-the-posture-is-the-cause`, disposition `measured`.
//
// ★★ THE EXEC-SIDE CONTROLS DO NOT COVER IT. A0's success is temporally PRIOR to A1's
// readback, not concurrent with it, so a fault that first appears during A1's read is
// outside A0's scope. The read needed its own channel, and this is where it is proven.
// ─────────────────────────────────────────────────────────────────────────────

test("a FAULTED read is indeterminate — a broken read must never become 'the agent did not write'", () => {
  const c = classifyProbeAArm(
    arm({ file: { found: false, content: null, errorKind: "faulted", detail: "Error: ECONNRESET" } }),
  );
  assert.equal(
    c.state,
    "indeterminate",
    "a read that FAILED establishes nothing about the file; reporting it as a negative is an apparatus " +
      "failure printed as a capability answer",
  );
  assert.equal(c.cause, "read-faulted");
  assert.ok(c.detail.includes("ECONNRESET"), "the fault's own detail must survive into the verdict");
});

test("a faulted read on A1 makes PROBE A inconclusive, and the pack RED", () => {
  const v = verdictProbeA({
    a0: wrote("A0"),
    a1: classifyProbeAArm(arm({ file: { found: false, content: null, errorKind: "faulted", detail: "socket hang up" } })),
    a2: wrote("A2"),
    a3: didNot("A3", "exited-0"),
  });
  assert.equal(v.state, "inconclusive");
  assert.equal(
    v.reason,
    "a1-read-faulted",
    "the faulted read must reach the operator as its OWN reason, not as a posture conviction",
  );
  const d = packDisposition([v]);
  assert.equal(d.exitCode, 1);
  assert.equal(d.disposition, "inconclusive");
});

// ★ THE POSITIVE CONTROL FOR THE ABOVE. If BOTH this and the two tests above go red under
// the same edit, the fix has made every negative inconclusive — which destroys the whole
// point of a pack chartered to be able to answer NO.
test("a genuine NOT-FOUND read still yields a clean NO, and the pack stays MEASURED", () => {
  const a1 = classifyProbeAArm(arm({ execution: { channel: "timedOut", exitCode: null } }));
  assert.equal(a1.state, "did-not-write");
  const v = verdictProbeA({ a0: wrote("A0"), a1, a2: wrote("A2"), a3: didNot("A3", "exited-0") });
  assert.equal(v.state, "no");
  assert.equal(v.reason, "a1-did-not-write-and-the-posture-is-the-cause");
  const d = packDisposition([v]);
  assert.equal(d.exitCode, 0);
  assert.equal(d.disposition, "measured");
});

test("probe B refuses the NO when a candidate's read FAULTED — an unread path is not an absent path", () => {
  const v = verdictProbeB({
    listingOk: true,
    entries: [".bashrc"],
    candidates: [
      { path: "/home/user/.aoa-run-output.jsonl", exists: false, bytes: 0, errorKind: "not-found", detail: "" },
      { path: "/home/user/output.txt", exists: false, bytes: 0, errorKind: "faulted", detail: "Error: 502" },
    ],
  });
  assert.equal(v.state, "inconclusive");
  assert.equal(v.reason, "candidate-read-faulted");
  assert.ok(v.detail.includes("/home/user/output.txt"));
});

// ★ THE POSITIVE CONTROL FOR THE ABOVE, again in the same run.
test("probe B's NO survives when every candidate was genuinely NOT FOUND", () => {
  const v = verdictProbeB({
    listingOk: true,
    entries: [".bashrc"],
    candidates: [
      { path: "/home/user/.aoa-run-output.jsonl", exists: false, bytes: 0, errorKind: "not-found", detail: "" },
    ],
  });
  assert.equal(v.state, "no");
  assert.equal(v.reason, "template-prefills-nothing");
});

// ★★ AND THE YES IS DELIBERATELY NOT GATED. An OBSERVED prefill is a positive that an
// unread neighbour cannot unmake, and `inconclusive` means "run me again" — a confirmed
// prefill is not made truer by a second run. It is the NO, which asserts something about
// paths we did not see, that an unread path invalidates.
test("probe B still says YES when a path was READ and found to exist, even beside a faulted read", () => {
  const v = verdictProbeB({
    listingOk: true,
    entries: [".aoa-run-output.jsonl"],
    candidates: [
      { path: "/home/user/.aoa-run-output.jsonl", exists: true, bytes: 12, errorKind: null, detail: "" },
      { path: "/home/user/output.txt", exists: false, bytes: 0, errorKind: "faulted", detail: "Error: 502" },
    ],
  });
  assert.equal(v.state, "yes");
  assert.equal(v.reason, "template-prefills-a-candidate-output-path");
});

test("ONLY a `returned` listing is evidence — a listing that TIMED OUT is not an empty directory", () => {
  assert.equal(isListingUsable("returned"), true);
  for (const channel of ["timedOut", "threw", "not-run", "binary-missing"]) {
    assert.equal(isListingUsable(channel), false, `a ${channel} listing must not count as a look at the directory`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Probe A's verdict — the controls gate the measurement
// ─────────────────────────────────────────────────────────────────────────────

const wrote = (label) => ({ label, state: "wrote", cause: "nonce-present", detail: "" });
const didNot = (label, cause) => ({ label, state: "did-not-write", cause, detail: "" });
const indet = (label, cause) => ({ label, state: "indeterminate", cause, detail: "" });

test("a failed HARNESS control makes probe A inconclusive whatever A1 did", () => {
  const v = verdictProbeA({ a0: didNot("A0", "exited-1"), a1: didNot("A1", "stalled"), a2: wrote("A2"), a3: didNot("A3", "exited-0") });
  assert.equal(v.state, "inconclusive");
  assert.equal(v.reason, "harness-control-failed");
});

test("a violated NEGATIVE control makes probe A inconclusive even when A1 wrote", () => {
  const v = verdictProbeA({ a0: wrote("A0"), a1: wrote("A1"), a2: wrote("A2"), a3: wrote("A3") });
  assert.equal(v.state, "inconclusive");
  assert.equal(v.reason, "negative-control-violated");
});

test("A1 writing under the production argv is a YES", () => {
  const v = verdictProbeA({ a0: wrote("A0"), a1: wrote("A1"), a2: wrote("A2"), a3: didNot("A3", "exited-0") });
  assert.equal(v.state, "yes");
});

test("A1 silent + A2 writing is a NO that CONVICTS the missing permission posture", () => {
  const v = verdictProbeA({ a0: wrote("A0"), a1: didNot("A1", "stalled"), a2: wrote("A2"), a3: didNot("A3", "exited-0") });
  assert.equal(v.state, "no");
  assert.equal(v.reason, "a1-did-not-write-and-the-posture-is-the-cause");
});

test("A1 and A2 both silent is a NO that EXONERATES the posture", () => {
  const v = verdictProbeA({
    a0: wrote("A0"),
    a1: didNot("A1", "exited-1"),
    a2: didNot("A2", "exited-1"),
    a3: didNot("A3", "exited-0"),
  });
  assert.equal(v.state, "no");
  assert.equal(v.reason, "a1-did-not-write-and-the-posture-is-not-the-cause");
});

test("A1 silent + A2 unreadable is still a NO, but the cause is explicitly unattributed", () => {
  const v = verdictProbeA({
    a0: wrote("A0"),
    a1: didNot("A1", "stalled"),
    a2: indet("A2", "binary-not-runnable"),
    a3: didNot("A3", "exited-0"),
  });
  assert.equal(v.state, "no");
  assert.equal(v.reason, "a1-did-not-write-cause-unattributed");
});

test("an unreadable A1 is inconclusive, never a NO", () => {
  const v = verdictProbeA({
    a0: wrote("A0"),
    a1: indet("A1", "binary-not-runnable"),
    a2: wrote("A2"),
    a3: didNot("A3", "exited-0"),
  });
  assert.equal(v.state, "inconclusive");
  assert.equal(v.reason, "a1-binary-not-runnable");
});

// ─────────────────────────────────────────────────────────────────────────────
// Probes B and C
// ─────────────────────────────────────────────────────────────────────────────

test("probe B says YES when the template pre-fills a candidate output path", () => {
  const v = verdictProbeB({
    listingOk: true,
    entries: [".aoa-run-output.jsonl"],
    candidates: [{ path: "/home/user/.aoa-run-output.jsonl", exists: true, bytes: 12 }],
  });
  assert.equal(v.state, "yes");
  assert.ok(v.detail.includes("/home/user/.aoa-run-output.jsonl"));
});

test("probe B says NO — and still reports the listing — when nothing is pre-filled", () => {
  const v = verdictProbeB({
    listingOk: true,
    entries: [".bashrc", "aoa-workspace"],
    candidates: [{ path: "/home/user/.aoa-run-output.jsonl", exists: false, bytes: 0 }],
  });
  assert.equal(v.state, "no");
  assert.ok(v.detail.includes(".bashrc"), "the enumeration must survive into the negative result");
});

test("probe B refuses a verdict when the enumeration itself failed", () => {
  assert.equal(verdictProbeB({ listingOk: false, detail: "connect failed" }).state, "inconclusive");
});

test("probe C says YES only when BOTH markers arrive and the command exits 0", () => {
  const base = { ran: true, exitCode: 0, stdoutMarker: "OUT", stderrMarker: "ERR" };
  assert.equal(verdictProbeC({ ...base, stdout: "OUT\n", stderr: "ERR\n" }).state, "yes");
  assert.equal(verdictProbeC({ ...base, stdout: "", stderr: "ERR\n" }).state, "no");
  assert.equal(verdictProbeC({ ...base, stdout: "OUT\n", stderr: "" }).state, "no");
  assert.equal(verdictProbeC({ ...base, exitCode: 1, stdout: "OUT\n", stderr: "ERR\n" }).state, "no");
  assert.equal(verdictProbeC({ ran: false, detail: "threw" }).state, "inconclusive");
});

// ─────────────────────────────────────────────────────────────────────────────
// The lane's disposition — a NO stays green
// ─────────────────────────────────────────────────────────────────────────────

test("a pack in which every probe answered NO is a MEASURED run and exits 0", () => {
  const d = packDisposition([
    { probe: "A", state: "no", reason: "r", detail: "" },
    { probe: "B", state: "no", reason: "r", detail: "" },
    { probe: "C", state: "yes", reason: "r", detail: "" },
  ]);
  assert.equal(d.exitCode, 0);
  assert.equal(d.disposition, "measured");
});

test("ONE inconclusive probe reds the lane", () => {
  const d = packDisposition([
    { probe: "A", state: "yes", reason: "r", detail: "" },
    { probe: "B", state: "inconclusive", reason: "enumeration-failed", detail: "" },
  ]);
  assert.equal(d.exitCode, 1);
  assert.ok(d.detail.includes("B (enumeration-failed)"));
});

test("a pack with NO verdicts at all is inconclusive, never a silent pass", () => {
  assert.equal(packDisposition([]).exitCode, 1);
  assert.equal(packDisposition(undefined).exitCode, 1);
});
