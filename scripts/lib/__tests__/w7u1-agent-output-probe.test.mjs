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
  BARE_BASE_TEMPLATE_ALIAS,
  CLI_BEARING_TEMPLATE_ALIAS,
  MIN_REDACTABLE_SECRET_LENGTH,
  PERMISSION_POSTURES,
  PROBE_RECORD_SCHEMA,
  PermissionPostureAnchorError,
  ProbeRecordError,
  REDACTION_MARKER,
  buildProbeRecord,
  classifyProbeAArm,
  countOccurrences,
  detectStartupEvidence,
  evaluateDurableRecord,
  evaluateTemplateCliPreflight,
  isListingUsable,
  packDisposition,
  redactSecrets,
  resolveTemplate,
  TEMPLATE_CLI_BINARIES,
  TEMPLATE_CLI_PROBE_SCRIPT,
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
const PROBE_WORKFLOW = path.join(REPO_ROOT, ".github", "workflows", "keyed-e2b-w7u1-output-probe.yml");
const E2B_DOCKERFILE = path.join(REPO_ROOT, "e2b", "e2b.Dockerfile");

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

test("a stall and a non-zero exit THAT PRODUCED OUTPUT are BOTH negatives, and they are distinguishable", () => {
  const stalled = classifyProbeAArm(arm({ execution: { channel: "timedOut", exitCode: null } }));
  // ★ `exited` now has to have SAID something. A non-zero exit with empty stdout is the
  // refusal shape and is `indeterminate` — see the E7-F028 block below. A CLI that streamed
  // its head event and then exited 1 did reach the work and is still a genuine negative.
  const exited = classifyProbeAArm(
    arm({
      adapterType: "codex_local",
      execution: {
        channel: "returned",
        exitCode: 1,
        stdout: '{"type":"thread.started","thread_id":"t-1"}\n{"type":"turn.started"}\n',
      },
    }),
  );
  assert.equal(stalled.state, "did-not-write");
  assert.equal(exited.state, "did-not-write");
  assert.equal(stalled.cause, "stalled");
  assert.equal(exited.cause, "exited-1");
  assert.notEqual(stalled.cause, exited.cause, "a hang and an exit must not collapse into one answer");
});

// ─────────────────────────────────────────────────────────────────────────────
// E7-F028 — A REFUSAL IS NOT A RESULT
//
// ★★★ THE DEFECT THIS PINS, MEASURED. Run 34087197668's codex A1 ran the exact production
// `:204` literal, exited 1, and wrote NOTHING to stdout — its stderr said
// "Not inside a trusted directory and --skip-git-repo-check was not specified." The
// classifier's catch-all mapped that to `did-not-write`, `verdictProbeA` read two such arms
// and announced `a1-did-not-write-and-the-posture-is-not-the-cause`, and the LANE STAYED
// GREEN: a fourth-state situation folded into `no`, which is a RESULT, so nothing asked
// anyone to look. Meanwhile A2 — with the posture — got PAST that refusal
// (`{"type":"thread.started"}`), i.e. the posture REMOVED A1's actual blocker, the exact
// opposite of "exonerated".
// ─────────────────────────────────────────────────────────────────────────────

test("a non-zero exit with EMPTY stdout is INDETERMINATE — a refusal must never book as a result", () => {
  const c = classifyProbeAArm(
    arm({ adapterType: "codex_local", execution: { channel: "returned", exitCode: 1, stdout: "" } }),
  );
  assert.equal(c.state, "indeterminate", "a CLI that produced no bytes before exiting non-zero measured nothing");
  assert.equal(c.cause, "cli-refused-at-startup");
  assert.equal(c.ran, false);
});

test("the codex A1 arm of run 34087197668, replayed, is indeterminate rather than a negative", () => {
  const c = classifyProbeAArm({
    label: "A1",
    nonce: NONCE,
    adapterType: "codex_local",
    targetPreExisted: false,
    // Verbatim from the run's own step log: `exit=1 … stdout="" stderr="Not inside a
    // trusted directory and --skip-git-repo-check was not specified.\n"`.
    execution: {
      channel: "returned",
      exitCode: 1,
      stdout: "",
      stderr: "Not inside a trusted directory and --skip-git-repo-check was not specified.\n",
    },
    file: { found: false, content: null, errorKind: "not-found", detail: "" },
  });
  assert.equal(c.state, "indeterminate");
  assert.equal(c.cause, "cli-refused-at-startup");
});

