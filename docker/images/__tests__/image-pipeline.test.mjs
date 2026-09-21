#!/usr/bin/env node
/**
 * image-pipeline.test.mjs — DEP-014: the adapter-manager is the THIRD image of the
 * signed split-image build, and the build -> SBOM -> sign -> admit chain actually RUNS.
 *
 * Two halves.
 *
 * 1. STATIC (every PR, `policy`): `build.sh` builds all three images, and
 *    `d1-merge-train.yml` runs the whole chain (build, SBOM, sign, admit, image
 *    contents) on every run it runs — without booting the adapter-manager, which
 *    needs a provider key and is DEP-015's, not this ticket's.
 *
 * 2. BEHAVIOURAL (docker-free, every PR on Linux): `sbom.sh`, `sign.sh` and `admit.sh`
 *    are EXECUTED against a fabricated `digests.env` in a temp directory, with a
 *    `docker` shim on PATH that answers `inspect` and `run`. Everything else is real:
 *    bash, openssl, the real signing payload and the real verifier
 *    (`scripts/verify-image-admission.mjs`).
 *
 *    Why this half exists: before DEP-014, `sbom.sh` and `sign.sh` had never run.
 *    Both `source`d `digests.env`, whose keys `build.sh` writes as `${name^^}_…` —
 *    and bash's `^^` keeps the hyphen, so `CONTROL-PLANE_IMAGE=…` is not an
 *    assignment but a command, which `set -e` turns into an abort. A static read of
 *    the scripts cannot see that; running them can.
 *
 *    Every refusal case below is a POSITIVE CONTROL for `admit.sh`: a missing
 *    admission entry (today's state for the adapter-manager), a live image whose
 *    digest no longer matches the recorded one (tampered / retagged), a corrupted
 *    signature, an empty signature, and a mismatched source revision.
 */

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const IMAGES = path.join(ROOT, "docker/images");

export const SPLIT_IMAGES = Object.freeze([
  { name: "control-plane", dockerfile: "docker/control-plane/Dockerfile" },
  { name: "worker", dockerfile: "docker/worker/Dockerfile" },
  { name: "adapter-manager", dockerfile: "docker/adapter-manager/Dockerfile" },
]);

const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
const codeOnly = (text) =>
  text
    .split(/\r?\n/)
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");

// ---------------------------------------------------------------------------
// 1. STATIC
// ---------------------------------------------------------------------------

test("build.sh builds all three split images from their own Dockerfiles", () => {
  const build = codeOnly(read("docker/images/build.sh"));
  for (const { name, dockerfile } of SPLIT_IMAGES) {
    assert.match(
      build,
      new RegExp(`^build_one "${name}" "${dockerfile.replace(/\//g, "\\/")}"\\s*$`, "m"),
      `build.sh must build ${name} from ${dockerfile}`,
    );
  }
});

test("d1-merge-train builds, SBOMs, signs, admits and inspects the images on every run", () => {
  const wf = read(".github/workflows/d1-merge-train.yml");
  const code = codeOnly(wf);
  // Each must be a WHOLE command line. A substring match is vacuous here: the in-run
  // positive controls also invoke `bash docker/images/admit.sh > …`, so a lane that
  // dropped the real admission and kept only the controls would still "contain" it.
  const lines = code.split("\n").map((l) => l.trim());
  for (const needle of [
    "bash docker/images/build.sh",
    "bash docker/images/sbom.sh",
    "bash docker/images/sign.sh",
    "bash docker/images/admit.sh",
    "AOA_DEP001_IMAGE_TEST=1 node --test docker/images/__tests__/image-contents.test.mjs",
  ]) {
    assert.ok(lines.includes(needle), `d1-merge-train.yml must run, as its own command line: ${needle}`);
  }
  // No step of the chain may be conditional: "on every run it runs" (DEP-014 acceptance 4).
  const stepBlocks = code.split(/\n\s*- name: /);
  for (const block of stepBlocks) {
    if (/docker\/images\/(build|sbom|sign|admit)\.sh/.test(block)) {
      assert.ok(!/^\s*if:/m.test(block), `an image-chain step must not be conditional:\n${block.slice(0, 200)}`);
    }
  }
  // The chain's record is retained as lane evidence, but the private TEST signing key that
  // sign.sh generates beside it must never be uploaded: any upload of docker/images/ must
  // exclude it explicitly.
  for (const block of stepBlocks) {
    if (/upload-artifact/.test(block) && /docker\/images/.test(block)) {
      assert.ok(block.includes("!docker/images/trust-root.key"), "an evidence upload of docker/images must exclude trust-root.key");
    }
  }
});

