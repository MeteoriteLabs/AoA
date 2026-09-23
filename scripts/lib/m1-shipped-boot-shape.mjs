// -----------------------------------------------------------------------------
// m1-shipped-boot-shape — the workflow-SHAPE invariants of the DEP-015 shipped CI boot lane
// (`.github/workflows/m1-shipped-boot.yml`). PURE: text in, violations out.
//
// Founder ruling F3 (clarified by E6-D001) fixes what that lane may be: it RUNS only on dispatch —
// a push trigger may exist only to REGISTER it (the file's own path, every job skipped); bound to a
// NAMED candidate; building the three images FROM SOURCE at that candidate; a keypair
// generated IN the job. And the keyed spend is F8-gated. Each of those is a property of the
// workflow file, so each is checked here, on every PR, by `scripts/check-m1-shipped-boot-shape.mjs`
// — and each has a red in `scripts/check-m1-shipped-boot-shape.test.mjs` (a re-added `push:`
// trigger is the one the ticket names).
//
// The `on:` block is parsed with the dependency-free yaml-lite (the same idiom as
// scripts/check-ci-lanes.mjs); everything else is a line-level check, because yaml-lite does
// not model `steps:` (sequences of mappings) and a line check is what can be made to red.
// -----------------------------------------------------------------------------

import { parseYaml } from "./yaml-lite.mjs";

export const SHIPPED_BOOT_WORKFLOW = ".github/workflows/m1-shipped-boot.yml";
/** The only secrets the lane may read, and only through the keyed gate below. */
export const GATED_SECRETS = ["E2B_API_KEY", "ANTHROPIC_API_KEY"];
const GATED_SECRET_RE = /\$\{\{\s*inputs\.mode\s*==\s*'keyed'\s*&&\s*secrets\.([A-Z0-9_]+)\s*\|\|\s*''\s*\}\}/;
/** Review batch 3A (PR #569): the ACTIONS LOG is a published surface and had no scanner. Every
 * phase therefore pipes its output through `log-filter.mjs`, which CAPTURES the raw line into the
 * file the leak scan reads and PUBLISHES a shape-redacted line to the runner (Codex P1, PR #574:
 * a plain `tee` would publish an unregistered key before any scan could see it). */
export const JOB_LOG_TEE = ' 2>&1 | node scripts/m1-shipped-boot/log-filter.mjs "$M1_OUT/job-log.txt"';
/** The phases whose output must be teed. `leak-scan` reads the file and `teardown` deletes the
 * state, so neither writes to it; everything that could print a secret does. */
export const TEED_PHASES = [
  "prepare", "boot-core", "seed", "apply-rollout", "assert-tenants", "provision-targets",
  "boot-workers", "await-workers", "reconcile", "probe-presign", "dispatch", "collect",
];

/** The markers the CANDIDATE's own copy of the lane must carry, or its run would be judged by a
 * driver that predates these controls (Codex P1, PR #574). */
export const CANDIDATE_CONTROL_MARKERS = [
  ["scripts/m1-shipped-boot/journey.mjs", "CONTROL_PLANE_PUBLIC_KEY_PEM"],
  ["scripts/m1-shipped-boot/journey.mjs", "maskDirectivesFor"],
  ["scripts/m1-shipped-boot/journey.mjs", "stripMaskDirectives"],
  ["scripts/lib/m1-shipped-boot.mjs", "KEY_MATERIAL_MARKERS"],
  // The EXECUTABLE the workflow pipes every phase through: a candidate carrying the symbols but
  // not the file passes the greps above and then dies at the first phase on the missing module
  // (Codex P2, PR #574). The grep proves the file EXISTS and that it is the redacting filter.
  ["scripts/m1-shipped-boot/log-filter.mjs", "redactKeyMaterialLine"],
  // …and the FAIL-CLOSED arm of it: a candidate whose filter swallows a capture failure would
  // report a truncated job log as clean (Codex P1, PR #574).
  ["scripts/m1-shipped-boot/log-filter.mjs", "the job-log capture failed"],
];

