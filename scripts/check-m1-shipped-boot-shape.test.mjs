// -----------------------------------------------------------------------------
// DEP-015 — reds for the shipped CI boot lane's workflow-shape guard.
//
//   node --test scripts/check-m1-shipped-boot-shape.test.mjs
//
// Every case mutates the REAL committed workflow one way and asserts the guard reds. Per E6-D001
// the one push allowed is a REGISTRATION-ONLY push (the program branch, paths = this file, every
// job gated to dispatch); the positive controls red an unrestricted push and an ungated job.
// -----------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateShippedBootWorkflowShape, jobDispatchGates, SHIPPED_BOOT_WORKFLOW } from "./lib/m1-shipped-boot-shape.mjs";
import { parseYaml } from "./lib/yaml-lite.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const real = () => readFileSync(path.join(repoRoot, SHIPPED_BOOT_WORKFLOW), "utf8");
const violationsOf = (text) => evaluateShippedBootWorkflowShape(text).violations;
const anyMatch = (violations, re) => violations.some((x) => re.test(x));

/** Replace exactly one occurrence, and fail the TEST if the anchor is gone — a mutation that
 * silently did nothing would make its red vacuous. */
function mutate(text, from, to) {
  const count = text.split(from).length - 1;
  assert.equal(count, 1, `mutation anchor must occur exactly once: ${JSON.stringify(from)} (found ${count})`);
  return text.replace(from, to);
}

test("the REAL workflow satisfies every shape invariant", () => {
  const violations = violationsOf(real());
  assert.deepEqual(violations, [], violations.join("\n"));
});

test("the guard actually PARSES the real `on:` block (non-vacuous): one trigger, the two inputs", () => {
  const text = real();
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^on:/.test(l));
  const end = lines.findIndex((l, i) => i > start && /^\S/.test(l) && !/^#/.test(l));
  const on = parseYaml(lines.slice(start, end).join("\n")).on;
  assert.deepEqual(Object.keys(on).sort(), ["push", "workflow_dispatch"]);
  assert.equal(on.workflow_dispatch.inputs.candidate.required, true);
  assert.equal(on.workflow_dispatch.inputs.mode.default, "keyless");
  // E6-D001: the push exists ONLY to register the workflow — its own path, the program branch.
  assert.deepEqual(on.push, { branches: ["docs/replatform-program"], paths: [SHIPPED_BOOT_WORKFLOW] });
});

test("the guard actually FINDS the job and its dispatch-only gate (non-vacuous)", () => {
  assert.deepEqual(jobDispatchGates(real()), { "shipped-boot": true });
});

// === E6-D001: the registration-only push ====================================================

const PUSH_BLOCK = `  push:\n    branches:\n      - docs/replatform-program\n    paths:\n      - "${SHIPPED_BOOT_WORKFLOW}"\n`;

test("POSITIVE CONTROL: a push trigger WITHOUT the paths restriction reds (it would fire on every code change)", () => {
  const text = mutate(real(), PUSH_BLOCK, "  push:\n    branches:\n      - docs/replatform-program\n");
  assert.ok(anyMatch(violationsOf(text), /registration push must be restricted to paths/), violationsOf(text).join("\n"));
});

test("REJECT: paths listing anything besides the workflow file itself", () => {
  for (const extra of ["      - \"server/**\"\n", "      - \".github/keyed-e2b-trigger\"\n"]) {
    const text = mutate(real(), PUSH_BLOCK, `${PUSH_BLOCK}${extra}`);
    assert.ok(anyMatch(violationsOf(text), /registration push must be restricted to paths/), `${extra}\n${violationsOf(text).join("\n")}`);
  }
  const swapped = mutate(real(), `      - "${SHIPPED_BOOT_WORKFLOW}"\n`, "      - \"docker/**\"\n");
  assert.ok(anyMatch(violationsOf(swapped), /registration push must be restricted to paths/), violationsOf(swapped).join("\n"));
});

test("REJECT: the registration push on another branch, or with paths-ignore / tags", () => {
  const branch = mutate(real(), PUSH_BLOCK, PUSH_BLOCK.replace("docs/replatform-program", "main"));
  assert.ok(anyMatch(violationsOf(branch), /restricted to branches \[docs\/replatform-program\]/), violationsOf(branch).join("\n"));
  const ignore = mutate(real(), PUSH_BLOCK, `${PUSH_BLOCK}    paths-ignore:\n      - "docs/**"\n`);
  assert.ok(anyMatch(violationsOf(ignore), /may declare only `branches` \+ `paths`/), violationsOf(ignore).join("\n"));
});