test("DEP-014 boots nothing: no adapter-manager service in D1, no provider credential in the lane", () => {
  // Booting the adapter-manager needs a provider key — that is DEP-015 (F3), not this ticket.
  const compose = codeOnly(read("docker-compose.d1.yml"));
  assert.ok(!/adapter-manager/.test(compose), "docker-compose.d1.yml must not gain an adapter-manager service here");
  const wf = codeOnly(read(".github/workflows/d1-merge-train.yml"));
  assert.ok(!/E2B_API_KEY|secrets\./.test(wf), "d1-merge-train must stay keyless");
});

// ---------------------------------------------------------------------------
// 2. BEHAVIOURAL — execute sbom.sh, sign.sh and admit.sh docker-free.
// ---------------------------------------------------------------------------

function probe(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return r.status === 0;
}
const TOOLS = probe("bash", ["-c", "command -v openssl && command -v base64"]);
// On Linux (CI's `policy` job) the tools are REQUIRED: a skip there would be a check that
// evaluates nothing. Elsewhere, a host without them skips.
const SKIP = TOOLS
  ? false
  : process.platform === "linux"
    ? false
    : "requires bash + openssl + base64 on PATH";

const REVISION = "0123456789abcdef0123456789abcdef01234567";
const fakeDigest = () => `sha256:${randomBytes(32).toString("hex")}`;

let tmp;
let fixture;

function writeDigests(dir, rows) {
  const lines = [];
  for (const { name, image, digest, revision } of rows) {
    const key = name.toUpperCase();
    lines.push(`${key}_IMAGE=${image}`, `${key}_DIGEST=${digest}`, `${key}_REVISION=${revision}`);
  }
  writeFileSync(path.join(dir, "digests.env"), `${lines.join("\n")}\n`);
}

function writeLive(dir, map) {
  writeFileSync(
    path.join(dir, "live-digests"),
    Object.entries(map).map(([tag, digest]) => `${tag} ${digest}`).join("\n") + "\n",
  );
}

// A `docker` shim: `inspect --format {{.Id}} TAG` answers from live-digests; the
// RepoDigests form fails (a --load'ed, never-pushed image has none), so the scripts take
// the same fallback build.sh takes; `run` prints a one-package inventory for sbom.sh.
const SHIM = `#!/usr/bin/env bash
set -eu
case "$1" in
  inspect)
    fmt="$3"; tag="$4"
    case "$fmt" in *RepoDigests*) exit 1 ;; esac
    awk -v t="$tag" '$1 == t { print $2; found = 1 } END { exit found ? 0 : 1 }' "$FAKE_DOCKER_LIVE"
    ;;
  run) echo "fake-runtime@1.0.0" ;;
  *) echo "docker shim: unsupported $*" >&2; exit 2 ;;
esac
`;