test("exit 0 with empty stdout is STILL a negative — the new branch keys off the NON-ZERO exit", () => {
  // POSITIVE CONTROL for the branch above: it must not swallow the ordinary silent-exit
  // negative, which is the shape claude A1 produced in the same run.
  const c = classifyProbeAArm(arm({ adapterType: "claude_local", execution: { channel: "returned", exitCode: 0, stdout: "" } }));
  assert.equal(c.state, "did-not-write");
  assert.equal(c.cause, "exited-0");
});

test("the startup head event is detected per CLI, from the shapes the ADAPTERS parse", () => {
  // claude — `parse.ts:19`: type "system" AND subtype "init", on ONE line.
  const claude = detectStartupEvidence(
    '{"type":"system","subtype":"init","cwd":"/home/user","session_id":"de6ba132"}\n{"type":"assistant"}\n',
    "claude_local",
  );
  assert.equal(claude.ran, true);
  // codex — `parse.ts:64`/`:136`: type "thread.started".
  const codex = detectStartupEvidence('{"type":"thread.started","thread_id":"01a07a5b"}\n', "codex_local");
  assert.equal(codex.ran, true);
  // ★ A `system` EVENT THAT IS NOT `init` IS NOT A START. Matching `"type":"system"` alone
  // would call the CLI started on an event that says nothing of the kind.
  assert.equal(detectStartupEvidence('{"type":"system","subtype":"compact_boundary"}\n', "claude_local").ran, false);
  // ★ AND THE PAIR MUST BE ON ONE LINE — two unrelated events must not combine.
  assert.equal(detectStartupEvidence('{"type":"system"}\n{"subtype":"init"}\n', "claude_local").ran, false);
  // Cross-CLI: codex's head event is not claude's, and vice versa.
  assert.equal(detectStartupEvidence('{"type":"thread.started"}', "claude_local").ran, false);
  assert.equal(detectStartupEvidence('{"type":"system","subtype":"init"}', "codex_local").ran, false);
  // Empty, and an adapter nobody declared: both FAIL CLOSED.
  assert.equal(detectStartupEvidence("", "codex_local").ran, false);
  assert.equal(detectStartupEvidence('{"type":"thread.started"}', "gemini_local").ran, false);
});

test("the declared startup shapes are the ones the shipped adapters actually parse", () => {
  // ★ READ OFF DISK, not asserted from memory: if an adapter's head event is renamed, this
  // pack's "demonstrably ran" evidence would silently stop matching and every exoneration
  // would turn inconclusive with no explanation. Fail loudly instead.
  const claudeParse = readFileSync(
    path.join(REPO_ROOT, "packages", "adapters", "claude-local", "src", "server", "parse.ts"),
    "utf8",
  );
  assert.match(claudeParse, /type === "system" && asString\(event\.subtype, ""\) === "init"/);
  const codexParse = readFileSync(
    path.join(REPO_ROOT, "packages", "adapters", "codex-local", "src", "server", "parse.ts"),
    "utf8",
  );
  assert.match(codexParse, /type === "thread\.started"/);
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

// ★ `ran` IS PART OF AN ARM NOW, and the defaults encode the fail-closed rule: an arm that
// WROTE obviously ran, and an arm that produced nothing is NOT SHOWN to have run unless a
// case says so explicitly. Anything reading these fixtures as "ran unless stated" would
// re-open E7-F028 in the test suite itself.
const ranDetail = (ran) => (ran ? "the CLI's head event was present on this arm's stdout" : "no head event was seen");
const wrote = (label, ran = true) => ({
  label,
  state: "wrote",
  cause: "nonce-present",
  detail: "",
  ran,
  runEvidenceDetail: ranDetail(ran),
});
const didNot = (label, cause, ran = false) => ({
  label,
  state: "did-not-write",
  cause,
  detail: "",
  ran,
  runEvidenceDetail: ranDetail(ran),
});
const indet = (label, cause, ran = false) => ({
  label,
  state: "indeterminate",
  cause,
  detail: "",
  ran,
  runEvidenceDetail: ranDetail(ran),
});

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
  const v = verdictProbeA({ a0: wrote("A0"), a1: wrote("A1"), a2: wrote("A2"), a3: didNot("A3", "exited-0", true) });
  assert.equal(v.state, "yes");
  // ★ NAMED POSITIVE CONTROL: a genuine write still answers YES, and the lane stays green.
  assert.equal(packDisposition([v]).disposition, "measured");
});