export const EVIDENCE_UPLOAD_PATH = "${{ env.M1_OUT }}/evidence/";
/** E6-D001: the one branch the registration-only push may name. */
export const REGISTRATION_BRANCH = "docs/replatform-program";
export const DISPATCH_ONLY_IF = "if: github.event_name == 'workflow_dispatch'";

/** Each job under `jobs:` → whether its JOB-LEVEL (4-space) keys carry the dispatch-only `if`. */
export function jobDispatchGates(src) {
  const lines = src.split(/\r?\n/);
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (start === -1) return null;
  const jobs = {};
  let current = null;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\S/.test(line)) break;
    const job = /^  ([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (job) { current = job[1]; jobs[current] = false; continue; }
    if (current && /^    if:/.test(line)) jobs[current] = line.trim() === DISPATCH_ONLY_IF;
  }
  return jobs;
}

function topLevelBlock(text, key) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^${key}:(\\s|$)`).test(l));
  if (start === -1) return null;
  const block = [lines[start]];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\S/.test(lines[i]) && !/^#/.test(lines[i])) break;
    block.push(lines[i]);
  }
  return block.join("\n");
}

/**
 * @param {string} text the workflow file's text
 * @returns {{ violations: string[] }}
 */
export function evaluateShippedBootWorkflowShape(text) {
  const v = [];
  // Comment lines are removed before every text check: a lane whose header DESCRIBES a step it
  // no longer runs must not pass because the description matches.
  const src = String(text ?? "").replace(/^\s*#.*$/gm, "");

  // (1) Triggers: workflow_dispatch and NOTHING else.
  const onBlock = topLevelBlock(src, "on");
  let triggers = null;
  if (onBlock === null) {
    v.push("no top-level `on:` block");
  } else {
    try {
      triggers = parseYaml(onBlock).on;
    } catch (error) {
      v.push(`the \`on:\` block does not parse: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (triggers !== null && triggers !== undefined) {
    const names = typeof triggers === "string" ? [triggers] : Array.isArray(triggers) ? triggers.map(String) : Object.keys(triggers);
    for (const name of names) {
      if (name !== "workflow_dispatch" && name !== "push") {
        v.push(`trigger '${name}' is forbidden — the shipped boot RUNS only on workflow_dispatch (F3); only a registration-only push is allowed (E6-D001)`);
      }
    }
    if (!names.includes("workflow_dispatch")) v.push("the lane must be triggered by `workflow_dispatch`");
    // E6-D001 — the REGISTRATION-ONLY push: exactly the program branch, and paths = this file.
    if (names.includes("push")) {
      const push = typeof triggers === "object" && !Array.isArray(triggers) ? triggers.push : null;
      const keys = push && typeof push === "object" ? Object.keys(push) : [];
      const extra = keys.filter((k) => k !== "branches" && k !== "paths");
      if (extra.length) v.push(`the registration push may declare only \`branches\` + \`paths\`; found ${extra.join(", ")}`);
      const branches = Array.isArray(push?.branches) ? push.branches.map(String) : [];
      if (branches.length !== 1 || branches[0] !== REGISTRATION_BRANCH) {
        v.push(`the registration push must be restricted to branches [${REGISTRATION_BRANCH}]; got ${JSON.stringify(push?.branches ?? null)}`);
      }
      const paths = Array.isArray(push?.paths) ? push.paths.map(String) : [];
      if (paths.length !== 1 || paths[0] !== SHIPPED_BOOT_WORKFLOW) {
        v.push(`the registration push must be restricted to paths [${SHIPPED_BOOT_WORKFLOW}] — the workflow file itself, so no code change can fire it; got ${JSON.stringify(push?.paths ?? null)}`);
      }
    }
    const inputs = typeof triggers === "object" && !Array.isArray(triggers) ? triggers.workflow_dispatch?.inputs : undefined;
    const candidate = inputs?.candidate;
    if (!candidate) v.push("`workflow_dispatch` must declare a `candidate` input (the named frozen candidate)");
    else {
      if (candidate.required !== true) v.push("the `candidate` input must be `required: true` — the lane refuses to start without a named candidate");
      if (candidate.type !== "string") v.push("the `candidate` input must be `type: string`");
      if (candidate.default !== undefined && candidate.default !== "") v.push("the `candidate` input must have no default (a default is an unnamed candidate)");
    }
    const mode = inputs?.mode;
    if (!mode) v.push("`workflow_dispatch` must declare a `mode` input (keyless | keyed)");
    else {
      if (mode.type !== "choice") v.push("the `mode` input must be `type: choice`");
      if (mode.default !== "keyless") v.push(`the \`mode\` input must default to "keyless" (spend is opt-in); got ${JSON.stringify(mode.default)}`);
      const options = Array.isArray(mode.options) ? mode.options.map(String) : [];
      if (options.length !== 2 || !options.includes("keyless") || !options.includes("keyed")) {
        v.push(`the \`mode\` options must be exactly [keyless, keyed]; got ${JSON.stringify(options)}`);
      }
    }
  }

  // (1b) E6-D001: EVERY job is dispatch-only, so a push-created run executes zero steps and
  //      touches zero secrets.
  const gates = jobDispatchGates(src);
  if (!gates || Object.keys(gates).length === 0) v.push("no jobs found under `jobs:`");
  else {
    for (const [job, gated] of Object.entries(gates)) {
      if (!gated) v.push(`job '${job}' must carry \`${DISPATCH_ONLY_IF}\` at job level (a push-created registration run must execute zero steps)`);
    }
  }

  // (2) Least privilege.
  const perms = topLevelBlock(src, "permissions");
  const permLines = (perms ?? "").split(/\r?\n/).slice(1).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  if (perms === null || permLines.length !== 1 || permLines[0] !== "contents: read") {
    v.push("top-level `permissions:` must be exactly `contents: read`");
  }
  if (/:\s*write\b/.test(src.replace(/^\s*#.*$/gm, ""))) v.push("no permission may be `write`");

  // (3) Bound to the named candidate: validated, checked out, and an ancestor of the program branch.
  if (!src.includes("^[0-9a-f]{40}$")) v.push("the candidate must be validated as a 40-hex commit sha");
  if (!/ref:\s*\$\{\{\s*inputs\.candidate\s*\}\}/.test(src)) v.push("the checkout must be `ref: ${{ inputs.candidate }}` — the run is bound to the candidate");
  if (!/git merge-base --is-ancestor "\$CANDIDATE"/.test(src)) v.push("the candidate must be proven an ancestor of docs/replatform-program (`git merge-base --is-ancestor \"$CANDIDATE\"`)");
  if (!/git rev-parse HEAD\)"\s*==\s*"\$CANDIDATE"/.test(src)) v.push("the job must assert HEAD is the candidate after checkout");

  // (4) Built from source at the candidate, admitted, never pulled.
  if (!/AOA_IMAGE_REVISION:\s*\$\{\{\s*inputs\.candidate\s*\}\}/.test(src)) v.push("the image build must pin `AOA_IMAGE_REVISION: ${{ inputs.candidate }}`");
  for (const script of ["build.sh", "sbom.sh", "sign.sh", "admit.sh"]) {
    if (!new RegExp(`bash docker/images/${script.replace(".", "\\.")}`).test(src)) v.push(`the lane must run docker/images/${script} (build from source + DEP-014's admission chain)`);
  }
  if (/\bdocker (pull|login)\b/.test(src)) v.push("the lane must never `docker pull`/`docker login` — images are built from the candidate's source");
  if (/ghcr\.io|docker\.io\/|registry-1\./i.test(src.replace(/^\s*#.*$/gm, ""))) v.push("the lane must not reference a registry image — images are built from source");

  // (5) The keypair is generated in the job — and no signing key comes from a secret store.
  if (!/journey\.mjs prepare\b/.test(src)) v.push("the keypair must be generated in the job (`journey.mjs prepare`)");
  if (!/pnpm verify:cp-am-keypair/.test(src)) v.push("the generated pair must be checked with `pnpm verify:cp-am-keypair` before boot");

  // (6) Secrets: only the two keyed ones, and only through the keyed gate.
  for (const line of src.split(/\r?\n/)) {
    if (/^\s*#/.test(line) || !/secrets\./.test(line)) continue;
    const gated = GATED_SECRET_RE.exec(line);
    if (!gated) {
      v.push(`an ungated secret reference: ${line.trim()} — keyed secrets must read \`\${{ inputs.mode == 'keyed' && secrets.X || '' }}\``);
    } else if (!GATED_SECRETS.includes(gated[1])) {
      v.push(`secret '${gated[1]}' is not one the lane may read (${GATED_SECRETS.join(", ")})`);
    }
  }

  // (7) Inputs never spliced into shell text (a `${{ inputs.* }}` belongs on a YAML key line).
  for (const line of src.split(/\r?\n/)) {
    if (/^\s*#/.test(line) || !/\$\{\{\s*inputs\./.test(line)) continue;
    if (!/^\s*(-\s+)?[A-Za-z_][\w-]*:\s/.test(line)) v.push(`an input spliced into shell text: ${line.trim()} — pass it through \`env:\``);
  }

  // (8) Evidence retained on pass AND fail, and only the evidence dir; teardown always.
  const uploads = src.split(/\r?\n/).filter((l) => /uses:\s*actions\/upload-artifact@/.test(l)).length;
  if (uploads !== 1) v.push(`exactly one upload-artifact step is allowed (the evidence bundle); found ${uploads}`);
  const pathLines = src.split(/\r?\n/).filter((l) => /^\s+path:\s/.test(l)).map((l) => l.trim().replace(/^path:\s*/, ""));
  if (pathLines.length !== 1 || pathLines[0] !== EVIDENCE_UPLOAD_PATH) {
    v.push(`the only uploaded path must be ${EVIDENCE_UPLOAD_PATH} (never the keys, env or state); got ${JSON.stringify(pathLines)}`);
  }
  const uploadIdx = src.indexOf("actions/upload-artifact@");
  const before = uploadIdx === -1 ? "" : src.slice(Math.max(0, src.lastIndexOf("- name:", uploadIdx)), uploadIdx);
  if (!/if:\s*always\(\)/.test(before)) v.push("the evidence upload must run `if: always()` (retained on pass AND fail)");
  const teardownIdx = src.indexOf("journey.mjs teardown");
  const teardownStep = teardownIdx === -1 ? "" : src.slice(src.lastIndexOf("- name:", teardownIdx), teardownIdx);
  if (teardownIdx === -1 || !/if:\s*always\(\)/.test(teardownStep)) v.push("the teardown (`journey.mjs teardown`) must run `if: always()`");

  // (8b) The HARD pre-upload leak scan (ruled in under F2 after the distinct review): a step running
  //      `journey.mjs leak-scan` BEFORE the upload, and the upload gated on that step's success, so
  //      a bundle that fails the scan is never published.
  const scanIdx = src.indexOf("journey.mjs leak-scan");
  if (scanIdx === -1) v.push("the lane must run the pre-upload leak scan (`journey.mjs leak-scan`)");
  else if (uploadIdx !== -1 && scanIdx > uploadIdx) v.push("the leak scan must run BEFORE the evidence upload");
  const scanStep = scanIdx === -1 ? "" : src.slice(src.lastIndexOf("- name:", scanIdx), scanIdx);
  const scanId = /\bid:\s*([A-Za-z0-9_-]+)/.exec(scanStep)?.[1];
  if (scanIdx !== -1 && !scanId) v.push("the leak-scan step must carry an `id:` so the upload can be gated on it");
  if (scanId && !new RegExp(`if:\\s*always\\(\\)\\s*&&\\s*steps\\.${scanId}\\.outcome\\s*==\\s*'success'`).test(before)) {
    v.push(`the evidence upload must be gated \`if: always() && steps.${scanId}.outcome == 'success'\` — a bundle that fails the leak scan must never be uploaded`);
  }
  if (scanIdx !== -1 && !/if:\s*always\(\)/.test(scanStep)) v.push("the leak-scan step must run `if: always()` (a failed journey's evidence is scanned too)");

  // (8c) The LOG surface is collected (review batch 3A, PR #569). A phase whose output is not
  //      teed into the job log is a phase the leak scan cannot see, and the keypair check's
  //      output is on the same surface.
  for (const phase of TEED_PHASES) {
    // An invocation may be folded across lines (`run: >-`), so the window is the STEP: from the
    // invocation to the next step's `- name:`.
    const at = src.indexOf(`journey.mjs ${phase} --out`);
    if (at === -1) {
      v.push(`the lane must run the '${phase}' phase`);
      continue;
    }
    const nextStep = src.indexOf("- name:", at);
    const step = src.slice(at, nextStep === -1 ? src.length : nextStep);
    if (!step.includes(JOB_LOG_TEE)) {
      v.push(`phase '${phase}' does not tee its output into the job-log surface the leak scan reads`);
    }
  }
  // The candidate must carry the controls it is judged by: checkout replaces the workspace, so an
  // older candidate would run its own pre-control driver and report clean (Codex P1, PR #574).
  for (const [file, marker] of CANDIDATE_CONTROL_MARKERS) {
    if (!src.includes(`grep -q "${marker}" ${file}`)) {
      v.push(`the lane must refuse a candidate whose ${file} lacks '${marker}' — it would run its own pre-control driver and report clean`);
    }
  }

  // The collect step is best-effort for COLLECTION, but must not swallow the filter's status.
  if (/journey\.mjs collect[^\n]*\|\|\s*true/.test(src)) {
    v.push("the collect step must not swallow the log filter's exit status with `|| true` — a failed capture would be judged clean");
  }
  if (!/statuses\[1\]/.test(src)) {
    v.push("the collect step must propagate the log filter's own status (PIPESTATUS), so a failed capture fails the run");
  }

  // The directory the job log lives in must be created BEFORE the first teed step, and it must
  // be created by a step that runs earlier than the one whose pipeline opens the file.
  const mkdirAt = src.indexOf('mkdir -p "${RUNNER_TEMP}/m1-shipped-boot"');
  const firstTeeAt = src.indexOf(JOB_LOG_TEE);
  if (mkdirAt === -1 || (firstTeeAt !== -1 && mkdirAt > firstTeeAt)) {
    v.push("the job-log directory must be created before the first teed step (a tee into a missing directory fails ENOENT)");
  }
  // `shell: bash` (explicit) is `bash -eo pipefail`; the UNSPECIFIED default is `bash -e`, so a
  // failed phase piped into a successful `tee` would report as a pass.
  if (!/\n\s+defaults:\s*\n\s+run:\s*\n(?:\s*#.*\n)*\s+shell: bash/.test(src)) {
    v.push("the job must declare `defaults: run: shell: bash` so every teed pipeline runs under pipefail");
  }
  if (/pnpm verify:cp-am-keypair(?!.*log-filter.mjs)/.test(src)) {
    v.push("the keypair check must tee its output into the job-log surface too — it is the step that handles the key");
  }

  // (9) Bounded.
  if (!/timeout-minutes:\s*\d+/.test(src)) v.push("the job must carry a `timeout-minutes` cap");
  if (!/^concurrency:/m.test(src)) v.push("the lane must declare a `concurrency` group (one boot at a time)");

  return { violations: v };
}
