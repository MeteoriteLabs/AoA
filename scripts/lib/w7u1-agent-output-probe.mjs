// scripts/lib/w7u1-agent-output-probe.mjs
//
// W7U1 — THE PURE CORE OF THE OUTPUT PROBE PACK.
//
// The pack answers ONE question with a real, keyed E2B run:
//
//   Can a real `claude` / `codex`, invoked under the EXACT PRODUCTION ARGV
//   (`buildSandboxInvocation`, server/src/services/task-run-sandbox-invocation.ts),
//   write a file inside the sandbox AT ALL?
//
// It BUILDS NO OUTPUT MECHANISM. It measures whether one is possible, and it must be
// able to answer **no** as cleanly as it answers yes.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THE LOGIC IS SEPARATED FROM THE SANDBOX
// ─────────────────────────────────────────────────────────────────────────────
// The keyed lane runs ONCE, on an operator's authorisation, with a real key. Every
// decision it makes must therefore be provable WITHOUT the key, or the run is the
// first and only exercise of the code that reads it — which is the exact shape of
// the eight divergences the first keyed conformance run surfaced
// (`CLI-realE2B-hardening-result.md`). So every classification, every verdict and
// the secret redactor live here as pure functions with killable mutants, tested by
// `scripts/lib/__tests__/w7u1-agent-output-probe.test.mjs` in the required `policy`
// job. The sandbox-touching half is
// `packages/sandbox-e2b-provider/src/__tests__/keyed-w7u1-agent-output-probe.test.ts`.
//
// ─────────────────────────────────────────────────────────────────────────────
// THREE STATES, ALWAYS — AND WHY "inconclusive" IS NOT A FAILURE STATE
// ─────────────────────────────────────────────────────────────────────────────
// A probe that can only pass is worthless, and a probe whose error is
// indistinguishable from a negative result is worse than worthless: it converts an
// apparatus failure into a finding. So every verdict is one of:
//
//   "yes"          — the thing happened, and the evidence names it
//   "no"           — the thing did NOT happen, and the run was sound enough to say so
//   "inconclusive" — the apparatus did not establish either; the reason is CARRIED,
//                    never flattened to a boolean
//
// `no` is a RESULT and the lane stays green for it. `inconclusive` is the only state
// that reds the lane, because it is the only one that means "run me again".
//
// Zero imports on purpose: this module is loaded both by `node --test` (policy) and by
// a vitest test inside `@armyofagents/sandbox-e2b-provider`, whose runtime-source
// import boundary allows exactly five packages. Nothing here reaches the network, the
// filesystem, or `process`.

/** The three states every probe and every verdict reports. */
export const PROBE_STATES = Object.freeze(["yes", "no", "inconclusive"]);

/**
 * How a READ of an in-sandbox path terminated.
 *
 * ★★★ THE READ CHANNEL IS A CHANNEL, EXACTLY LIKE THE EXEC CHANNEL. `readBack` used to
 * catch EVERY throw and answer `found:false`, which made a transport fault during the
 * readback byte-identical to "the agent wrote nothing" — an apparatus failure printed
 * to the operator as a capability answer, on the single authorised run that is supposed
 * to settle the question. The exec-side controls do NOT cover it: A0's success is
 * temporally PRIOR to A1's readback, not concurrent with it, so a fault that first
 * appears during A1's read is invisible to A0.
 *
 * `real-transport.ts` already draws the line the probe needs: `readFile` raises
 * `E2bTransportNotFoundError` for a genuine "no such file" and rethrows anything else
 * verbatim. So the caller keys off `err instanceof E2bTransportNotFoundError`:
 *
 *   "not-found" — the path is genuinely absent. A NEGATIVE RESULT is admissible.
 *   "faulted"   — the read itself failed for any other reason. NOTHING may be concluded
 *                 about the file, and the arm/probe is INCONCLUSIVE.
 *   null        — the read succeeded.
 */
