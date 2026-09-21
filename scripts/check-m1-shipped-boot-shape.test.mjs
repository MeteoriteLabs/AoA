// -----------------------------------------------------------------------------
// DEP-015 — reds for the shipped CI boot lane's workflow-shape guard.
//
//   node --test scripts/check-m1-shipped-boot-shape.test.mjs
//
// Every case mutates the REAL committed workflow one way and asserts the guard reds. The
// first one is the positive control the ticket names: re-add a `push:` trigger.
// -----------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateShippedBootWorkflowShape, SHIPPED_BOOT_WORKFLOW } from "./lib/m1-shipped-boot-shape.mjs";
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
  assert.deepEqual(Object.keys(on), ["workflow_dispatch"]);
  assert.equal(on.workflow_dispatch.inputs.candidate.required, true);
  assert.equal(on.workflow_dispatch.inputs.mode.default, "keyless");
});

test("POSITIVE CONTROL: a re-added `push:` trigger reds the guard", () => {
  const text = mutate(real(), "on:\n  workflow_dispatch:\n", "on:\n  push:\n    branches:\n      - docs/replatform-program\n  workflow_dispatch:\n");
  assert.ok(anyMatch(violationsOf(text), /trigger 'push' is forbidden/), violationsOf(text).join("\n"));
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
  const upload = mutate(real(), "      - name: Upload the evidence bundle (on pass and fail)\n        if: always()\n", "      - name: Upload the evidence bundle (on pass and fail)\n");
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