function run(script, extraEnv = {}) {
  const env = {
    ...process.env,
    PATH: `${fixture.bin}${path.delimiter}${process.env.PATH}`,
    AOA_IMAGES_OUT_DIR: fixture.out,
    AOA_IMAGE_REVISION: REVISION,
    FAKE_DOCKER_LIVE: path.join(fixture.out, "live-digests"),
    ...extraEnv,
  };
  const r = spawnSync("bash", [path.join(IMAGES, script)], { cwd: ROOT, env, encoding: "utf8" });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

before(() => {
  if (SKIP) return;
  tmp = mkdtempSync(path.join(os.tmpdir(), "dep014-"));
  fixture = { out: path.join(tmp, "out"), bin: path.join(tmp, "bin"), rows: [] };
  for (const d of [fixture.out, fixture.bin]) mkdirSync(d, { recursive: true });
  const shim = path.join(fixture.bin, "docker");
  writeFileSync(shim, SHIM);
  chmodSync(shim, 0o755);
  copyFileSync(path.join(IMAGES, "allowlist.json"), path.join(fixture.out, "allowlist.json"));
  fixture.rows = SPLIT_IMAGES.map(({ name }) => ({
    name,
    image: `localhost/aoa/${name}:${REVISION}`,
    digest: fakeDigest(),
    revision: REVISION,
  }));
  writeDigests(fixture.out, fixture.rows);
  writeLive(fixture.out, Object.fromEntries(fixture.rows.map((r) => [r.image, r.digest])));
});

after(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

test("sbom.sh emits an SBOM for each of the three images, bound to its digest", { skip: SKIP }, () => {
  const r = run("sbom.sh");
  assert.equal(r.status, 0, r.out);
  for (const row of fixture.rows) {
    const sbom = JSON.parse(readFileSync(path.join(fixture.out, "sbom", `${row.name}.sbom.json`), "utf8"));
    assert.equal(sbom.name, row.name);
    assert.equal(sbom.digest, row.digest);
    assert.equal(sbom.sourceRevision, row.revision);
  }
});

test("sign.sh records one signed admission entry + provenance per image", { skip: SKIP }, () => {
  const r = run("sign.sh");
  assert.equal(r.status, 0, r.out);
  const allow = JSON.parse(readFileSync(path.join(fixture.out, "allowlist.json"), "utf8"));
  assert.deepEqual(
    allow.entries.map((e) => e.image).sort(),
    SPLIT_IMAGES.map((i) => i.name).sort(),
  );
  for (const row of fixture.rows) {
    const entry = allow.entries.find((e) => e.image === row.name);
    assert.equal(entry.digest, row.digest);
    assert.equal(entry.sourceRevision, row.revision);
    assert.ok(entry.signature.length > 0);
    const prov = JSON.parse(readFileSync(path.join(fixture.out, `provenance.${row.name}.json`), "utf8"));
    assert.equal(prov.image, row.name);
    assert.equal(prov.sourceRevision, row.revision);
  }
});

test("admit.sh admits all three signed images", { skip: SKIP }, () => {
  const r = run("admit.sh");
  assert.equal(r.status, 0, r.out);
  for (const { name } of SPLIT_IMAGES) {
    assert.match(r.out, new RegExp(`image admission: ADMITTED — admitted ${name} sha256:`));
  }
});

// Positive controls. Each mutates ONE input for the adapter-manager, runs admit.sh, asserts
// it is REFUSED for the stated reason, and restores the input.
function withMutation(file, mutate, fn) {
  const p = path.join(fixture.out, file);
  const original = readFileSync(p, "utf8");
  try {
    writeFileSync(p, mutate(original));
    fn();
  } finally {
    writeFileSync(p, original);
  }
}
const am = () => fixture.rows.find((r) => r.name === "adapter-manager");

test("CONTROL: an adapter-manager with no admission entry is refused (the pre-DEP-014 state)", { skip: SKIP }, () => {
  withMutation("allowlist.json", (text) => {
    const a = JSON.parse(text);
    a.entries = a.entries.filter((e) => e.image !== "adapter-manager");
    return JSON.stringify(a);
  }, () => {
    const r = run("admit.sh");
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.out, /adapter-manager: REFUSED — no admission entry/);
  });
});

test("CONTROL: a tampered/retagged adapter-manager (live digest != recorded) is refused", { skip: SKIP }, () => {
  withMutation("live-digests", (text) => text.replace(am().digest, fakeDigest()), () => {
    const r = run("admit.sh");
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.out, /adapter-manager: REFUSED — live digest .* does not match the recorded/);
  });
});

test("CONTROL: a recorded digest that is not the signed one is refused", { skip: SKIP }, () => {
  const forged = fakeDigest();
  withMutation("digests.env", (text) => text.replace(am().digest, forged), () => {
    withMutation("live-digests", (text) => text.replace(am().digest, forged), () => {
      const r = run("admit.sh");
      assert.notEqual(r.status, 0, r.out);
      assert.match(r.out, /adapter-manager: REFUSED — no admission entry/);
    });
  });
});

test("CONTROL: a corrupted adapter-manager signature is refused by the verifier", { skip: SKIP }, () => {
  withMutation("allowlist.json", (text) => {
    const a = JSON.parse(text);
    const e = a.entries.find((x) => x.image === "adapter-manager");
    const other = a.entries.find((x) => x.image === "worker");
    e.signature = other.signature; // a real signature — over a different payload
    return JSON.stringify(a);
  }, () => {
    const r = run("admit.sh");
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.out, /REJECTED — signature verification failed/);
  });
});

test("CONTROL: an unsigned adapter-manager entry is refused by the verifier", { skip: SKIP }, () => {
  withMutation("allowlist.json", (text) => {
    const a = JSON.parse(text);
    a.entries.find((x) => x.image === "adapter-manager").signature = "";
    return JSON.stringify(a);
  }, () => {
    const r = run("admit.sh");
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.out, /REJECTED — unsigned digest/);
  });
});

test("CONTROL: a mismatched adapter-manager source revision is refused by the verifier", { skip: SKIP }, () => {
  withMutation("digests.env", (text) =>
    text.replace(`ADAPTER-MANAGER_REVISION=${REVISION}`, "ADAPTER-MANAGER_REVISION=fedcba9876543210fedcba9876543210fedcba98"), () => {
    const r = run("admit.sh");
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.out, /REJECTED — provenance mismatch/);
  });
});