export const READ_ERROR_KINDS = Object.freeze(["not-found", "faulted"]);

/**
 * Is a listing command's terminal channel usable as evidence of what is in a directory?
 *
 * ★ ONLY `returned` IS. A listing that TIMED OUT produced no directory contents and yet
 * used to leave `listingOk` true, so probe B would go on to report
 * `template-prefills-nothing` on the strength of a listing that never happened — the
 * same "a fault becomes a confident negative" shape as the read channel, one probe over.
 * `timedOut`, `threw`, `not-run` and `binary-missing` are all "we did not look".
 */
export function isListingUsable(channel) {
  return channel === "returned";
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE PERMISSION POSTURE — probe A2's ONLY variable
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The permission posture each adapter's LEGACY (shipped, non-distributed) path applies
 * for an unattended run, and the exact anchor inside the DISTRIBUTED script that it
 * would have to be inserted at.
 *
 * ★ MEASURED, not assumed — this is the premise the whole unit rests on and it was
 * re-verified at `31d33a3b0` before a line of this file was written:
 *
 *   * `task-run-sandbox-invocation.ts:181-206` holds FOUR script literals (claude with
 *     and without a bundle, codex with and without) and **none of the four carries any
 *     permission posture** — no `--dangerously-skip-permissions`, no `--settings`, no
 *     `--allowedTools`, no `--dangerously-bypass-approvals-and-sandbox`.
 *   * The shipped product treats the flag as REQUIRED for an unattended run:
 *     `claude-local/src/server/execute.ts:745` (unbridged) and
 *     `internal-agent/cli-mode.ts:598` push it; `codex-local/src/server/execute.ts:555`
 *     pushes codex's.
 *   * And the absence is recorded as a MEASURED defect, not a theory:
 *     `resolve-crew-adapter.ts:147-151` — without it a `--print` crew run "silently
 *     no-op[s] on every MCP tool call (permission gate hangs)", found in UAT
 *     iteration 2 and fixed by BACKFILLING the flag onto existing rows.
 *
 * So A1 (production argv, no posture) versus A2 (same everything, posture added) is a
 * differential over the one variable the source says should matter.
 *
 * ★★ THE FLAG IS APPLIED BY REWRITING THE EMITTED SCRIPT, INSIDE THE PROBE. Production
 * is not touched: `buildSandboxInvocation` emits A1's argv verbatim, and A2 is that
 * argv with one substring replaced. The alternative — editing the production literal —
 * would make the probe a test of a change nobody has decided to make.
 *
 * `anchor` positions are taken from the legacy adapters so A2 is the shape the shipped
 * product actually spawns: claude appends the flag after the base
 * `--print - --output-format stream-json --verbose` block (`execute.ts:736,745`), and
 * codex inserts it between `exec --json` and the `-` positional (`execute.ts:553-566`).
 */
export const PERMISSION_POSTURES = Object.freeze({
  claude_local: Object.freeze({
    flag: "--dangerously-skip-permissions",
    anchor: "--output-format stream-json --verbose",
    replacement: "--output-format stream-json --verbose --dangerously-skip-permissions",
  }),
  codex_local: Object.freeze({
    flag: "--dangerously-bypass-approvals-and-sandbox",
    anchor: "exec --json -",
    replacement: "exec --json --dangerously-bypass-approvals-and-sandbox -",
  }),
});

/** Raised when the production script no longer contains the anchor A2 rewrites. */
export class PermissionPostureAnchorError extends Error {
  constructor(message) {
    super(message);
    this.name = "PermissionPostureAnchorError";
  }
}

/** Count NON-OVERLAPPING occurrences of `needle` in `haystack`. */
export function countOccurrences(haystack, needle) {
  if (needle.length === 0) throw new Error("countOccurrences: empty needle");
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return count;
    count += 1;
    from = at + needle.length;
  }
}

