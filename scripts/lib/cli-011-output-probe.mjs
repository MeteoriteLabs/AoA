// -----------------------------------------------------------------------------
// CLI-011 — the P-011 output probe: the PURE core.
//
// The design is `docs/replatform/epics/E7-coding-e2b/tickets/CLI-011-review.md` §10.
// P-011 is the evidence ruling F7 (the output mechanism) waits on. It runs in ONE
// dispatch-only keyed workflow (`.github/workflows/keyed-e2b-cli-011-output-probe.yml`),
// against a real E2B sandbox, and it must be able to answer every row of §10.5's decision
// table — not just "pass" or "fail".
//
// Everything that DECIDES something lives here, as a pure function, so it is exercised on
// every PR by `scripts/lib/__tests__/cli-011-output-probe.test.mjs` in the required
// `policy` job. The keyed test (`packages/sandbox-e2b-provider/src/__tests__/
// keyed-cli-011-output-probe.test.ts`) only OBSERVES and hands its observations here. If
// the keyed run were the first execution of the code that reads it, a bug in the reader
// would spend the authorised run on an unreadable answer — which is how the first keyed
// conformance run produced 8 failures out of 18.
//
// It builds no output mechanism, edits no product literal, and touches no database.
// -----------------------------------------------------------------------------

import {
  CLI_BEARING_TEMPLATE_ALIAS,
  detectModelContactEvidence,
  redactSecrets,
  resolveTemplate,
} from "./w7u1-agent-output-probe.mjs";
import { describeWorkflow } from "./workflow-verdict.mjs";

// The W7U1 pack's template resolution and redactor are REUSED, not copied (§10.2): an
// omitted template resolves to the CLI-bearing `aoa-base`, never to bare `base` (E7-F022).
export { CLI_BEARING_TEMPLATE_ALIAS, redactSecrets, resolveTemplate };

// ─────────────────────────────────────────────────────────────────────────────
// 1. Constants
// ─────────────────────────────────────────────────────────────────────────────

/** SD-2's candidate output root. §10.5 row 1: if S-P0 finds anything here, re-probe with another. */
export const OUTPUT_ROOT = "/home/user/aoa-output";

/** `$HOME` and the default sandbox cwd, which is also `STAGED_INPUT_DIR` (review §3.4). */
export const HOME_DIR = "/home/user";

/** How deep the census lists `$HOME`. §10.4 asks for depth 8. */
export const CENSUS_DEPTH = 8;

/**
 * Paths under `$HOME` that are the agent CLI's OWN state rather than a file in the working
 * directory. The census classifies a changed path by this list, and the list is written into
 * the durable record, so a reader who disagrees with the split can re-classify from the raw
 * delta. It never hides an entry: every changed path is recorded whatever its class.
 */
export const CLI_HOME_STATE_PREFIXES = Object.freeze([
  `${HOME_DIR}/.claude/`,
  `${HOME_DIR}/.claude.json`,
  `${HOME_DIR}/.config/`,
  `${HOME_DIR}/.cache/`,
  `${HOME_DIR}/.npm/`,
  `${HOME_DIR}/.local/`,
]);

/** The file each compliance arm is asked to create. */
export const HELLO_FILE = "hello.txt";

/** A-decl's declaration line (§10.4). */
export const DECLARATION_PREFIX = "AOA-OUTPUT:";

/** The durable record's schema. The workflow's shell fallback writes the same string. */
export const PROBE_RECORD_SCHEMA = "aoa.cli-011.output-probe-record/1";

/** Stdout kept per model arm in the record (same bound as W7U1's classifier). */
export const ARM_STDOUT_LIMIT = 8000;

/** Entries kept per listing in the record. The COUNT is always kept in full. */
export const LISTING_RECORD_LIMIT = 400;

/** The probe's arms, in run order. */
export const SHELL_ARMS = Object.freeze(["S-P0", "S-PC1", "S-P1", "S-PC2", "S-P2", "S-P3", "S-P4", "S-P5", "S-P6", "S-P7"]);
export const MODEL_ARMS = Object.freeze(["A-neg", "A-dir", "A-cwd", "A-decl"]);

/** The dispatch input `arms`. `shell-only` runs P-011a and spends NO model tokens. */
export const ARMS_MODES = Object.freeze(["all", "shell-only"]);

export const ARM_STATES = Object.freeze(["observed", "inconclusive", "not-run"]);

// ─────────────────────────────────────────────────────────────────────────────
// 2. Inputs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the `arms` dispatch input. Empty means `all`. Anything else is REFUSED rather
 * than guessed: a typo must not silently run the token-spending half, or silently skip it.
 * @param {unknown} raw
 * @returns {{mode: "all"|"shell-only", source: "explicit"|"default"}}
 */