test("REJECT: a job missing the dispatch-only `if` (a push-created run would execute it)", () => {
  const text = mutate(real(), "    if: github.event_name == 'workflow_dispatch'\n", "");
  assert.ok(anyMatch(violationsOf(text), /job 'shipped-boot' must carry `if: github\.event_name == 'workflow_dispatch'`/), violationsOf(text).join("\n"));
});

test("REJECT: a job whose `if` is weaker than dispatch-only", () => {
  const text = mutate(real(), "    if: github.event_name == 'workflow_dispatch'\n", "    if: github.event_name != 'pull_request'\n");
  assert.ok(anyMatch(violationsOf(text), /job 'shipped-boot' must carry/), violationsOf(text).join("\n"));
});

test("REJECT: a SECOND job without the gate (every job, not just the first)", () => {
  const text = mutate(real(), "\njobs:\n", "\njobs:\n  sneaky:\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n");
  assert.ok(anyMatch(violationsOf(text), /job 'sneaky' must carry/), violationsOf(text).join("\n"));
});

test("a step-level `if` does not count as the job gate", () => {
  const text = mutate(real(), "    if: github.event_name == 'workflow_dispatch'\n", "");
  assert.equal(jobDispatchGates(text)["shipped-boot"], false);
});

for (const trigger of ["pull_request", "schedule", "merge_group", "workflow_call", "workflow_run"]) {
  test(`REJECT: a \`${trigger}\` trigger`, () => {
    const body = trigger === "schedule" ? "  schedule:\n    - cron: \"0 3 * * 1\"\n" : `  ${trigger}:\n`;
    const text = mutate(real(), "on:\n  workflow_dispatch:\n", `on:\n${body}  workflow_dispatch:\n`);
    assert.ok(anyMatch(violationsOf(text), new RegExp(`trigger '${trigger}' is forbidden`)), violationsOf(text).join("\n"));
  });
}

test("REJECT: the candidate input no longer required (an unnamed candidate)", () => {
  const text = mutate(real(), "        required: true\n        type: string\n      mode:", "        required: false\n        type: string\n      mode:");
  assert.ok(anyMatch(violationsOf(text), /`candidate` input must be `required: true`/), violationsOf(text).join("\n"));
});

test("REJECT: keyed as the default mode (spend must be opt-in)", () => {
  const text = mutate(real(), "        default: keyless\n", "        default: keyed\n");
  assert.ok(anyMatch(violationsOf(text), /must default to "keyless"/), violationsOf(text).join("\n"));
});

test("REJECT: a keyed secret exposed without the keyed gate", () => {
  const text = mutate(
    real(),
    "          E2B_API_KEY: ${{ inputs.mode == 'keyed' && secrets.E2B_API_KEY || '' }}\n        run: node scripts/m1-shipped-boot/journey.mjs boot-workers",
    "          E2B_API_KEY: ${{ secrets.E2B_API_KEY }}\n        run: node scripts/m1-shipped-boot/journey.mjs boot-workers",
  );
  assert.ok(anyMatch(violationsOf(text), /ungated secret reference/), violationsOf(text).join("\n"));
});

test("REJECT: any other secret, even gated (e.g. a signing key from the secret store)", () => {
  const text = mutate(
    real(),
    "          ANTHROPIC_API_KEY: ${{ inputs.mode == 'keyed' && secrets.ANTHROPIC_API_KEY || '' }}\n        run: >-",
    "          ANTHROPIC_API_KEY: ${{ inputs.mode == 'keyed' && secrets.ANTHROPIC_API_KEY || '' }}\n          CP_KEY: ${{ inputs.mode == 'keyed' && secrets.CP_SIGNING_KEY || '' }}\n        run: >-",
  );
  assert.ok(anyMatch(violationsOf(text), /secret 'CP_SIGNING_KEY' is not one the lane may read/), violationsOf(text).join("\n"));
});

test("REJECT: the checkout not bound to the candidate", () => {
  const text = mutate(real(), "          ref: ${{ inputs.candidate }}\n", "          ref: docs/replatform-program\n");
  assert.ok(anyMatch(violationsOf(text), /checkout must be `ref: \$\{\{ inputs.candidate \}\}`/), violationsOf(text).join("\n"));
});

