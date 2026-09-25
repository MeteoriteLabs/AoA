// -----------------------------------------------------------------------------
// DEP-024 — the positive control for `seedSpineWorkerDrivenJob`'s LANE PARAMETERS, and for the
// script it renders actually PARSING.
//
// Two distinct properties, both of which have already cost this programme a full lane cycle:
//
// (1) ★ A DEFAULT-IDENTICAL REFACTOR ROTS SILENTLY. DEP-024 turned three hard-coded D1 facts —
//     the committed profile's target id, that profile's `policyHash`, and the reference provider's
//     `claude` entrypoint — into parameters, so the SHIPPED-BOOT lane can seed the same
//     worker-driven job against its own dynamically-created target. If the defaults stopped being
//     the D1 values, the D1 merge train would seed onto a target that does not exist; if the
//     overrides stopped taking effect, the shipped-boot lane would seed onto the D1 target, which
//     is not running there. BOTH directions are asserted here.
//
// (2) ★ THE RENDERED SCRIPT IS PARSED, on the `policy` lane, with no Docker. `dexecModule` spawns
//     `docker compose exec … node --input-type=module`, so until DEP-024 added the `dexec` seam
//     nothing could look at the template's OUTPUT without a live stack. DEP-023 §5.1 lost a
//     ~25-minute cycle to a real newline inside a JS string literal in a sibling template and its
//     record states that a local render + parse check was put in place; `git grep` for `--check`
//     across `scripts/` and `tests/` finds no such control at this revision, so this file is it.
//     The check is `node --check` over the rendered module, written to a temp `.mjs` so the module
//     grammar is the one that will actually run.
//
// PURE + FREE: no Docker, no database, no network. Runs in `policy`.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  SPINE_DEPLOYED_POLICY_HASH,
  SPINE_DEPLOYED_TARGET_ID,
  seedSpineWorkerDrivenJob,
} from "../../../tests/d1/lib/e6f-harness.mjs";

/** A tenant and a ratified target, shaped exactly as both lanes pass them. */
const TENANT = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  companyId: "22222222-2222-4222-8222-222222222222",
  agentId: "44444444-4444-4444-8444-444444444444",
};
const TARGET = { profileHash: "a".repeat(64), providerDigest: "b".repeat(64), generation: 7 };
const IDS = {
  issueId: "55555555-5555-4555-8555-555555555555",
  runId: "66666666-6666-4666-8666-666666666666",
  jobId: "77777777-7777-4777-8777-777777777777",
  attemptId: "88888888-8888-4888-8888-888888888888",
  handleId: "99999999-9999-4999-8999-999999999999",
};

/**
 * Render the seeder's script through the injected `dexec` seam. Returns the script source and the
 * call's own arguments (service + the scrub list), so the secret-scrub contract is observable too.
 */
function render(overrides = {}) {
  const calls = [];
  const dexec = (service, script, opts) => {
    calls.push({ service, script, opts });
    return { status: 0, error: null, stdout: "", stderr: "", result: { ok: true } };
  };
  const res = seedSpineWorkerDrivenJob({ tenant: TENANT, ...IDS, target: TARGET, dexec, ...overrides });
  assert.equal(calls.length, 1, "the seeder must make exactly ONE dexec call");
  assert.deepEqual(res.result, { ok: true }, "the seeder must return the executor's result unchanged");
  return calls[0];
}

/** `node --check` the rendered module. Fails with node's own parse diagnostic. */
function parses(script) {
  const dir = mkdtempSync(path.join(tmpdir(), "dep024-render-"));
  const file = path.join(dir, "rendered.mjs");
  try {
    writeFileSync(file, script, "utf8");
    const res = spawnSync(process.execPath, ["--check", file], { encoding: "utf8", timeout: 60_000 });
    return { ok: res.status === 0, diagnostic: `${res.stderr ?? ""}${res.stdout ?? ""}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("DEFAULT: with no lane override the seeder embeds the D1 target id, policy hash and `claude`", () => {
  const { service, script } = render();
  assert.equal(service, "control-plane");
  assert.ok(script.includes(SPINE_DEPLOYED_TARGET_ID), "the D1 deployed target id must be embedded");
  assert.ok(script.includes(SPINE_DEPLOYED_POLICY_HASH), "the D1 profile's policy hash must be embedded");
  assert.ok(/"command":\s*"claude"/.test(script), `the default tenant command must be \`claude\`: ${script.slice(0, 0)}`);
});

test("OVERRIDE: the shipped-boot lane's target id, policy hash and tenant command all take effect", () => {
  const targetId = "abababab-abab-4bab-8bab-abababababab";
  const policyHash = "c".repeat(64);
  const command = "sh";
  const { script } = render({ targetId, policyHash, command, workloadArgs: ["-c", "printf 'x\\n'"] });
  assert.ok(script.includes(targetId), "the overridden target id must be embedded");
  assert.ok(script.includes(policyHash), "the overridden policy hash must be embedded");
  assert.ok(script.includes(`"command":"${command}"`) || /"command":\s*"sh"/.test(script), "the overridden command must be embedded");
  // ★ AND THE D1 CONSTANTS MUST BE GONE. An override that ADDED its value while leaving the
  // default embedded would place the attempt on the D1 target and pass the assertions above.
  assert.equal(script.includes(SPINE_DEPLOYED_TARGET_ID), false, "the D1 target id must NOT survive an override");
  assert.equal(script.includes(SPINE_DEPLOYED_POLICY_HASH), false, "the D1 policy hash must NOT survive an override");
});

test("the canary value is handed to the executor's SCRUB list, never left to a caller", () => {
  const secretValue = "d2r-canary-0123456789abcdef";
  const { opts } = render({ secretValue, secretName: "provider:d2r-canary" });
  assert.deepEqual(opts?.secrets, [secretValue]);
});

test("★ RENDER + PARSE: the script the seeder builds is valid ESM, on BOTH lanes' parameters", () => {
  for (const [label, overrides] of [
    ["D1 defaults", {}],
    ["shipped-boot overrides", {
      targetId: "abababab-abab-4bab-8bab-abababababab",
      policyHash: "c".repeat(64),
      command: "sh",
      // The real shipped-boot redaction plant: a tagged printf whose text carries quotes, a
      // `$VAR` expansion and an escaped newline — exactly the shapes that broke a sibling template.
      workloadArgs: ["-c", "printf 'AOA-RUN-OUTPUT-PROBE canary=%s\\n' \"$ANTHROPIC_API_KEY\""],
      secretValue: "d2r-canary-0123456789abcdef",
      secretName: "provider:d2r-canary",
    }],
  ]) {
    const { script } = render(overrides);
    const verdict = parses(script);
    assert.equal(verdict.ok, true, `${label}: the rendered script does not parse:\n${verdict.diagnostic}`);
  }
});

test("★ POSITIVE CONTROL for the parse check itself: a template defect IS caught", () => {
  // The exact defect DEP-023 §5.1 measured: a REAL newline inside a JS string literal. If
  // `parses()` could not see this, the test above would be a check that evaluates nothing.
  const broken = 'const x = "a\nb";\nexport default x;\n';
  const verdict = parses(broken);
  assert.equal(verdict.ok, false, "a real newline inside a string literal must FAIL the parse check");
  assert.match(verdict.diagnostic, /SyntaxError|Invalid or unexpected token/);
});