export function resolveArmsMode(raw) {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (trimmed.length === 0) return { mode: "all", source: "default" };
  if (!ARMS_MODES.includes(trimmed)) {
    throw new Error(`CLI-011 probe: unknown arms mode ${JSON.stringify(trimmed)}; expected one of ${ARMS_MODES.join(", ")}`);
  }
  return { mode: /** @type {"all"|"shell-only"} */ (trimmed), source: "explicit" };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Arm-local transforms (probe-local, never product code)
// ─────────────────────────────────────────────────────────────────────────────

export class CwdPrefixAnchorError extends Error {
  constructor(detail) {
    super(`CLI-011 probe: cannot apply the A-cwd prefix: ${detail}`);
    this.name = "CwdPrefixAnchorError";
  }
}

/** The anchor in the shipped claude literal: the readable guard ends and the CLI is exec'd. */
export const CWD_PREFIX_ANCHOR = '; exec "$0"';

/**
 * A-cwd (SD-1a): insert `mkdir -p R && cd R && ` before `exec`. PROBE-LOCAL, exactly as
 * W7U1's A2 posture was — `task-run-sandbox-invocation.ts` is not touched.
 *
 * ★ It THROWS unless the anchor occurs EXACTLY once, so A-cwd can never silently become a
 * second copy of A-dir's unmodified literal (and a literal that grows a second `exec` is
 * refused rather than half-edited).
 * @param {string} script the `sh -c` script from `buildSandboxInvocation`
 * @param {string} [root]
 */
export function withCwdPrefix(script, root = OUTPUT_ROOT) {
  const text = String(script ?? "");
  const count = text.split(CWD_PREFIX_ANCHOR).length - 1;
  if (count !== 1) {
    throw new CwdPrefixAnchorError(`expected the anchor ${JSON.stringify(CWD_PREFIX_ANCHOR)} exactly once, found ${count}`);
  }
  if (!/^\/[A-Za-z0-9._/-]+$/.test(root)) throw new CwdPrefixAnchorError(`root ${JSON.stringify(root)} is not a plain absolute path`);
  return text.replace(CWD_PREFIX_ANCHOR, `; mkdir -p ${root} && cd ${root} && exec "$0"`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Prompts
// ─────────────────────────────────────────────────────────────────────────────

/** A-neg's prompt, verbatim from §10.4. */
export const A_NEG_PROMPT = "Reply with the single word OK. Do not create, modify or delete any file.";

/** The task every compliance arm carries. It names NO location. */
export function helloTask(nonce) {
  return `Create a file named ${HELLO_FILE} containing ${nonce}.`;
}

/** SD-1b's directive, verbatim from §10.4. */
export const OUTPUT_DIRECTIVE = `Write every deliverable file under ${OUTPUT_ROOT}/ (create it if needed).`;

/** A-decl's extra instruction (§10.4). */
export const DECLARATION_INSTRUCTION = `End your final message with one line \`${DECLARATION_PREFIX} <relative path>\`.`;

/** @param {"A-dir"|"A-cwd"|"A-decl"} arm */
export function compliancePrompt(arm, nonce) {
  const lines = [helloTask(nonce)];
  if (arm === "A-dir" || arm === "A-decl") lines.push(OUTPUT_DIRECTIVE);
  if (arm === "A-decl") lines.push(DECLARATION_INSTRUCTION);
  if (arm !== "A-dir" && arm !== "A-cwd" && arm !== "A-decl") throw new Error(`no compliance prompt for ${arm}`);
  return `${lines.join("\n")}\n`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Listings and the census diff
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalise one SDK `EntryInfo` (or anything shaped like it) to what the record keeps.
 * Keeps `type`, `size` and `symlinkTarget` — exactly the three fields the real transport
 * discards (review §3.3) and the three S-P2/S-P5/S-P6 exist to observe.
 */
export function normaliseEntry(e) {
  const o = e && typeof e === "object" ? e : {};
  const mtime = o.modifiedTime instanceof Date ? o.modifiedTime.toISOString() : typeof o.modifiedTime === "string" ? o.modifiedTime : null;
  return {
    path: typeof o.path === "string" ? o.path : String(o.name ?? ""),
    type: typeof o.type === "string" ? o.type : null,
    size: typeof o.size === "number" ? o.size : null,
    mtime,
    symlinkTarget: typeof o.symlinkTarget === "string" && o.symlinkTarget.length > 0 ? o.symlinkTarget : null,
  };
}

const isUnder = (path, root) => path === root || path.startsWith(`${root.replace(/\/+$/, "")}/`);

/**
 * Before/after diff of two `$HOME` listings. `modified` means size, mtime, type or link
 * target changed. Directories are included (a directory whose mtime moved is still a
 * write), and classification below decides what counts.
 */
export function diffSnapshots(before, after) {
  const b = new Map((before ?? []).map((e) => [e.path, e]));
  const a = new Map((after ?? []).map((e) => [e.path, e]));
  const added = [];
  const removed = [];
  const modified = [];
  for (const [path, e] of a) {
    const prev = b.get(path);
    if (!prev) added.push(e);
    else if (prev.size !== e.size || prev.mtime !== e.mtime || prev.type !== e.type || prev.symlinkTarget !== e.symlinkTarget) {
      modified.push({ path, before: prev, after: e });
    }
  }
  for (const [path, e] of b) if (!a.has(path)) removed.push(e);
  const byPath = (x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0);
  return { added: added.sort(byPath), removed: removed.sort(byPath), modified: modified.sort(byPath) };
}

/**
 * Classify one path. The order matters: a staged path is never "cwd-other", and the root
 * wins over everything (a file under R counts whatever wrote it — that is the §4.3 point).
 * @returns {"under-root"|"staged"|"cli-home-state"|"cwd-other"|"outside-home"}
 */
export function classifyPath(path, { root = OUTPUT_ROOT, staged = [] } = {}) {
  if (isUnder(path, root)) return "under-root";
  if (staged.includes(path)) return "staged";
  if (CLI_HOME_STATE_PREFIXES.some((p) => path === p.replace(/\/$/, "") || path.startsWith(p))) return "cli-home-state";
  if (isUnder(path, HOME_DIR)) return "cwd-other";
  return "outside-home";
}

/**
 * The census of one arm: every added or modified entry, by class. "Files" excludes
 * directories, because P-A counts files; the directory entries stay in `changed` so
 * nothing is hidden.
 */
export function censusDelta(diff, opts = {}) {
  const changed = [
    ...diff.added.map((e) => ({ ...e, change: "added" })),
    ...diff.modified.map((m) => ({ ...m.after, change: "modified" })),
    ...diff.removed.map((e) => ({ ...e, change: "removed" })),
  ].map((e) => ({ ...e, class: classifyPath(e.path, opts) }));
  const files = (cls) => changed.filter((e) => e.class === cls && e.type !== "dir" && e.change !== "removed").map((e) => e.path);
  const removed = (cls) => changed.filter((e) => e.class === cls && e.type !== "dir" && e.change === "removed").map((e) => e.path);
  return {
    changed,
    filesUnderRoot: files("under-root"),
    filesCwdOther: files("cwd-other"),
    filesCliHomeState: files("cli-home-state"),
    // Deletions are mutations too (A-neg forbids deleting). Kept apart from the `files*` lists,
    // which name files that EXIST after the arm (what a compliance arm or a declaration can
    // point at), so a removed path can never satisfy "the agent wrote X".
    removedUnderRoot: removed("under-root"),
    removedCwdOther: removed("cwd-other"),
    // The run's own staged inputs, changed or deleted during the arm. Reported for every arm;
    // A-neg counts it as a cwd mutation.
    stagedMutated: changed.filter((e) => e.class === "staged" && e.type !== "dir").map((e) => e.path),
    rootCreated: diff.added.some((e) => e.path === (opts.root ?? OUTPUT_ROOT)),
  };
}

/** Is anything at all present at or under `root` in a listing? (S-P0 / PC-1) */
export function presentUnder(entries, root = OUTPUT_ROOT) {
  return (entries ?? []).filter((e) => isUnder(e.path, root)).map((e) => e.path);
}

/** Which of `staged` a listing shows under `root`? (S-P1 / PC-2). */
export function stagedUnderRoot(entries, staged, root) {
  const seen = new Set((entries ?? []).map((e) => e.path));
  return staged.filter((p) => seen.has(p) && isUnder(p, root));
}

/** Trim a listing for the record; the count is always kept. */
export function listingForRecord(entries) {
  const list = entries ?? [];
  return { count: list.length, truncated: list.length > LISTING_RECORD_LIMIT, entries: list.slice(0, LISTING_RECORD_LIMIT) };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. The claude stream
// ─────────────────────────────────────────────────────────────────────────────

function jsonLines(stdout) {
  const out = [];
  for (const raw of String(stdout ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith("{")) continue;
    try {
      const ev = JSON.parse(line);
      if (ev && typeof ev === "object" && !Array.isArray(ev)) out.push(ev);
    } catch {
      /* not a frame */
    }
  }
  return out;
}

/**
 * Read what §10.4 asks for from claude's `stream-json` stdout: the `init` frame's
 * `permissionMode` and `cwd`, the FINAL `result` frame's text, and whether any model output
 * was seen (W7U1's `detectModelContactEvidence`, reused — an auth-failed CLI still emits
 * frames, so frames alone are not contact).
 */
export function readClaudeStream(stdout) {
  const events = jsonLines(stdout);
  const init = events.find((e) => e.type === "system" && e.subtype === "init") ?? null;
  const results = events.filter((e) => e.type === "result");
  const final = results.length > 0 ? results[results.length - 1] : null;
  const contact = detectModelContactEvidence(String(stdout ?? ""), "claude_local");
  return {
    frames: events.length,
    initSeen: init !== null,
    permissionMode: init && typeof init.permissionMode === "string" ? init.permissionMode : null,
    initCwd: init && typeof init.cwd === "string" ? init.cwd : null,
    finalResultSeen: final !== null,
    finalIsError: final ? final.is_error === true : null,
    finalResultText: final && typeof final.result === "string" ? final.result : null,
    modelContact: contact.reached,
    modelContactKind: contact.evidenceKind,
  };
}

/**
 * A-decl: does the FINAL `result` frame end with `AOA-OUTPUT: <relative path>`, and does
 * that path name a file the arm actually wrote under R? Only the final frame is parsed
 * (§9.2 A-O1-2: a tool-result echo of a hostile file must not count).
 */
export function readDeclaration(finalResultText, writtenUnderRoot, root = OUTPUT_ROOT) {
  const text = typeof finalResultText === "string" ? finalResultText.trim() : "";
  if (text.length === 0) return { present: false, declared: null, resolved: null, matchesWritten: false };
  const last = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0).pop() ?? "";
  const m = new RegExp(`^\`?${DECLARATION_PREFIX}\\s*(.+?)\`?$`).exec(last);
  if (!m) return { present: false, declared: null, resolved: null, matchesWritten: false };
  const declared = m[1].trim();
  // §10.4 asks for a RELATIVE path. An absolute path, `~`, a `..` segment, a backslash or an
  // empty segment is REFUSED rather than normalised: a declaration that may name anything
  // outside R is option 1's A-O1-1 attack, and accepting it would let R11 certify option 1b
  // on a form the contract does not allow.
  const segments = declared.replace(/^\.\//, "").split("/");
  const relative =
    !declared.startsWith("/") &&
    !declared.startsWith("~") &&
    !declared.includes("\\") &&
    segments.every((seg) => seg.length > 0 && seg !== "." && seg !== "..");
  if (!relative) return { present: true, declared, resolved: null, relative: false, matchesWritten: false };
  const resolved = `${root}/${segments.join("/")}`;
  return { present: true, declared, resolved, relative: true, matchesWritten: writtenUnderRoot.includes(resolved) };
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Per-arm verdicts. Each takes the arm's observation and returns
//    {arm, state, reason, findings}. `inconclusive` means "not a measurement" (§10.5 last row).
// ─────────────────────────────────────────────────────────────────────────────

const inconclusive = (arm, reason, findings = {}) => ({ arm, state: "inconclusive", reason, findings });
const observed = (arm, reason, findings) => ({ arm, state: "observed", reason, findings });
export const notRun = (arm, reason) => ({ arm, state: "not-run", reason, findings: {} });

/** A read or list outcome: `ok` | `not-found` | `faulted`. */
const usable = (o) => o === "ok" || o === "not-found";

/**
 * S-P0 (and S-PC1, which runs the SAME function after planting a file).
 * obs: {rootList: {outcome, entries}, rootRead: {outcome}, home: {outcome, entries}}
 */
export function verdictRootPresence(arm, obs) {
  const o = obs ?? {};
  // A read of R faults when R is a DIRECTORY on some SDK paths; if the listing already saw R,
  // that fault changes nothing. It is only disqualifying when it is the sole evidence.
  const readUsable = usable(o.rootRead?.outcome) || o.rootList?.outcome === "ok";
  if (!usable(o.rootList?.outcome) || !readUsable || o.home?.outcome !== "ok") {
    return inconclusive(arm, "a-read-or-list-faulted", {
      rootList: o.rootList?.outcome ?? null,
      rootRead: o.rootRead?.outcome ?? null,
      home: o.home?.outcome ?? null,
    });
  }
  const underInHome = presentUnder(o.home.entries);
  const present = o.rootList.outcome === "ok" || o.rootRead.outcome === "ok" || underInHome.length > 0;
  return observed(arm, present ? "root-present" : "root-absent", {
    present,
    rootListOutcome: o.rootList.outcome,
    rootReadOutcome: o.rootRead.outcome,
    presentPaths: [...new Set([...(o.rootList.entries ?? []).map((e) => e.path), ...underInHome])].sort(),
  });
}

/**
 * S-P1 and its mutant S-PC2. obs: {home: {outcome, entries}, staged: string[], root}
 * The listing must SEE the staging, or it cannot vouch for anything being absent from R.
 */
export function verdictStaged(arm, obs) {
  const o = obs ?? {};
  if (o.home?.outcome !== "ok") return inconclusive(arm, "home-listing-faulted", {});
  const seen = new Set(o.home.entries.map((e) => e.path));
  const unseen = (o.staged ?? []).filter((p) => !seen.has(p));
  if (unseen.length > 0) return inconclusive(arm, "listing-does-not-show-the-staged-set", { unseen });
  const under = stagedUnderRoot(o.home.entries, o.staged, o.root);
  return observed(arm, under.length > 0 ? "staged-paths-under-root" : "no-staged-path-under-root", {
    root: o.root,
    stagedUnderRoot: under,
  });
}

/**
 * S-P2. obs: {defaultList:{outcome,entries}, deepList:{outcome,entries}, reads:[{path, outcome, bytes, expected}],
 *            transportListDir:{outcome, paths, error}}
 */
export function verdictDepthAndType(obs) {
  const o = obs ?? {};
  if (o.defaultList?.outcome !== "ok" || o.deepList?.outcome !== "ok") return inconclusive("S-P2", "listing-faulted", {});
  if ((o.reads ?? []).some((r) => r.outcome !== "ok")) return inconclusive("S-P2", "read-faulted", { reads: o.reads });
  const defaultDirs = o.defaultList.entries.filter((e) => e.type === "dir").map((e) => e.path);
  const deepPaths = o.deepList.entries.map((e) => e.path);
  return observed("S-P2", "listed", {
    defaultDepthIncludesDirs: defaultDirs.length > 0,
    defaultDepthDirs: defaultDirs,
    defaultDepthReachesNested: o.defaultList.entries.some((e) => e.path === `${OUTPUT_ROOT}/sub/b.txt`),
    deepReachesNested: deepPaths.includes(`${OUTPUT_ROOT}/sub/b.txt`),
    readsMatch: (o.reads ?? []).every((r) => r.bytes === r.expected),
    transportListDir: o.transportListDir ?? null,
  });
}

/** S-P3. obs: {viaRunCommand:{channel, exitCode, read}, viaProviderExecute:{channel, exitCode, read}} */
export function verdictNonZeroExit(obs) {
  const o = obs ?? {};
  const legs = { viaRunCommand: o.viaRunCommand, viaProviderExecute: o.viaProviderExecute };
  for (const [k, leg] of Object.entries(legs)) {
    // S-P3 claims "a file survives a NON-ZERO EXIT", so a leg counts only when a non-zero exit
    // was OBSERVED: the command returned, with a numeric exit code other than 0. Codex review
    // (PR #551), twice. A timed-out leg observed no exit (the file may predate the deadline); a
    // leg that THREW carries no verifiable exit code; a returned exit 0 is not the case under
    // test. Each is inconclusive and names which it was.
    if (!leg || leg.channel !== "returned") {
      return inconclusive("S-P3", `${k}-channel-${String(leg?.channel)}`, {});
    }
    if (typeof leg.exitCode !== "number" || leg.exitCode === 0) {
      return inconclusive("S-P3", `${k}-no-non-zero-exit-observed(${String(leg.exitCode)})`, {});
    }
    if (leg.read?.outcome !== "ok" && leg.read?.outcome !== "not-found") return inconclusive("S-P3", `${k}-read-faulted`, {});
  }
  const leg = (l) => ({
    returnedNotThrew: l.channel === "returned",
    exitCode: l.exitCode,
    fileSurvived: l.read.outcome === "ok" && l.read.content === l.expected,
  });
  return observed("S-P3", "exited", { viaRunCommand: leg(o.viaRunCommand), viaProviderExecute: leg(o.viaProviderExecute) });
}

/**
 * S-P4. obs: {channel, exitCode, stdout, stderr, marker, dirBefore, target:{outcome, content}}
 *
 * ★★★ AN EMPTY STDOUT IS NOT EVIDENCE — the command's stdout is REDIRECTED, so it is empty in
 * both worlds (Codex review, PR #551). The arm is read from three things instead: the redirect
 * target directory must have been ABSENT beforehand (otherwise the whole setup is wrong and the
 * arm says so), the redirect target file must not hold the marker afterwards, and the exit must
 * be non-zero. A zero exit with no marker anywhere is INCONCLUSIVE, not a pass.
 */
export function verdictUnwritableRedirect(obs) {
  const o = obs ?? {};
  // Only a RETURNED command with a numeric exit code is evidence the shell reached the redirect.
  // A transport throw (network, sandbox) shows nothing about the redirect at all, and
  // `null !== 0` must not read as "failed closed" (Codex review, PR #551). The real transport
  // returns a non-zero exit rather than throwing (E7-F014), so a throw here is a fault.
  if (o.channel !== "returned") return inconclusive("S-P4", `channel-${String(o.channel)}`, {});
  if (typeof o.exitCode !== "number") return inconclusive("S-P4", `no-exit-code(${String(o.exitCode)})`, {});
  // The premise: the redirect target's directory does not exist. If it does, this arm is not
  // measuring an unwritable redirect at all — pick another path and re-run.
  if (o.dirBefore !== undefined && o.dirBefore !== "not-found") {
    return inconclusive("S-P4", `redirect-target-directory-is-${String(o.dirBefore)}`, {});
  }
  if (o.target?.outcome === "faulted") return inconclusive("S-P4", "target-read-faulted", {});
  const marker = String(o.marker ?? "");
  const inStdout = String(o.stdout ?? "").includes(marker);
  const inTarget = o.target?.outcome === "ok" && String(o.target.content ?? "").includes(marker);
  const ran = inStdout || inTarget;
  if (ran) {
    return observed("S-P4", "command-ran-despite-redirect", {
      channel: o.channel,
      exitCode: o.exitCode,
      commandRan: true,
      markerSeenIn: inTarget ? "redirect-target" : "stdout",
      failedClosed: false,
      stderr: String(o.stderr ?? "").slice(0, 400),
    });
  }
  if (o.exitCode === 0) {
    // Exit 0, no marker on stdout and none in the target: the command reported success and left
    // nothing this probe can see. That is not "the redirect failed first".
    return inconclusive("S-P4", "exit-0-with-no-marker-anywhere", { exitCode: 0, targetOutcome: o.target?.outcome ?? null });
  }
  return observed("S-P4", "redirect-failed-before-command", {
    channel: o.channel,
    exitCode: o.exitCode,
    commandRan: false,
    failedClosed: true,
    targetOutcome: o.target?.outcome ?? null,
    stderr: String(o.stderr ?? "").slice(0, 400),
  });
}

/** S-P5. obs: {list:{outcome, entries}, readL1:{outcome, bytes, equalsPrompt}, transportListDir} */
export function verdictSymlinks(obs) {
  const o = obs ?? {};
  if (o.list?.outcome !== "ok") return inconclusive("S-P5", "listing-faulted", {});
  if (o.readL1?.outcome === "faulted") return inconclusive("S-P5", "read-faulted", {});
  const pick = (name) => o.list.entries.find((e) => e.path === `${OUTPUT_ROOT}/${name}`) ?? null;
  const l1 = pick("l1");
  const l2 = pick("l2");
  const exposes = (e) => e !== null && (e.symlinkTarget !== null || (e.type !== "file" && e.type !== "dir"));
  return observed("S-P5", "listed", {
    l1: l1,
    l2: l2,
    listExposesLink: exposes(l1) && exposes(l2),
    readFollowsLink: o.readL1?.outcome === "ok" && o.readL1.equalsPrompt === true,
    readL1Outcome: o.readL1?.outcome ?? null,
    deepListingCount: o.list.entries.length,
    transportListDir: o.transportListDir ?? null,
  });
}

/** S-P6. obs: {list:{outcome, entries}, read:{outcome, bytes, ms}, expectedBytes, shaMatches} */
export function verdictSizeMetadata(obs) {
  const o = obs ?? {};
  if (o.list?.outcome !== "ok" || o.read?.outcome !== "ok") return inconclusive("S-P6", "list-or-read-faulted", {});
  const big = o.list.entries.find((e) => e.path === `${OUTPUT_ROOT}/big.bin`) ?? null;
  return observed("S-P6", "measured", {
    listSize: big?.size ?? null,
    expectedBytes: o.expectedBytes,
    listSizeMatches: big?.size === o.expectedBytes,
    readBytes: o.read.bytes,
    readMs: o.read.ms,
    shaMatches: o.shaMatches === true,
  });
}

/** S-P7. obs: {channel, envSeenByShell: boolean, read:{outcome, content}, nonce} */
export function verdictEnvSecret(obs) {
  const o = obs ?? {};
  if (o.channel !== undefined && o.channel !== "returned") return inconclusive("S-P7", `channel-${String(o.channel)}`, {});
  if (o.envSeenByShell !== true) return inconclusive("S-P7", "canary-env-did-not-reach-the-sandbox", {});
  if (o.read?.outcome !== "ok") return inconclusive("S-P7", "read-faulted-or-missing", { readOutcome: o.read?.outcome ?? null });
  const present = String(o.read.content ?? "").includes(o.nonce);
  return observed("S-P7", present ? "nonce-exported-in-file-bytes" : "nonce-absent", { noncePresent: present });
}

/**
 * The live census control that precedes A-neg (C-census): a SHELL write under R and one in
 * the cwd must both appear in the census diff. If they do not, A-neg's "nothing written"
 * could be the census being blind, and A-neg is not a measurement.
 * obs: {delta (from censusDelta), expectRoot, expectCwd}
 */
export function verdictCensusControl(obs) {
  const d = obs?.delta;
  if (!d) return inconclusive("C-census", "no-census", {});
  const sawRoot = d.filesUnderRoot.includes(obs.expectRoot);
  const sawCwd = d.filesCwdOther.includes(obs.expectCwd);
  if (!sawRoot || !sawCwd) return inconclusive("C-census", "census-did-not-see-a-planted-write", { sawRoot, sawCwd });
  return observed("C-census", "census-sees-planted-writes", { sawRoot, sawCwd });
}

/**
 * The common gate of a model arm. It is NOT a measurement unless the CLI ran to a return
 * and a model actually answered (§3.8: an auth-failed CLI still emits frames).
 */
function modelArmGate(arm, obs, positiveSignal = false) {
  if (obs?.cli?.present !== true) return inconclusive(arm, "template-without-cli");
  if (obs.keyPresent !== true) return inconclusive(arm, "no-model-provider-key");
  if (obs.census?.before?.outcome !== "ok" || obs.census?.after?.outcome !== "ok") return inconclusive(arm, "census-listing-faulted");
  if (obs.exec?.channel !== "returned") return inconclusive(arm, `exec-${String(obs.exec?.channel)}`);
  if (!obs.stream?.modelContact) return inconclusive(arm, "no-model-contact-evidence");
  // ★★★ A FAILED RUN IS NOT A NEGATIVE RESULT — but it can still carry a POSITIVE one.
  // Codex review (PR #551). The CLI can reach a model and then fail during a tool call or at
  // finalisation. Reading "no file appeared" off such a run is a false negative, and the rows it
  // feeds are the dangerous ones: R10's "neither writes" is outcome (iii). So a non-zero exit, or
  // a final `result` frame with `is_error`, makes the arm INCONCLUSIVE — unless the arm already
  // holds its positive signal (a file it was looking for exists), because a write that happened
  // before the failure is real evidence and PC-10 is exactly the "output survives a non-zero
  // exit" case.
  const failed = obs.exec?.exitCode !== 0 || obs.stream?.finalIsError === true;
  if (failed && !positiveSignal) {
    return inconclusive(arm, `failed-run-without-a-positive-signal(exit=${String(obs.exec?.exitCode)},finalIsError=${String(obs.stream?.finalIsError)})`);
  }
  return null;
}

/**
 * A-neg — the CLI self-write census (W2). obs: {cli, keyPresent, census:{before,after}, delta, stream, exec}
 */
export function verdictANeg(obs) {
  const d = obs?.delta;
  const removedUnderRoot = d?.removedUnderRoot ?? [];
  const cwdMutations = [...(d?.removedCwdOther ?? []), ...(d?.stagedMutated ?? [])];
  // A-neg's positive signal is a MUTATION: the CLI wrote or deleted something. That survives a
  // failed exit; "nothing happened" does not.
  const mutated =
    (d?.filesUnderRoot?.length ?? 0) > 0 ||
    removedUnderRoot.length > 0 ||
    (d?.filesCwdOther?.length ?? 0) > 0 ||
    cwdMutations.length > 0;
  const gate = modelArmGate("A-neg", obs, mutated);
  if (gate) return gate;
  const reason =
    d.filesUnderRoot.length > 0 || removedUnderRoot.length > 0
      ? "cli-mutated-under-root"
      : d.filesCwdOther.length > 0 || cwdMutations.length > 0
        ? "cli-mutated-cwd"
        : "nothing-under-root-or-cwd";
  return observed("A-neg", reason, {
    filesUnderRoot: d.filesUnderRoot,
    removedUnderRoot,
    filesCwdOther: d.filesCwdOther,
    // Deleted cwd files and changed/deleted staged inputs: the prompt forbade both.
    cwdMutations,
    filesCliHomeState: d.filesCliHomeState,
    permissionMode: obs.stream.permissionMode,
    initCwd: obs.stream.initCwd,
    exitCode: obs.exec.exitCode,
    finalIsError: obs.stream.finalIsError,
  });
}

/**
 * A-dir / A-cwd / A-decl. obs adds {nonce, helloAtRoot:{outcome, content}, helloElsewhere: string[]}
 */
export function verdictCompliance(arm, obs) {
  // The compliance arms' positive signal is the deliverable itself: if `R/hello.txt` holds the
  // arm's nonce, the placement question is answered whatever the exit code did afterwards.
  const wroteAtRoot = obs?.helloAtRoot?.outcome === "ok" && String(obs.helloAtRoot.content ?? "").includes(obs.nonce);
  // ★ A-decl ASKS FOR MORE THAN A FILE, so the file alone is not its positive signal. Codex
  // review (PR #551): a run that wrote the file and then died before producing a valid final
  // declaration would otherwise be `observed` with the declaration recorded as absent, and R11
  // would report option 1b infeasible on a run that never got to try. A-decl's signal is the
  // file AND a final-frame declaration that resolves to it; anything less, on a failed run, is
  // inconclusive.
  // ★ AND IT MUST DECLARE THE REQUESTED FILE. Codex review (PR #551), second pass: an agent that
  // wrote `hello.txt` plus a scratch file and declared the SCRATCH one satisfied
  // "declaration.matchesWritten" (any written path), so option 1b would be certified on a
  // declaration that does not name the deliverable. `matchesRequested` compares the resolved
  // declaration with `R/hello.txt` itself.
  const declaration = arm === "A-decl" ? readDeclaration(obs?.stream?.finalResultText, obs?.delta?.filesUnderRoot ?? []) : null;
  if (declaration) declaration.matchesRequested = declaration.resolved === `${OUTPUT_ROOT}/${HELLO_FILE}`;
  const positiveSignal =
    arm === "A-decl" ? wroteAtRoot && declaration.present && declaration.matchesWritten && declaration.matchesRequested : wroteAtRoot;
  const gate = modelArmGate(arm, obs, positiveSignal);
  if (gate) return gate;
  if (obs.helloAtRoot?.outcome === "faulted") return inconclusive(arm, "read-faulted");
  const d = obs.delta;
  const helloPath = `${OUTPUT_ROOT}/${HELLO_FILE}`;
  const findings = {
    wroteHelloAtRoot: wroteAtRoot,
    helloElsewhere: obs.helloElsewhere ?? [],
    rootCreatedDuringArm: d.rootCreated,
    otherFilesUnderRoot: d.filesUnderRoot.filter((p) => p !== helloPath),
    filesCwdOther: d.filesCwdOther,
    filesCliHomeState: d.filesCliHomeState,
    permissionMode: obs.stream.permissionMode,
    initCwd: obs.stream.initCwd,
    exitCode: obs.exec.exitCode,
    finalIsError: obs.stream.finalIsError,
  };
  if (arm === "A-decl") {
    findings.declaration = declaration;
    findings.finalResultSeen = obs.stream.finalResultSeen;
  }
  return observed(arm, wroteAtRoot ? "wrote-hello-under-root" : "did-not-write-hello-under-root", findings);
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. §10.5's decision table, row by row
// ─────────────────────────────────────────────────────────────────────────────

const byArm = (verdicts) => new Map(verdicts.map((v) => [v.arm, v]));
const UNDECIDABLE = "undecidable";

function row(id, result, reading, fired, because) {
  return { id, result, reading, fired, because };
}

/**
 * Evaluate EVERY row of §10.5. Each row is `fired: true | false | "undecidable"` with the
 * arm facts it read — so the durable record answers each row, not just the disposition.
 * A row is undecidable only when an arm it reads is `inconclusive` or `not-run`, and it
 * says which.
 * @param {{arm: string, state: string, findings: object}[]} verdicts
 */
export function evaluateDecisionTable(verdicts, mode = "all") {
  const v = byArm(verdicts);
  const need = (...arms) => {
    const missing = arms.filter((a) => v.get(a)?.state !== "observed");
    return missing.length === 0 ? null : `${missing.map((a) => `${a}=${v.get(a)?.state ?? "absent"}`).join(", ")}`;
  };
  const f = (a) => v.get(a)?.findings ?? {};
  const rows = [];

  let m = need("S-P0");
  rows.push(row("R1", "S-P0 non-empty for R", "choose another R and re-run S-P0; do not rule until a template-empty R exists",
    m ? UNDECIDABLE : f("S-P0").present === true, m ?? `present=${f("S-P0").present} paths=${JSON.stringify(f("S-P0").presentPaths)}`));

  m = need("S-P2");
  rows.push(row("R2", "S-P2 shows directory entries at default depth", "confirms §3.3; CLI-010 must implement files-only recursion",
    m ? UNDECIDABLE : f("S-P2").defaultDepthIncludesDirs === true, m ?? `defaultDepthDirs=${JSON.stringify(f("S-P2").defaultDepthDirs)}`));

  m = need("S-P5");
  rows.push(row("R3", "S-P5: list does not expose symlinkTarget/type, and read follows links", "CLI-012 must refuse by a second means (per-entry lstat); +1 day on the emit build",
    m ? UNDECIDABLE : f("S-P5").listExposesLink === false && f("S-P5").readFollowsLink === true,
    m ?? `listExposesLink=${f("S-P5").listExposesLink} readFollowsLink=${f("S-P5").readFollowsLink}`));

  m = need("S-P7");
  rows.push(row("R4", "S-P7 nonce present", "SD-5 moves to required before M1b's campaign; otherwise A-O2-5 is a residual with an owner",
    m ? UNDECIDABLE : f("S-P7").noncePresent === true, m ?? `noncePresent=${f("S-P7").noncePresent}`));

  m = need("A-neg");
  const aNegUnderRoot = m ? null : f("A-neg").filesUnderRoot.length > 0 || f("A-neg").removedUnderRoot.length > 0;
  // The second clause: files also under a DIRECTIVE-only R — A-dir's R holding anything but hello.txt.
  const mDir = need("A-dir");
  const alsoUnderDirective = mDir ? null : f("A-dir").otherFilesUnderRoot.length > 0;
  rows.push(row("R5", "A-neg finds files under R", "SD-1a is refuted; if files also appear under a directive-only R, option 2 is refuted -> outcome (iii)",
    m ? UNDECIDABLE : aNegUnderRoot,
    m ?? `filesUnderRoot=${JSON.stringify(f("A-neg").filesUnderRoot)} removedUnderRoot=${JSON.stringify(f("A-neg").removedUnderRoot)}; directive-only R extra files=${mDir ? `undecidable (${mDir})` : JSON.stringify(f("A-dir").otherFilesUnderRoot)}${aNegUnderRoot && alsoUnderDirective ? " -> OPTION 2 REFUTED" : ""}`));

  rows.push(row("R6", "A-neg: nothing under R or cwd", "6.7 holds for option 2",
    m ? UNDECIDABLE : v.get("A-neg").reason === "nothing-under-root-or-cwd",
    m ?? `filesUnderRoot=${f("A-neg").filesUnderRoot.length} removedUnderRoot=${f("A-neg").removedUnderRoot.length} filesCwdOther=${JSON.stringify(f("A-neg").filesCwdOther)} cwdMutations=${JSON.stringify(f("A-neg").cwdMutations)} (cli-home-state, reported not counted: ${f("A-neg").filesCliHomeState.length})`));

  const mc = need("A-dir", "A-cwd");
  const dirW = mc ? null : f("A-dir").wroteHelloAtRoot === true;
  const cwdW = mc ? null : f("A-cwd").wroteHelloAtRoot === true;
  const both = `A-dir=${dirW} A-cwd=${cwdW}`;
  rows.push(row("R7", "A-dir writes R/hello.txt; A-cwd writes R/hello.txt", "both placements viable; choose by pin cost: SD-1b recommended",
    mc ? UNDECIDABLE : dirW && cwdW, mc ?? both));
  rows.push(row("R8", "only A-cwd writes", "SD-1a (pins 1+2 move; the keyed unit-d lane auto-fires, §3.7)",
    mc ? UNDECIDABLE : !dirW && cwdW, mc ?? both));
  rows.push(row("R9", "only A-dir writes", "SD-1b", mc ? UNDECIDABLE : dirW && !cwdW, mc ?? both));
  rows.push(row("R10", "neither writes the file into R", "option 2 has no compliant placement on the evidence -> outcome (iii)",
    mc ? UNDECIDABLE : !dirW && !cwdW, mc ?? `${both}; A-cwd hello elsewhere=${mc ? "" : JSON.stringify(f("A-cwd").helloElsewhere)}`));

  m = need("A-decl");
  rows.push(row("R11", "A-decl carries a correct line", "option 1b is feasible; recorded for a post-M1b refinement",
    m
      ? UNDECIDABLE
      : f("A-decl").declaration?.present === true &&
        f("A-decl").declaration?.matchesWritten === true &&
        f("A-decl").declaration?.matchesRequested === true,
    m ?? `declaration=${JSON.stringify(f("A-decl").declaration)}`));

  // R12 is the pack's own disposition: an inconclusive arm, a missing arm, or a control that did
  // not produce its expected negative all make the run "not a measurement".
  const d = packDisposition(verdicts, evaluateControls(verdicts), mode);
  rows.push(row("R12", "any arm inconclusive (no key, template without the CLIs, a timeout), or a control did not hold", "not a measurement; re-dispatch; never rule on it",
    d.disposition !== "measured", d.detail));

  return rows;
}

/**
 * The positive controls. Each expects the NEGATIVE outcome, so the probe is shown able to
 * produce it. A control that did not go the expected way means the apparatus cannot
 * distinguish, and the whole pack is inconclusive — whatever the other arms say.
 *
 *   PC-1 (§8): plant a file in R before any exec -> the S-P0 check must report present.
 *   PC-2 (§8): the S-P1 check with R = /home/user -> must return the staged paths.
 *   C-census : a shell write under R and in cwd -> the census diff must see both (A-neg's control).
 */
export function evaluateControls(verdicts) {
  const v = byArm(verdicts);
  const ctl = (id, arm, expectation, held) => {
    const x = v.get(arm);
    if (!x || x.state === "not-run") return { id, arm, expectation, held: "not-run" };
    if (x.state !== "observed") return { id, arm, expectation, held: false, because: `${arm} ${x.state}: ${x.reason}` };
    return { id, arm, expectation, held: held(x.findings) };
  };
  return [
    ctl("PC-1", "S-PC1", "a planted file in R is reported present", (x) => x.present === true),
    ctl("PC-2", "S-PC2", "with R = /home/user the staged paths are found under R", (x) => (x.stagedUnderRoot ?? []).length === 3),
    ctl("C-census", "C-census", "the census sees a planted write under R and in cwd", (x) => x.sawRoot === true && x.sawCwd === true),
  ];
}

/**
 * `measured` only when every arm that was asked to run is `observed` AND every control that
 * ran held. `shell-only` mode legitimately marks the model arms `not-run`.
 */
export function packDisposition(verdicts, controls, mode = "all") {
  const inconc = verdicts.filter((x) => x.state === "inconclusive");
  const unexpectedNotRun = verdicts.filter((x) => x.state === "not-run" && !(mode === "shell-only" && (MODEL_ARMS.includes(x.arm) || x.arm === "C-census")));
  const failed = controls.filter((c) => c.held === false);
  const expectedArms = mode === "shell-only" ? SHELL_ARMS : [...SHELL_ARMS, "C-census", ...MODEL_ARMS];
  const missing = expectedArms.filter((a) => !verdicts.some((x) => x.arm === a));
  if (inconc.length || unexpectedNotRun.length || failed.length || missing.length) {
    return {
      disposition: "inconclusive",
      detail: [
        inconc.length ? `inconclusive arms: ${inconc.map((x) => `${x.arm}(${x.reason})`).join(", ")}` : "",
        unexpectedNotRun.length ? `arms not run: ${unexpectedNotRun.map((x) => x.arm).join(", ")}` : "",
        failed.length ? `controls that did not hold: ${failed.map((c) => c.id).join(", ")}` : "",
        missing.length ? `arms with no verdict: ${missing.join(", ")}` : "",
      ].filter(Boolean).join("; "),
    };
  }
  return { disposition: "measured", detail: mode === "shell-only" ? "every P-011a arm observed and every control held; P-011b NOT run (shell-only)" : "every arm observed and every control held" };
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. The durable record and its rendering
// ─────────────────────────────────────────────────────────────────────────────

export class ProbeRecordError extends Error {
  constructor(detail) {
    super(`CLI-011 probe record: ${detail}`);
    this.name = "ProbeRecordError";
  }
}

/**
 * Build the record. It REFUSES a record that does not say which image answered (E7-F022),
 * and it is redacted by the caller on the way to disk.
 */
export function buildProbeRecord({ verdicts, controls, decisionTable, disposition, template, templateSource, armsMode, commitSha, runNonce, generatedAt, workflowRunUrl, armEvidence = [], sandboxes = [] }) {
  if (typeof template !== "string" || template.length === 0) throw new ProbeRecordError("no resolved template");
  if (!Array.isArray(decisionTable) || decisionTable.length === 0) throw new ProbeRecordError("no decision table");
  return {
    schema: PROBE_RECORD_SCHEMA,
    generatedAt,
    commitSha,
    workflowRunUrl,
    runNonce,
    template: { resolved: template, source: templateSource },
    armsMode,
    outputRoot: OUTPUT_ROOT,
    classification: { cliHomeStatePrefixes: CLI_HOME_STATE_PREFIXES, censusDepth: CENSUS_DEPTH },
    disposition,
    controls,
    decisionTable,
    verdicts,
    armEvidence,
    sandboxes,
  };
}

export function renderReport({ verdicts, controls, decisionTable, disposition, template, templateSource, armsMode, commitSha, runNonce }) {
  const L = [];
  L.push("================ CLI-011 P-011 OUTPUT PROBE — RESULT ================");
  L.push(`TEMPLATE: ${template} (${templateSource})   arms: ${armsMode}   R = ${OUTPUT_ROOT}`);
  L.push(`commit: ${commitSha}   run nonce: ${runNonce}`);
  L.push("");
  L.push("Controls (each expects the NEGATIVE outcome):");
  for (const c of controls) L.push(`  ${c.id.padEnd(9)} held=${String(c.held)}  ${c.expectation}${c.because ? ` — ${c.because}` : ""}`);
  L.push("");
  L.push("Arms:");
  for (const x of verdicts) L.push(`  ${x.arm.padEnd(9)} ${x.state.padEnd(12)} ${x.reason}`);
  L.push("");
  L.push("§10.5 decision table:");
  for (const r of decisionTable) L.push(`  ${r.id.padEnd(4)} fired=${String(r.fired).padEnd(11)} ${r.result}\n         -> ${r.reading}\n         because: ${r.because}`);
  L.push("");
  L.push(`DISPOSITION: ${disposition.disposition} — ${disposition.detail}`);
  L.push("Only `inconclusive` reds this lane. Every row above is a result.");
  L.push("====================================================================");
  return L.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. The workflow's shape, checked in `policy` on every PR
// ─────────────────────────────────────────────────────────────────────────────

/** Extract the step block containing line `i`, bounded by indentation. */
function stepBlockAround(lines, i) {
  let start = i;
  while (start >= 0 && !/^\s*-\s/.test(lines[start])) start -= 1;
  if (start < 0) start = i;
  const indent = (lines[start].match(/^(\s*)-/) || [, ""])[1].length;
  let end = start + 1;
  while (end < lines.length) {
    const l = lines[end];
    if (l.trim() !== "" && l.match(/^(\s*)/)[1].length <= indent) break;
    end += 1;
  }
  return lines.slice(start, end).join("\n");
}

const GUARDED_IF = /(^|\n)\s*if:[^\n]*always\(\)/;
export const WORKFLOW_ALLOWED_SECRETS = Object.freeze(["ANTHROPIC_API_KEY", "E2B_API_KEY"]);
export const RECORD_ARTIFACT_NAME = "cli-011-output-probe-record";
export const PROBE_TEST_PATH = "src/__tests__/keyed-cli-011-output-probe.test.ts";
/** The lane's own path: the ONLY `push` path E6-D001's registration shape allows. */
export const WORKFLOW_PATH = ".github/workflows/keyed-e2b-cli-011-output-probe.yml";
export const REGISTRATION_BRANCH = "docs/replatform-program";
/** The job-level gate every job must carry, verbatim (E6-D001 rule 2). */
export const DISPATCH_ONLY_IF = "github.event_name == 'workflow_dispatch'";

/**
 * The `jobs:` map as `{name, ifExpr}` — read by indentation from the raw YAML, the same
 * technique `extractOnBlock` uses. A job's `if:` is the one at the job's own key depth + 2.
 */
export function readJobGates(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (start === -1) return [];
  const jobs = [];
  let current = null;
  for (let i = start + 1; i < lines.length; i += 1) {
    const l = lines[i];
    if (/^\S/.test(l)) break;
    const job = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(l);
    if (job) {
      current = { name: job[1], ifExpr: null };
      jobs.push(current);
      continue;
    }
    const cond = /^ {4}if:\s*(.+?)\s*$/.exec(l);
    if (cond && current && current.ifExpr === null) {
      current.ifExpr = cond[1].replace(/^\$\{\{\s*(.*?)\s*\}\}$/, "$1").replace(/^(["'])(.*)\1$/, "$2");
    }
  }
  return jobs;
}

/**
 * Is `keyed-e2b-cli-011-output-probe.yml` still the lane the brief and §10.2 describe?
 *
 *  - DISPATCH ONLY. §3.7 measured that a path-filtered push trigger auto-spends E2B on
 *    merge; this lane must spend only when an operator dispatches it.
 *  - Secrets: E2B + Anthropic only (codex is excluded; no OPENAI key), and each secret is
 *    only ever bound to an env var — never interpolated into a `run:` script.
 *  - An `always()` record writer, an `always()` upload of the named artifact (90 days), an
 *    `always()` skip guard on the E2B key, `timeout-minutes: 45`, `contents: read`.
 *  - The shell fallback's template default and schema agree with this module.
 * @returns {{violations: {code: string, detail: string}[]}}
 */
export function evaluateWorkflowShape(workflowText) {
  const text = String(workflowText ?? "");
  const lines = text.split(/\r?\n/);
  const violations = [];
  const v = (code, detail) => violations.push({ code, detail });

  let triggers = {};
  try {
    triggers = describeWorkflow(text).triggers ?? {};
  } catch (e) {
    v("on-block-unreadable", String(e?.message ?? e));
  }
  // ★ E6-D001's REGISTRATION shape, applied to this lane by the planning session (F2). A
  // `workflow_dispatch`-only file that is not on the default branch answers HTTP 404 to a
  // dispatch until it has run once, and `main` may not change before M5. So the lane carries a
  // push trigger that only REGISTERS it: branch = the program branch, paths = this file and
  // nothing else, and every job gated to dispatch — a push-created run executes zero steps and
  // reads zero secrets. Everything else stays refused: §3.7 measured that a path-filtered push
  // on a code path spends E2B on merge.
  const keys = Object.keys(triggers);
  if (!keys.includes("workflow_dispatch")) v("not-dispatchable", "no `workflow_dispatch` trigger");
  const extra = keys.filter((k) => k !== "workflow_dispatch" && k !== "push");
  if (extra.length > 0) v("non-dispatch-trigger", `triggers other than workflow_dispatch and the registration push: ${extra.join(", ")} — any of them can spend E2B money (and model tokens) without an operator dispatch (review §3.7)`);
  if (!keys.includes("push")) {
    v("registration-push-missing", "no registration `push` trigger: a dispatch-only file off the default branch is never registered and answers 404 (E6-D001)");
  } else {
    const push = triggers.push && typeof triggers.push === "object" ? triggers.push : null;
    if (!push) v("push-unrestricted", "the `push` trigger has no filters: every push to every branch would create a run");
    else {
      const pkeys = Object.keys(push);
      const otherFilters = pkeys.filter((k) => k !== "branches" && k !== "paths");
      if (otherFilters.length > 0) v("push-other-filter", `push filters other than branches/paths: ${otherFilters.join(", ")}`);
      const paths = Array.isArray(push.paths) ? push.paths.map(String) : null;
      if (!paths) v("push-without-paths", "the registration push has no `paths` restriction: any change on the branch would create a run");
      else if (paths.length !== 1 || paths[0] !== WORKFLOW_PATH) v("push-extra-paths", `push paths must be exactly [${WORKFLOW_PATH}], got ${JSON.stringify(paths)}`);
      const branches = Array.isArray(push.branches) ? push.branches.map(String) : null;
      if (!branches || branches.length !== 1 || branches[0] !== REGISTRATION_BRANCH) v("push-branch", `push branches must be exactly [${REGISTRATION_BRANCH}], got ${JSON.stringify(branches)}`);
    }
  }
  const jobs = readJobGates(text);
  if (jobs.length === 0) v("jobs-unreadable", "no jobs were read, so no job gate could be checked");
  for (const j of jobs) {
    if (j.ifExpr !== DISPATCH_ONLY_IF) v("job-not-dispatch-gated", `job \`${j.name}\` must carry exactly \`if: ${DISPATCH_ONLY_IF}\` at job level (got ${JSON.stringify(j.ifExpr)}): a push-created run must execute zero steps`);
  }

  const secretRefs = [...text.matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map((m) => m[1]);
  const unknown = [...new Set(secretRefs)].filter((s) => !WORKFLOW_ALLOWED_SECRETS.includes(s));
  if (unknown.length > 0) v("secret-not-allowed", `secrets outside ${WORKFLOW_ALLOWED_SECRETS.join("/")}: ${unknown.join(", ")}`);
  for (const [i, l] of lines.entries()) {
    if (!/secrets\./.test(l) || /^\s*#/.test(l)) continue;
    if (!/^\s+[A-Z][A-Z0-9_]*:\s*\$\{\{\s*secrets\.[A-Z0-9_]+\s*\}\}\s*$/.test(l)) {
      v("secret-interpolated", `line ${i + 1} uses a secret other than as a bare env binding: ${l.trim()}`);
    }
  }
  if (!/\bE2B_API_KEY:\s*\$\{\{\s*secrets\.E2B_API_KEY/.test(text)) v("e2b-secret-missing", "E2B_API_KEY is never bound");
  if (!/\bANTHROPIC_API_KEY:\s*\$\{\{\s*secrets\.ANTHROPIC_API_KEY/.test(text)) v("anthropic-secret-missing", "ANTHROPIC_API_KEY is never bound");

  let upload = null;
  for (let i = 0; i < lines.length; i += 1) {
    if (!/uses:\s*actions\/upload-artifact/.test(lines[i])) continue;
    const block = stepBlockAround(lines, i);
    if (new RegExp(`name:\\s*${RECORD_ARTIFACT_NAME}\\s*$`, "m").test(block)) upload = block;
  }
  if (!upload) v("record-upload-missing", `no upload-artifact step named ${RECORD_ARTIFACT_NAME}`);
  else {
    if (!GUARDED_IF.test(upload)) v("record-upload-unguarded", "the record upload is not `if: always()`");
    if (!/retention-days:\s*90\b/.test(upload)) v("record-retention", "the record upload does not keep 90 days");
  }

  let fallback = false;
  let skipGuard = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\s*-\s/.test(lines[i])) continue;
    const block = stepBlockAround(lines, i);
    if (!GUARDED_IF.test(block) || !/(^|\n)\s*run:/.test(block)) continue;
    if (/CLI011_RECORD_PATH/.test(block) && /cat\s*>\s*"\$CLI011_RECORD_PATH"/.test(block)) fallback = true;
    if (/-z\s+"\$\{?E2B_API_KEY\}?"/.test(block) && /exit 1/.test(block)) skipGuard = true;
  }
  // The fallback heredoc must not interpolate an operator input raw into a JSON string: a `"` or
  // a newline in the template alias would make the one record a dead run leaves unparseable.
  // (A JSON value position: `": "${...}"`. A shell assignment `X="${...}"` is not one.)
  if (/":\s*"\$\{(RESOLVED_TEMPLATE|E2B_TEMPLATE_INPUT|ARMS_INPUT)[^}]*\}"/.test(text)) {
    v("fallback-unescaped-input", "the fallback record interpolates an operator input raw inside a JSON string; JSON-encode it first");
  }
  if (!fallback) v("record-fallback-missing", "no `always()` step writes a fallback record to $CLI011_RECORD_PATH");
  if (!skipGuard) v("skip-guard-missing", "no `always()` step fails the lane when E2B_API_KEY was empty (a skip is not a measurement)");

  if (!/^\s+timeout-minutes:\s*45\s*$/m.test(text)) v("job-timeout", "the job is not capped at `timeout-minutes: 45` (§10.2)");
  if (!/^permissions:\s*\n\s+contents:\s*read\s*$/m.test(text)) v("permissions", "top-level permissions are not `contents: read`");
  if (!text.includes(PROBE_TEST_PATH)) v("test-not-run", `the workflow does not run ${PROBE_TEST_PATH}`);

  const def = /CLI011_DEFAULT_TEMPLATE:\s*"?([A-Za-z0-9._-]+)"?/.exec(text);
  if (!def) v("default-template-undeclared", "CLI011_DEFAULT_TEMPLATE is not declared");
  else if (def[1] !== CLI_BEARING_TEMPLATE_ALIAS) v("default-template-mismatch", `CLI011_DEFAULT_TEMPLATE=${def[1]} but the core resolves an omitted input to ${CLI_BEARING_TEMPLATE_ALIAS}`);
  if (!text.includes(`"schema": "${PROBE_RECORD_SCHEMA}"`)) v("fallback-schema-mismatch", `the fallback record does not carry schema ${PROBE_RECORD_SCHEMA}`);
  return { violations };
}