test("REJECT: the ancestry check removed (any sha, not a frozen candidate)", () => {
  const text = mutate(real(), 'git merge-base --is-ancestor "$CANDIDATE" FETCH_HEAD', "true");
  assert.ok(anyMatch(violationsOf(text), /ancestor of docs\/replatform-program/), violationsOf(text).join("\n"));
});

test("REJECT: a pulled image instead of a source build, or the admission step dropped", () => {
  const pulled = mutate(real(), "          bash docker/images/build.sh\n", "          docker pull ghcr.io/meteoritelabs/aoa-worker:staging\n");
  const v = violationsOf(pulled);
  assert.ok(anyMatch(v, /docker\/images\/build\.sh/), v.join("\n"));
  assert.ok(anyMatch(v, /never `docker pull`/), v.join("\n"));
  const unadmitted = mutate(real(), "          bash docker/images/admit.sh\n", "");
  assert.ok(anyMatch(violationsOf(unadmitted), /docker\/images\/admit\.sh/), violationsOf(unadmitted).join("\n"));
});

test("REJECT: the evidence upload widened to the whole output dir (keys, env, state)", () => {
  const text = mutate(real(), "          path: ${{ env.M1_OUT }}/evidence/\n", "          path: ${{ env.M1_OUT }}/\n");
  assert.ok(anyMatch(violationsOf(text), /only uploaded path must be/), violationsOf(text).join("\n"));
});

test("REJECT: the evidence upload only on success, or the teardown not always", () => {
  const upload = mutate(
    real(),
    "      - name: Upload the evidence bundle (on pass and fail)\n        if: always() && steps.leak-scan.outcome == 'success'\n",
    "      - name: Upload the evidence bundle (on pass and fail)\n",
  );
  assert.ok(anyMatch(violationsOf(upload), /evidence upload must run `if: always\(\)`/), violationsOf(upload).join("\n"));
  const teardown = mutate(real(), "      - name: Tear down (stack, volumes, keypair, secrets)\n        if: always()\n", "      - name: Tear down (stack, volumes, keypair, secrets)\n");
  assert.ok(anyMatch(violationsOf(teardown), /teardown .* must run `if: always\(\)`/), violationsOf(teardown).join("\n"));
});

test("REJECT: an input spliced into shell text instead of passed through env", () => {
  const text = mutate(real(), '          --candidate "$CANDIDATE" --mode "$MODE"', '          --candidate "${{ inputs.candidate }}" --mode "$MODE"');
  assert.ok(anyMatch(violationsOf(text), /input spliced into shell text/), violationsOf(text).join("\n"));
});

test("REJECT: write permissions", () => {
  const text = mutate(real(), "permissions:\n  contents: read\n", "permissions:\n  contents: write\n");
  const v = violationsOf(text);
  assert.ok(anyMatch(v, /exactly `contents: read`/), v.join("\n"));
  assert.ok(anyMatch(v, /no permission may be `write`/), v.join("\n"));
});

test("REJECT: the in-job keypair check removed", () => {
  const text = mutate(real(), "            pnpm verify:cp-am-keypair\n", "            true\n");
  assert.ok(anyMatch(violationsOf(text), /verify:cp-am-keypair/), violationsOf(text).join("\n"));
});

// === the HARD pre-upload leak scan (ruled in under F2 after the distinct review) ============

test("REJECT: the leak-scan step removed", () => {
  const text = mutate(real(), '            node scripts/m1-shipped-boot/journey.mjs leak-scan --out "$M1_OUT"\n', "            true\n");
  assert.ok(anyMatch(violationsOf(text), /must run the pre-upload leak scan/), violationsOf(text).join("\n"));
});

test("REJECT: the upload NOT gated on the leak scan's success (a leaking bundle would publish)", () => {
  const text = mutate(real(), "        if: always() && steps.leak-scan.outcome == 'success'\n", "        if: always()\n");
  assert.ok(anyMatch(violationsOf(text), /upload must be gated `if: always\(\) && steps\.leak-scan\.outcome == 'success'`/), violationsOf(text).join("\n"));
});

test("REJECT: the leak-scan step without an id, or not always()", () => {
  const noId = mutate(real(), "        id: leak-scan\n", "");
  assert.ok(anyMatch(violationsOf(noId), /must carry an `id:`/), violationsOf(noId).join("\n"));
  const notAlways = mutate(real(), "        id: leak-scan\n        if: always()\n", "        id: leak-scan\n");
  assert.ok(anyMatch(violationsOf(notAlways), /leak-scan step must run `if: always\(\)`/), violationsOf(notAlways).join("\n"));
});