/**
 * Probe A2's transform: the production script, plus the adapter's permission posture.
 *
 * ★★★ THIS FUNCTION EXISTS TO REFUSE, NOT TO REWRITE. If a future edit to
 * `task-run-sandbox-invocation.ts` moves or removes the anchor, a permissive
 * implementation would return the script UNCHANGED — and then A2 would be
 * byte-identical to A1, the differential would compare a thing with itself, and the
 * pack would report "the flag makes no difference" while never having applied it. That
 * is this programme's [[checks-that-nothing-runs]] class, one layer in. So every way
 * of failing to apply the flag THROWS:
 *
 *   * unknown adapter                 → nothing to apply
 *   * anchor absent                   → the production shape moved
 *   * anchor ambiguous (≠1 match)     → we cannot say WHERE it would land
 *   * the flag is ALREADY present     → the unit's premise has collapsed; that is the
 *                                       finding, and silently "adding" it would hide it
 *   * the result equals the input     → belt and braces; a no-op rewrite is a lie
 */
export function withPermissionPosture(script, adapterType) {
  const posture = PERMISSION_POSTURES[adapterType];
  if (!posture) {
    throw new PermissionPostureAnchorError(
      `no permission posture is defined for adapterType "${adapterType}"; probe A2 cannot vary what it does not know`,
    );
  }
  if (script.includes(posture.flag)) {
    throw new PermissionPostureAnchorError(
      `the production script ALREADY carries ${posture.flag} for ${adapterType}. ` +
        `W7U1's premise (the distributed argv has no permission posture) is REFUTED — report that, do not probe it.`,
    );
  }
  const matches = countOccurrences(script, posture.anchor);
  if (matches !== 1) {
    throw new PermissionPostureAnchorError(
      `expected exactly 1 occurrence of the A2 anchor ${JSON.stringify(posture.anchor)} in the ${adapterType} ` +
        `script, found ${matches}. The production shape moved; re-derive the anchor before trusting any A1-vs-A2 comparison.`,
    );
  }
  const rewritten = script.replace(posture.anchor, posture.replacement);
  if (rewritten === script) {
    throw new PermissionPostureAnchorError(
      `the ${adapterType} A2 rewrite was a NO-OP; A2 would be identical to A1 and the differential would be vacuous`,
    );
  }
  return rewritten;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. SECRET REDACTION — nothing the pack prints may carry a credential
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Replace every occurrence of every supplied secret VALUE with a fixed marker.
 *
 * The pack prints the agent's raw stdout and stderr, because "exited 0 and wrote
 * nothing" and "printed a permission prompt and stalled" are different answers and the
 * operator has to be able to tell them apart. A CLI that echoes its own configuration
 * — or an error that quotes the environment — would otherwise put the key in a public
 * Actions log. So EVERY string this pack emits goes through here.
 *
 * Short values are ignored: a 3-character "secret" would redact ordinary prose and make
 * the log unreadable, which is its own way of losing the evidence.
 */
export const REDACTION_MARKER = "«redacted»";
export const MIN_REDACTABLE_SECRET_LENGTH = 8;

export function redactSecrets(text, secrets) {
  let out = String(text ?? "");
  for (const secret of secrets ?? []) {
    if (typeof secret !== "string") continue;
    if (secret.length < MIN_REDACTABLE_SECRET_LENGTH) continue;
    out = out.split(secret).join(REDACTION_MARKER);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. ONE ARM OF PROBE A
// ─────────────────────────────────────────────────────────────────────────────

/**
 * An arm's outcome, kept SEPARATE from the file result on purpose.
 *
 * "no file", "hung", and "exited 127" are three different answers with three different
 * consequences, and a probe that collapses them into `false` has thrown away the part
 * the reader needs. `state` is the capability answer; `cause` is why.
 *
 *   "wrote"          — the target file exists AND carries this arm's nonce
 *   "did-not-write"  — the arm reached a terminal and the file is absent (or empty of
 *                      the nonce) — a genuine negative
 *   "indeterminate"  — nothing can be read from this arm: the binary was not runnable,
 *                      the target path already existed, or SOMETHING ELSE wrote content
 *                      we did not ask for
 */
export function classifyProbeAArm(arm) {
  const { label, targetPreExisted, execution, file, nonce } = arm;
  const at = (state, cause, detail) => ({ label, state, cause, detail: detail ?? "" });

  if (targetPreExisted === true) {
    return at(
      "indeterminate",
      "target-path-already-existed",
      "the arm's target path was present BEFORE the arm ran, so a file found afterwards attributes to nothing",
    );
  }

  // ★★★ A FAULTED READ IS NOT AN ABSENT FILE, AND IT IS CHECKED BEFORE ANYTHING ELSE.
  // See READ_ERROR_KINDS. Everything below this line reasons about a file that is
  // present or genuinely absent; a read that FAILED establishes neither, and folding it
  // into "absent" is how an infrastructure fault gets printed as
  // "the agent did not write". The exec channel cannot stand in for this: a read fault
  // occurring during A1's readback is later than A0's success and outside its scope.
  if (file?.errorKind === "faulted") {
    return at(
      "indeterminate",
      "read-faulted",
      `the arm's target path could not be READ (a fault, not a genuine "no such file"): ${String(file?.detail ?? "")}. ` +
        "Nothing may be concluded about whether the agent wrote; re-run.",
    );
  }

  const found = file?.found === true;
  const content = typeof file?.content === "string" ? file.content : "";
  const carriesNonce = found && typeof nonce === "string" && nonce.length > 0 && content.includes(nonce);

  if (found && !carriesNonce) {
    // Something wrote at the path we watched, but not what we asked for. That is not a
    // capability answer; it is a broken attribution — E7-F020's class, one layer down.
    return at(
      "indeterminate",
      "file-present-without-the-nonce",
      "a file exists at the target path but does not contain this arm's nonce; nothing may be attributed to the agent",
    );
  }
  if (carriesNonce) return at("wrote", "nonce-present", "");

  // No file. WHY there is no file decides whether this is a measurement or a miss.
  const channel = execution?.channel;
  if (channel === "not-run") {
    return at("indeterminate", "arm-did-not-run", String(execution?.detail ?? ""));
  }
  if (channel === "binary-missing" || execution?.exitCode === 127) {
    return at(
      "indeterminate",
      "binary-not-runnable",
      "the CLI exited 127 (command not found) or was never installed — the experiment did not happen",
    );
  }
  if (channel === "threw") {
    // ★ A FAULT IS NOT A NEGATIVE RESULT. Against real E2B a non-zero exit comes back
    // as a RESULT (E7-F014's conversion) and a genuine sandbox/transport fault still
    // THROWS. Reading a throw as "the agent did not write" would manufacture a
    // capability answer out of an infrastructure failure — the same mistake, one layer
    // up, that E7-F014's fix refused to make in the other direction.
    return at("indeterminate", "arm-faulted", String(execution?.detail ?? ""));
  }
  if (channel === "timedOut") {
    return at(
      "did-not-write",
      "stalled",
      "the invocation did not terminate within its budget and no file appeared — the shape a permission gate takes in --print mode",
    );
  }
  return at("did-not-write", `exited-${String(execution?.exitCode ?? "unknown")}`, "");
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. PROBE A's VERDICT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Probe A: can the production argv write a file?
 *
 * ★ THE CONTROLS GATE THE MEASUREMENT, AND THEY GATE IT FIRST. A bare "no file" is
 * useless because three different causes produce it — the write/read path is broken,
 * the agent could not run, or the agent genuinely cannot write. So:
 *
 *   A0 HARNESS CONTROL     write the same shape of file at the same shape of path by
 *                          PLAIN SHELL, and read it back. If A0 fails, nothing in A
 *                          means anything: the failure is in the probe.
 *   A1 THE QUESTION        production argv, no permission posture.
 *   A2 THE DIFFERENTIAL    the same prompt TEMPLATE and the same sandbox, posture ADDED.
 *                          A1's and A2's prompts are not byte-identical: each names its
 *                          OWN target path and OWN nonce, for exactly the reason A0 needs
 *                          its own path — a file one arm left behind must never read back
 *                          as another arm's success. Those two lines are the arms' identity,
 *                          not a second experimental variable, and the posture flag remains
 *                          the only thing that differs about HOW the agent is invoked.
 *   A3 NEGATIVE CONTROL    a prompt that instructs the agent NOT to write. If a file
 *                          appears anyway, something other than the agent is writing at
 *                          that path and probe A can attribute nothing (E7-F020's class).
 *
 * ★★ A0 CANNOT USE A1's EXACT PATH, and pretending otherwise would poison the
 * measurement: a file A0 left behind would be read back as A1's success. Each arm gets
 * its own path of the SAME SHAPE in the SAME DIRECTORY, written and read through the
 * SAME transport calls, and every arm additionally asserts its own path is ABSENT
 * before it runs (`targetPreExisted`). That is what makes the arms independent.
 */
export function verdictProbeA(arms) {
  const { a0, a1, a2, a3 } = arms;
  const line = (state, reason, detail) => ({ probe: "A", state, reason, detail: detail ?? "" });

  if (!a0 || a0.state !== "wrote") {
    return line(
      "inconclusive",
      "harness-control-failed",
      `A0 (plain shell writes and we read it back) did not succeed: ${a0 ? `${a0.state}/${a0.cause}` : "missing"}. ` +
        "The write+read path is not proven, so A1's empty result attributes to nothing. Fix the probe, then re-run.",
    );
  }
  if (a3 && a3.state === "wrote") {
    return line(
      "inconclusive",
      "negative-control-violated",
      "A3 asked the agent NOT to write and a file carrying A3's nonce appeared anyway. Something other than the " +
        "agent is writing at the watched path; no arm of probe A may be attributed to the agent.",
    );
  }
  if (!a1) return line("inconclusive", "a1-missing", "the question arm produced no record at all");
  if (a1.state === "indeterminate") {
    return line(
      "inconclusive",
      `a1-${a1.cause}`,
      `A1 could not be read: ${a1.detail || a1.cause}. The production argv was not exercised.`,
    );
  }
  if (a1.state === "wrote") {
    const a2note =
      a2 && a2.state === "wrote"
        ? "A2 (posture added) also wrote, as expected."
        : `A2 (posture added) did NOT write (${a2 ? `${a2.state}/${a2.cause}` : "missing"}) — unexpected, and worth a look.`;
    return line(
      "yes",
      "a1-wrote-under-production-argv",
      `The EXACT production argv, with NO permission posture, produced the requested file. ${a2note}`,
    );
  }

  // A1 did not write. The question is now whether the missing posture is the cause.
  if (a2 && a2.state === "wrote") {
    return line(
      "no",
      "a1-did-not-write-and-the-posture-is-the-cause",
      `A1 (production argv) did not write (${a1.cause}); A2 (the same prompt template — differing only in the two ` +
        `lines naming its own target path and nonce, as arm separation requires — with the permission posture added) DID. ` +
        "The absent permission flag is the cause. That is a PRODUCT finding about " +
        "task-run-sandbox-invocation.ts's four script literals, not merely an input to a later ticket.",
    );
  }
  if (a2 && a2.state === "did-not-write") {
    return line(
      "no",
      "a1-did-not-write-and-the-posture-is-not-the-cause",
      `Neither A1 (${a1.cause}) nor A2 (${a2.cause}) produced the file. Adding the permission posture does NOT make ` +
        "the agent able to write here; something else is in the way, and a posture-only fix would not have helped.",
    );
  }
  return line(
    "no",
    "a1-did-not-write-cause-unattributed",
    `A1 did not write (${a1.cause}) and A2 could not be read (${a2 ? `${a2.state}/${a2.cause}` : "missing"}), so the ` +
      "permission posture is neither convicted nor exonerated. The NO is sound; the CAUSE is not established.",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. PROBE B — is the TEMPLATE already satisfying a location convention?
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Probe B: read the candidate output paths out of a freshly created sandbox BEFORE any
 * exec, and enumerate what is actually there.
 *
 * ★ WHY THIS IS A POSITIVE CONTROL NOBODY PROPOSED. Every location-based output
 * convention — "the run's output is whatever is at path P" — is satisfiable by ANY
 * writer of P, and the template is a writer no protocol surface can see. If the
 * template pre-fills a candidate path, then a convention anchored there is satisfied
 * with no agent, no worker and no output: exactly E7-F020's class, with an input that
 * is invisible from the wire.
 *
 * ★★ IT ENUMERATES, IT DOES NOT ASK. "Does file X exist" answers one path; a listing
 * answers the question that matters — WHAT is there — including the file nobody thought
 * to name. `entries` is the listing; `candidates` is the subset we care about.
 */
export function verdictProbeB(observation) {
  const { listingOk, entries, candidates } = observation ?? {};
  if (listingOk !== true) {
    return {
      probe: "B",
      state: "inconclusive",
      reason: "enumeration-failed",
      detail: `the candidate directories could not be enumerated: ${String(observation?.detail ?? "no detail")}`,
    };
  }
  const prefilled = (candidates ?? []).filter((c) => c.exists === true);
  if (prefilled.length > 0) {
    return {
      probe: "B",
      state: "yes",
      reason: "template-prefills-a-candidate-output-path",
      detail:
        `${prefilled.length} candidate output path(s) EXIST in a fresh sandbox before any exec: ` +
        `${prefilled.map((c) => `${c.path} (${c.bytes} bytes)`).join(", ")}. ` +
        "A location-based output convention anchored at these is satisfiable by the template alone.",
    };
  }
  // ★★★ A CANDIDATE WHOSE READ FAULTED IS NOT A CANDIDATE THAT IS ABSENT. Each candidate
  // is read with the same `readBack` probe A uses, so each carries the same
  // `errorKind` (READ_ERROR_KINDS). Counting a faulted read as `exists:false` would feed
  // the "template-prefills-nothing" NO with a path nobody actually looked at.
  //
  // ★★ THIS GATES THE NEGATIVE ONLY, AND DELIBERATELY SO. It sits AFTER the
  // `prefills-a-candidate` branch because that branch is an OBSERVED POSITIVE — a path
  // that was read and found to exist — and an unread NEIGHBOUR cannot unmake it.
  // `inconclusive` means "run me again"; a confirmed prefill is not made truer by a
  // second run. It is the NO, which asserts something about paths we did not see, that
  // an unread path invalidates.
  const faultedReads = (candidates ?? []).filter((c) => c.errorKind === "faulted");
  if (faultedReads.length > 0) {
    return {
      probe: "B",
      state: "inconclusive",
      reason: "candidate-read-faulted",
      detail:
        `${faultedReads.length} candidate output path(s) could not be READ (a fault, not a genuine "no such file"): ` +
        `${faultedReads.map((c) => `${c.path} (${String(c.detail ?? "no detail")})`).join(", ")}. ` +
        "Their absence is NOT established, so `template-prefills-nothing` may not be claimed. Re-run.",
    };
  }

  return {
    probe: "B",
    state: "no",
    reason: "template-prefills-nothing",
    detail:
      `none of the ${(candidates ?? []).length} candidate output paths exist in a fresh sandbox. ` +
      `Directory listing (${(entries ?? []).length} entries): ${(entries ?? []).join(" ") || "(empty)"}`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. PROBE C — does the stream handler deliver from real E2B?
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Probe C: re-run the CLI-003/D1 streaming case against real E2B and record it either
 * way.
 *
 * ★ THE BRIEF'S PREMISE IS STALE AND THIS UNIT CORRECTS IT RATHER THAN INHERITING IT.
 * The brief says "the only real-E2B run of that case FAILED (stdout empty) and the
 * re-fire is queued". The re-fire HAPPENED — three times. `keyed-e2b-conformance.yml`
 * runs 32211821459 (2026-08-19), 32995765059 (2026-08-26) and 33788025048 (2026-09-03)
 * all completed `success`, and the last one's log names the case explicitly:
 * "CLI-003/D4 … success: a real command streams stdout/stderr chunks and exits 0 …
 * 495ms", inside "Tests 19 passed (19)". The stale line is
 * `CLI-realE2B-hardening-result.md`'s status field, which still reads "keyed re-fire
 * queued". Probe C is kept anyway — one authorised run should answer all three
 * questions, and a re-measurement that agrees is cheap — but it is a CONFIRMATION, not
 * an open question, and this pack says so.
 */
export function verdictProbeC(observation) {
  const { ran, exitCode, stdout, stderr, stdoutMarker, stderrMarker } = observation ?? {};
  if (ran !== true) {
    return {
      probe: "C",
      state: "inconclusive",
      reason: "case-did-not-run",
      detail: `the streaming command never produced a terminal: ${String(observation?.detail ?? "no detail")}`,
    };
  }
  const gotOut = typeof stdout === "string" && stdoutMarker ? stdout.includes(stdoutMarker) : false;
  const gotErr = typeof stderr === "string" && stderrMarker ? stderr.includes(stderrMarker) : false;
  if (gotOut && gotErr && exitCode === 0) {
    return {
      probe: "C",
      state: "yes",
      reason: "both-streams-delivered",
      detail: "onStdout and onStderr each received their marker from a real E2B sandbox, and the command exited 0.",
    };
  }
  return {
    probe: "C",
    state: "no",
    reason: "stream-delivery-incomplete",
    detail:
      `exitCode=${String(exitCode)} stdoutMarkerSeen=${String(gotOut)} stderrMarkerSeen=${String(gotErr)}. ` +
      "The command reached a terminal but the stream handlers did not deliver both markers.",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. THE PACK'S OVERALL DISPOSITION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How the LANE should terminate, given the probes' verdicts.
 *
 * ★★★ A `no` KEEPS THE LANE GREEN. This is the whole point of the unit: if the only way
 * for the pack to finish green were for the agent to write a file, then "the agent
 * cannot write" would arrive as a red build, indistinguishable from a broken key, a
 * template change or an outage — and the founder's one authorised run would have bought
 * an ambiguity. `inconclusive` is the ONLY state that reds, because it is the only one
 * that means "the apparatus did not answer; run me again".
 *
 * `skipped` is separate again: no key, no result, nothing claimed. The workflow's own
 * positive-control step is what stops a silent skip from reading as success.
 */
export function packDisposition(verdicts) {
  const list = (verdicts ?? []).filter(Boolean);
  if (list.length === 0) {
    return { exitCode: 1, disposition: "inconclusive", detail: "no probe produced a verdict at all" };
  }
  const bad = list.filter((v) => v.state === "inconclusive");
  if (bad.length > 0) {
    return {
      exitCode: 1,
      disposition: "inconclusive",
      detail: `inconclusive probes: ${bad.map((v) => `${v.probe} (${v.reason})`).join("; ")}`,
    };
  }
  return {
    exitCode: 0,
    disposition: "measured",
    detail: list.map((v) => `${v.probe}=${v.state}`).join(" "),
  };
}

/** Human-readable one-liner per verdict, for the log and the job summary. */
export function formatVerdict(v) {
  return `PROBE ${v.probe}: ${v.state.toUpperCase()} — ${v.reason}\n    ${v.detail}`;
}
