// -----------------------------------------------------------------------------
// m1-shipped-boot-shape — the workflow-SHAPE invariants of the DEP-015 shipped CI boot lane
// (`.github/workflows/m1-shipped-boot.yml`). PURE: text in, violations out.
//
// Founder ruling F3 fixes what that lane may be: DISPATCH-ONLY, never on push; bound to a
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
export const EVIDENCE_UPLOAD_PATH = "${{ env.M1_OUT }}/evidence/";

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
      if (name !== "workflow_dispatch") v.push(`trigger '${name}' is forbidden — the shipped boot is DISPATCH-ONLY (F3); it must never run on ${name}`);
    }
    if (!names.includes("workflow_dispatch")) v.push("the lane must be triggered by `workflow_dispatch`");
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

  // (9) Bounded.
  if (!/timeout-minutes:\s*\d+/.test(src)) v.push("the job must carry a `timeout-minutes` cap");
  if (!/^concurrency:/m.test(src)) v.push("the lane must declare a `concurrency` group (one boot at a time)");

  return { violations: v };
}