test("A1 silent + A2 writing is a NO that CONVICTS the missing permission posture", () => {
  const v = verdictProbeA({ a0: wrote("A0"), a1: didNot("A1", "stalled"), a2: wrote("A2"), a3: didNot("A3", "exited-0") });
  assert.equal(v.state, "no");
  assert.equal(v.reason, "a1-did-not-write-and-the-posture-is-the-cause");
});

test("A1 and A2 both silent is a NO that EXONERATES the posture — ONLY when an arm demonstrably RAN", () => {
  const v = verdictProbeA({
    a0: wrote("A0"),
    // Both arms streamed their CLI's head event and then exited without writing. That is
    // an agent that ran and did not write — a genuine negative, and a real exoneration.
    a1: didNot("A1", "exited-1", true),
    a2: didNot("A2", "exited-1", true),
    a3: didNot("A3", "exited-0", true),
  });
  assert.equal(v.state, "no");
  assert.equal(v.reason, "a1-did-not-write-and-the-posture-is-not-the-cause");
  // ★ NAMED POSITIVE CONTROL. A genuine did-not-write must still produce a CLEAN NO and a
  // `measured` disposition. If a repair to the classifier or the verdict reds this, the
  // pack has been made unable to answer, which destroys its purpose.
  assert.equal(packDisposition([v]).disposition, "measured");
});

// ─────────────────────────────────────────────────────────────────────────────
// E7-F028, second half — AN EXONERATION NEEDS POSITIVE EVIDENCE THAT SOMETHING RAN
//
// ★★★ This is the only verdict in the pack that asserts a NEGATIVE about a CAUSE. Two
// silences are consistent with an agent that never started, in which case the posture was
// never tested at all — so "the posture is not the cause" is unsupported. Concluding it
// from two refusals is the same error class as concluding a control is enforced because
// `getInfo()` echoed the policy back.
// ─────────────────────────────────────────────────────────────────────────────

test("two arms that cannot be shown to have RUN yield INCONCLUSIVE, never an exoneration", () => {
  const v = verdictProbeA({
    a0: wrote("A0"),
    // Both stalled: no terminal, no stdout, nothing showing either arm ever started.
    a1: didNot("A1", "stalled", false),
    a2: didNot("A2", "stalled", false),
    a3: didNot("A3", "stalled", false),
  });
  assert.equal(v.state, "inconclusive", "an unrun pair may not exonerate the variable it never tested");
  assert.equal(v.reason, "posture-exoneration-unsupported-no-arm-demonstrably-ran");
  assert.notEqual(v.reason, "a1-did-not-write-and-the-posture-is-not-the-cause");
  assert.equal(packDisposition([v]).disposition, "inconclusive", "and it must RED the lane, not pass as a result");
});

test("ONE arm that demonstrably ran is enough — the gate is evidence, not unanimity", () => {
  const v = verdictProbeA({
    a0: wrote("A0"),
    a1: didNot("A1", "exited-1", false),
    a2: didNot("A2", "exited-1", true),
    a3: didNot("A3", "exited-0", true),
  });
  assert.equal(v.state, "no");
  assert.equal(v.reason, "a1-did-not-write-and-the-posture-is-not-the-cause");
});

test("the CONVICTION branch is NOT gated on startup evidence — a write IS the evidence", () => {
  // POSITIVE CONTROL: A2 wrote, so A2 self-evidently ran, and the differential holds even
  // if A1 never emitted a head event at all. A gate here would red the run that actually
  // answered the pack's question (claude, run 34087197668).
  const v = verdictProbeA({
    a0: wrote("A0"),
    a1: didNot("A1", "exited-0", false),
    a2: wrote("A2", true),
    a3: didNot("A3", "exited-0", true),
  });
  assert.equal(v.state, "no");
  assert.equal(v.reason, "a1-did-not-write-and-the-posture-is-the-cause");
  assert.equal(packDisposition([v]).disposition, "measured");
});

test("the codex half of run 34087197668, replayed END TO END, no longer exonerates the posture", () => {
  // Arms classified by the REAL classifier from the run's REAL captured stdout, then fed to
  // the REAL verdict function. A1 exited 1 saying nothing (the trusted-directory refusal);
  // A2 got past it and failed on 401.
  const codexArm = (label, stdout, exitCode) =>
    classifyProbeAArm({
      label,
      nonce: NONCE,
      adapterType: "codex_local",
      targetPreExisted: false,
      execution: { channel: "returned", exitCode, stdout },
      file: { found: false, content: null, errorKind: "not-found", detail: "" },
    });
  const a2Stdout =
    '{"type":"thread.started","thread_id":"01a07a5b-b6b9-7fe2-9729-999757da1442"}\n{"type":"turn.started"}\n' +
    '{"type":"error","message":"Reconnecting... 2/5 (unexpected status 401 Unauthorized)"}\n';
  const v = verdictProbeA({
    a0: wrote("A0"),
    a1: codexArm("A1", "", 1),
    a2: codexArm("A2", a2Stdout, 1),
    a3: codexArm("A3", a2Stdout, 1),
  });
  assert.equal(v.state, "inconclusive");
  // A1 is now `indeterminate / cli-refused-at-startup`, so the verdict stops at the A1 gate
  // — earlier and more honestly than the exoneration branch would have.
  assert.equal(v.reason, "a1-cli-refused-at-startup");
  assert.notEqual(v.reason, "a1-did-not-write-and-the-posture-is-not-the-cause");
  assert.equal(packDisposition([v]).disposition, "inconclusive");
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

// ─────────────────────────────────────────────────────────────────────────────
// WHICH IMAGE ANSWERS — an omitted template must not select one with no agent
//
// ★★★ THE DEFECT THIS PINS. Every keyed lane in this repo pipes `inputs.e2b_template`
// straight into `E2B_TEMPLATE`, and E7-F022 measured the consequence: an omitted input
// "silently defaults to the bare `base` template", which `e2b/e2b.Dockerfile:1-7` and the
// last recorded push trigger both say carries NO agent CLIs ("coreutils only"). For the
// sibling lanes, whose subject is the invocation SHAPE, that costs nothing. For THIS pack
// it would spend the founder's single authorised, token-spending run on an image that
// cannot host the thing being measured.
// ─────────────────────────────────────────────────────────────────────────────

test("an OMITTED template resolves to the CLI-bearing alias, NEVER to bare `base`", () => {
  for (const raw of [undefined, null, "", "   ", 42]) {
    const r = resolveTemplate(raw);
    assert.equal(
      r.templateId,
      CLI_BEARING_TEMPLATE_ALIAS,
      `an omitted template (${JSON.stringify(raw)}) must resolve to the image that carries the agent CLIs`,
    );
    assert.notEqual(
      r.templateId,
      BARE_BASE_TEMPLATE_ALIAS,
      "resolving an omitted input to bare `base` runs the decisive probe against an image with no agent (E7-F022)",
    );
    assert.equal(r.source, "default-cli-bearing");
    assert.ok(r.note.includes(CLI_BEARING_TEMPLATE_ALIAS), "the resolution must SAY what it chose and why");
  }
});

// ★ THE POSITIVE CONTROL. If this goes red under the same edit, the fix has stopped the
// operator selecting a template at all — which is a worse lane than the one being fixed.
test("an EXPLICITLY supplied template is honoured unchanged", () => {
  const r = resolveTemplate("  my-private-template  ");
  assert.equal(r.templateId, "my-private-template", "an explicit alias must survive verbatim (trimmed only)");
  assert.equal(r.source, "explicit");
  // Including bare `base`, if an operator deliberately wants the no-CLI measurement:
  // explicit is explicit, and only OMISSION is corrected.
  const bare = resolveTemplate(BARE_BASE_TEMPLATE_ALIAS);
  assert.equal(bare.templateId, BARE_BASE_TEMPLATE_ALIAS);
  assert.equal(bare.source, "explicit");
  assert.ok(bare.note.includes("NO agent CLIs"), "an explicit bare-base choice must still be flagged in the report");
});

test("the CLI-bearing alias is the one e2b/e2b.Dockerfile actually asserts the CLIs into", () => {
  // Not a naming convention: the alias is only worth defaulting to because the image's
  // final layer FAILS THE BUILD unless both binaries resolve.
  const dockerfile = readFileSync(E2B_DOCKERFILE, "utf8");
  assert.ok(
    dockerfile.includes("command -v claude") && dockerfile.includes("command -v codex"),
    "e2b/e2b.Dockerfile no longer asserts both CLIs — re-derive which template carries them before defaulting to one",
  );
  assert.ok(
    dockerfile.includes(CLI_BEARING_TEMPLATE_ALIAS),
    `e2b/e2b.Dockerfile no longer names "${CLI_BEARING_TEMPLATE_ALIAS}" — the default may be pointing at nothing`,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// PROBE T — E7-F022: A TEMPLATE NAME IS NOT A TEMPLATE FILESYSTEM
//
// ★★★ E7-F022 measured that `E2B_TEMPLATE` "silently defaults to the bare `base`
// template" on every keyed lane, that bare base has no agent CLIs, and that therefore
// "a keyed run against bare `base` can be reported green while the CLIs were never
// present". `resolveTemplate` fixes the NAME on this lane; nothing checked the IMAGE.
// E7-F022's own owner paragraph names the missing piece: "a boot-time or lane-time
// assertion that the registered template contains what the Dockerfile promises".
// ─────────────────────────────────────────────────────────────────────────────

const preflightStdout = (haveClaude, haveCodex) =>
  `${haveClaude ? "W7U1_HAVE:claude" : "W7U1_MISSING:claude"}\n${haveCodex ? "W7U1_HAVE:codex" : "W7U1_MISSING:codex"}\n`;

test("a template carrying BOTH CLIs satisfies the precondition", () => {
  const v = evaluateTemplateCliPreflight({
    channel: "returned",
    exitCode: 0,
    stdout: preflightStdout(true, true),
    template: CLI_BEARING_TEMPLATE_ALIAS,
  });
  assert.equal(v.state, "yes");
  assert.equal(v.reason, "template-carries-the-agent-clis");
  assert.equal(packDisposition([v]).disposition, "measured", "a satisfied precondition must not red the lane");
});

test("a template MISSING a CLI reds the lane BEFORE any model tokens are spent", () => {
  const v = evaluateTemplateCliPreflight({
    channel: "returned",
    exitCode: 0,
    stdout: preflightStdout(false, false),
    template: BARE_BASE_TEMPLATE_ALIAS,
  });
  assert.equal(v.state, "inconclusive");
  assert.equal(v.reason, "template-does-not-carry-the-agent-clis");
  assert.match(v.detail, /claude \+ codex/);
  assert.match(v.detail, new RegExp(BARE_BASE_TEMPLATE_ALIAS));
  assert.match(v.detail, /NO model tokens were spent/);
  assert.equal(packDisposition([v]).disposition, "inconclusive");
});

test("ONE missing CLI is enough — a half-equipped image is not the image the question is about", () => {
  const v = evaluateTemplateCliPreflight({
    channel: "returned",
    exitCode: 0,
    stdout: preflightStdout(true, false),
    template: "aoa-base-stale",
  });
  assert.equal(v.state, "inconclusive");
  assert.equal(v.reason, "template-does-not-carry-the-agent-clis");
  assert.match(v.detail, /codex/);
});

test("SILENCE IS NOT PRESENCE — a check that said nothing about a binary refuses, it does not pass", () => {
  // ★★★ [[checks-that-nothing-runs]], head on. If the shell died, the capture truncated or
  // the script was replaced with one that only reports failures, "no MISSING line" would
  // read as "both present" and the precondition would certify an image nobody looked at.
  const v = evaluateTemplateCliPreflight({ channel: "returned", exitCode: 0, stdout: "", template: "aoa-base" });
  assert.equal(v.state, "inconclusive");
  assert.equal(v.reason, "template-preflight-unreadable");
  assert.notEqual(v.reason, "template-carries-the-agent-clis");
});

test("a preflight that never reached a terminal establishes nothing", () => {
  for (const channel of ["timedOut", "threw", "not-run", "binary-missing"]) {
    const v = evaluateTemplateCliPreflight({ channel, stdout: preflightStdout(true, true), template: "aoa-base" });
    assert.equal(v.state, "inconclusive", `channel=${channel} must not certify the image`);
    assert.equal(v.reason, "template-preflight-did-not-run");
  }
});

test("the preflight SCRIPT prints a positive marker per binary, and names both of them", () => {
  // The script and the reader are a pair; a script that stopped emitting HAVE lines would
  // turn every green run into `template-preflight-unreadable` rather than a silent pass,
  // but pinning it here makes the pairing explicit rather than incidental.
  for (const bin of TEMPLATE_CLI_BINARIES) {
    assert.ok(TEMPLATE_CLI_PROBE_SCRIPT.includes(bin), `the preflight script no longer probes ${bin}`);
  }
  assert.ok(TEMPLATE_CLI_PROBE_SCRIPT.includes("W7U1_HAVE:"), "the script must emit an explicit PRESENT marker");
  assert.ok(TEMPLATE_CLI_PROBE_SCRIPT.includes("W7U1_MISSING:"), "the script must emit an explicit ABSENT marker");
});

test("the binaries the preflight demands are exactly the ones e2b/e2b.Dockerfile asserts", () => {
  const dockerfile = readFileSync(E2B_DOCKERFILE, "utf8");
  for (const bin of TEMPLATE_CLI_BINARIES) {
    assert.ok(
      dockerfile.includes(`command -v ${bin}`),
      `e2b/e2b.Dockerfile no longer asserts \`command -v ${bin}\` — the lane-time precondition and the image's own ` +
        "build guard have drifted apart",
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// THE DURABLE RECORD — a verdict that lives only in a job log is a lost measurement
//
// ★★★ THE DEFECT THIS PINS. E7-F025 measured that the sibling keyed lane already fired
// TWICE (`.github/keyed-e2b-trigger` re-fires #3 and #4) and that no document in the repo
// records either outcome, so the honest state of that measurement is "fired and
// unrecorded". This pack must not lose the founder's one authorised run the same way.
// ─────────────────────────────────────────────────────────────────────────────

const RECORD_VERDICTS = [
  { probe: "B", state: "no", reason: "template-prefills-nothing", detail: "listing: .bashrc" },
  { probe: "C", state: "yes", reason: "both-streams-delivered", detail: "" },
  { probe: "A/claude_local", state: "inconclusive", reason: "no-model-provider-key", detail: "ANTHROPIC_API_KEY unset" },
];

test("the record carries the disposition, EVERY probe's state AND reason, the template and the sha", () => {
  const rec = buildProbeRecord({
    verdicts: RECORD_VERDICTS,
    template: CLI_BEARING_TEMPLATE_ALIAS,
    templateSource: "default-cli-bearing",
    templateNote: "n",
    commitSha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    runNonce: "W7U1-X",
    generatedAt: "2026-09-06T00:00:00.000Z",
  });
  assert.equal(rec.schema, PROBE_RECORD_SCHEMA);
  assert.equal(rec.template.resolved, CLI_BEARING_TEMPLATE_ALIAS);
  assert.equal(rec.template.source, "default-cli-bearing");
  assert.equal(rec.template.carriesAgentClis, true);
  assert.equal(rec.commitSha, "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef");
  assert.equal(rec.disposition.disposition, "inconclusive");
  assert.equal(rec.disposition.exitCode, 1);
  assert.deepEqual(
    rec.probes.map((p) => `${p.probe}=${p.state}/${p.reason}`),
    [
      "B=no/template-prefills-nothing",
      "C=yes/both-streams-delivered",
      "A/claude_local=inconclusive/no-model-provider-key",
    ],
    "a record that drops a probe's REASON says what happened but not what to do next",
  );
});

test("a record with NO resolved template is REFUSED — it could not be interpreted later", () => {
  assert.throws(
    () => buildProbeRecord({ verdicts: RECORD_VERDICTS, template: "  ", commitSha: "abc" }),
    ProbeRecordError,
    "a record that does not say which image answered is unreadable a month later (E7-F022)",
  );
});

test("a record is buildable for a run that produced NO verdicts at all — the inconclusive run still records", () => {
  const rec = buildProbeRecord({ verdicts: [], template: CLI_BEARING_TEMPLATE_ALIAS });
  assert.equal(rec.disposition.disposition, "inconclusive");
  assert.equal(rec.probes.length, 0);
  assert.equal(rec.commitSha, "unknown", "an unknown sha is recorded as unknown, not omitted");
});

// ─────────────────────────────────────────────────────────────────────────────
// AND THE LANE ITSELF MUST ACTUALLY RETRIEVE IT — asserted against the REAL YAML
//
// ★★★ WITHOUT THIS, EVERY TEST ABOVE IS VACUOUS. `buildProbeRecord` can be perfect and the
// record still reach nobody, because whether it is uploaded — and whether it is uploaded on
// a RED run — is decided in YAML that no test reads. Same shape as `ci-lanes.mjs`'s
// `uploadsEvidenceBundleOnFailure`, which already does this for `d1-merge-train.yml`'s
// evidence bundle.
// ─────────────────────────────────────────────────────────────────────────────

test("the W7U1 keyed lane uploads its record, on a RED run as well as a green one", () => {
  const { violations } = evaluateDurableRecord(readFileSync(PROBE_WORKFLOW, "utf8"));
  assert.deepEqual(
    violations.map((v) => v.code),
    [],
    `keyed-e2b-w7u1-output-probe.yml does not durably record its verdict:\n${violations
      .map((v) => `  - ${v.code}: ${v.detail}`)
      .join("\n")}`,
  );
});

// ★ THE CHECKER'S OWN NEGATIVE CONTROLS. A guard that cannot go red is not a guard — this
// programme's [[checks-that-nothing-runs]] class. Each fixture removes exactly one property
// and the corresponding code must appear.
test("evaluateDurableRecord goes RED when the guard, the upload, the fallback or the default is removed", () => {
  const real = readFileSync(PROBE_WORKFLOW, "utf8");

  // 1. The upload step loses its `if: always()` — the inconclusive run's artefact is dropped.
  const unguarded = real.replace(/(uses: actions\/upload-artifact@[0-9a-f]+ # v[0-9.]+\r?\n\s*)if: always\(\)\r?\n/, "$1");
  assert.notEqual(unguarded, real, "the fixture edit did not apply — re-derive it from the workflow");
  assert.ok(
    evaluateDurableRecord(unguarded).violations.some((v) => v.code === "record-upload-unguarded"),
    "a success-gated upload must be caught: the red run is the one whose detail someone needs",
  );

  // 2. No upload step at all.
  assert.ok(
    evaluateDurableRecord(real.replace(/uses: actions\/upload-artifact[^\n]*/g, "uses: actions/checkout@v9")).violations.some(
      (v) => v.code === "record-upload-missing",
    ),
  );

  // 3. No always()-guarded writer, so a pack that dies early uploads nothing.
  assert.ok(
    evaluateDurableRecord(real.replace(/W7U1_RECORD_PATH/g, "SOME_OTHER_PATH")).violations.some(
      (v) => v.code === "record-fallback-missing",
    ),
  );

  // 4. The shell fallback's default drifts away from the pure core's.
  assert.ok(
    evaluateDurableRecord(real.replace(/W7U1_DEFAULT_TEMPLATE: aoa-base/, "W7U1_DEFAULT_TEMPLATE: base")).violations.some(
      (v) => v.code === "default-template-mismatch",
    ),
    "the record and the run must not be able to name different images",
  );
});
