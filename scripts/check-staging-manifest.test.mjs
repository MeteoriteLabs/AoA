// -----------------------------------------------------------------------------
// DEP-006 staging-manifest static-validator corpus (node:test).
//
//   node --test scripts/check-staging-manifest.test.mjs
//
// Two layers, mirroring scripts/check-d1-compose.test.mjs:
//   1. Ties the validator to the REAL committed artifact: parses
//      docker-compose.staging.yml with yaml-lite and asserts ZERO violations
//      (with the real environment-variables.md documented-key set).
//   2. NON-VACUOUSNESS (invariant §2.8): a hand-built valid compose object passes
//      with zero violations, and each deliberately-broken clone is REJECTED — one
//      mutation per invariant §2.1–§2.8, so no check can pass vacuously.
// -----------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseYaml } from "./lib/yaml-lite.mjs";
import {
  evaluateStagingManifestInvariants,
  collectDocumentedEnvKeys,
  STAGING_SERVICES,
  FAILURE_DOMAIN_LABEL,
  AUTOSCALE_MIN_LABEL,
  AUTOSCALE_MAX_LABEL,
  DRAIN_HOOK_LABEL,
  evaluateShippedBootOverlayInvariants,
  mergeComposeModel,
  SHIPPED_BOOT_OVERLAY_PATH,
  SHIPPED_BOOT_OVERLAY_WORKERS,
  SHIPPED_BOOT_ADMITTED_DISPATCH_ENV,
  DISTRIBUTED_EXECUTION_ROLLOUT_ENV,
  DISTRIBUTED_CREW_ROLLOUT_ENABLED_ENV,
  GRANT_REDEEMING_SERVICES,
} from "./lib/staging-manifest-invariants.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const composePath = path.join(repoRoot, "docker-compose.staging.yml");
const envDocPath = path.join(repoRoot, "docs", "deploy", "environment-variables.md");

/** A complete, valid parsed-compose object mirroring the real staging topology. */
function validCompose() {
  const cp = (domain) => ({
    image: "${AOA_STAGING_CONTROL_PLANE_IMAGE:-ghcr.io/meteoritelabs/aoa-control-plane:staging}",
    environment: {
      HOST: "0.0.0.0",
      PORT: "3100",
      AOA_DEPLOYMENT_MODE: "cloud_auth",
      AOA_DISTRIBUTED_EXECUTION_ENABLED: "true",
      DATABASE_URL: "${AOA_STAGING_DATABASE_URL}",
      AOA_APP_DATABASE_URL: "${AOA_STAGING_APP_DATABASE_URL}",
      AOA_OPERATOR_DATABASE_URL: "${AOA_STAGING_OPERATOR_DATABASE_URL}",
      AOA_WORKER_SESSION_SIGNING_KEY: "${AOA_STAGING_WORKER_SESSION_SIGNING_KEY}",
      AOA_WORKER_POLL_RATE_LIMIT_MAX: "20000",
      AOA_WORKER_POLL_RATE_LIMIT_WINDOW_MS: "60000",
      AOA_STORAGE_PROVIDER: "s3",
      AOA_STORAGE_S3_ENDPOINT: "${AOA_STAGING_S3_ENDPOINT}",
      AOA_STORAGE_S3_PRESIGN_ENDPOINT: "${AOA_STAGING_S3_PRESIGN_ENDPOINT}",
      AOA_STORAGE_S3_BUCKET: "${AOA_STAGING_S3_BUCKET}",
      AOA_STORAGE_S3_REGION: "${AOA_STAGING_S3_REGION:-us-east-1}",
      AOA_STORAGE_S3_FORCE_PATH_STYLE: "true",
    },
    labels: { [FAILURE_DOMAIN_LABEL]: domain, [AUTOSCALE_MIN_LABEL]: "1", [AUTOSCALE_MAX_LABEL]: "3" },
    deploy: {
      replicas: 1,
      update_config: { parallelism: 1, order: "start-first", max_failure_ratio: 0 },
      rollback_config: { parallelism: 1, order: "stop-first" },
    },
    depends_on: { migrate: { condition: "service_completed_successfully" } },
    healthcheck: { test: ["CMD-SHELL", "curl -fsS http://127.0.0.1:3100/api/health || exit 1"] },
    stop_grace_period: "30s",
    networks: ["control-net", "store-egress-net"],
  });
  const worker = (id, domain) => ({
    image: "${AOA_STAGING_WORKER_IMAGE:-ghcr.io/meteoritelabs/aoa-worker:staging}",
    environment: {
      AOA_WORKER_TARGET_PROFILE_ID: id,
      AOA_WORKER_TARGET_SCOPE: "organization",
      AOA_WORKER_CONTROL_PLANE_URL: "${AOA_STAGING_CONTROL_PLANE_URL}",
      AOA_WORKER_S3_ENDPOINT: "${AOA_STAGING_S3_PRESIGN_ENDPOINT}",
      AOA_WORKER_KEY_STORE_MODE: "mounted_secret",
      AOA_WORKER_HEALTH_PORT: "9464",
      AOA_WORKER_ENROLLMENT_CODE_FILE: "/run/secrets/worker-enrollment-code",
    },
    labels: {
      [FAILURE_DOMAIN_LABEL]: domain,
      [AUTOSCALE_MIN_LABEL]: "2",
      [AUTOSCALE_MAX_LABEL]: "8",
      [DRAIN_HOOK_LABEL]: "SIGTERM: stop polling; finish/relinquish in-flight leases within the visibility timeout; exit 0",
    },
    deploy: {
      replicas: 2,
      update_config: { parallelism: 1, order: "start-first", max_failure_ratio: 0 },
      rollback_config: { parallelism: 1, order: "stop-first" },
    },
    depends_on: { migrate: { condition: "service_completed_successfully" } },
    healthcheck: { test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:9464/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"] },
    stop_grace_period: "120s",
    stop_signal: "SIGTERM",
    networks: ["control-net", "store-egress-net"],
  });
  return {
    name: "aoa-staging",
    "x-external": {
      database: "${AOA_STAGING_DATABASE_URL}",
      "object-store": "${AOA_STAGING_S3_ENDPOINT}",
      realtime: "${AOA_STAGING_REALTIME_URL}",
      "admission-store": "${AOA_STAGING_DATABASE_URL}",
    },
    services: {
      migrate: {
        image: "${AOA_STAGING_CONTROL_PLANE_IMAGE:-ghcr.io/meteoritelabs/aoa-control-plane:staging}",
        entrypoint: ["/usr/local/bin/migrate-entrypoint.sh"],
        command: [],
        environment: { DATABASE_URL: "${AOA_STAGING_MIGRATION_DATABASE_URL}" },
        labels: { [FAILURE_DOMAIN_LABEL]: "shared" },
        networks: ["store-egress-net"],
      },
      "control-plane": cp("domain-a"),
      "control-plane-b": cp("domain-b"),
      "worker-a1": worker("staging-worker-a1", "domain-a"),
      "worker-a2": worker("staging-worker-a2", "domain-a"),
      "worker-b1": worker("staging-worker-b1", "domain-b"),
      "worker-b2": worker("staging-worker-b2", "domain-b"),
      "adapter-manager": {
        image: "${AOA_STAGING_ADAPTER_MANAGER_IMAGE:-ghcr.io/meteoritelabs/aoa-adapter-manager:staging}",
        environment: {
          HOST: "0.0.0.0",
          PORT: "8090",
          AOA_DEPLOYMENT_MODE: "cloud_auth",
          E2B_API_KEY: "${AOA_STAGING_E2B_API_KEY}",
          E2B_DOMAIN: "${AOA_STAGING_E2B_DOMAIN:-}",
        },
        labels: { [FAILURE_DOMAIN_LABEL]: "shared", [AUTOSCALE_MIN_LABEL]: "1", [AUTOSCALE_MAX_LABEL]: "3" },
        deploy: {
          replicas: 1,
          update_config: { parallelism: 1, order: "start-first", max_failure_ratio: 0 },
          rollback_config: { parallelism: 1, order: "stop-first" },
        },
        healthcheck: { test: ["CMD-SHELL", "curl -fsS http://127.0.0.1:8090/healthz || exit 1"] },
        stop_grace_period: "30s",
        networks: ["control-net", "provider-ctl-net"],
      },
    },
    networks: {
      "control-net": { internal: true },
      "store-egress-net": { internal: false },
      "provider-ctl-net": { internal: false },
    },
  };
}

// The documented-env-key set the module needs for §2.6. In the corpus we build it
// by hand (every env key the fixture uses); Layer 1 uses the REAL doc file.
const FIXTURE_DOCUMENTED_ENV_KEYS = new Set([
  "HOST",
  "PORT",
  "AOA_DEPLOYMENT_MODE",
  "AOA_DISTRIBUTED_EXECUTION_ENABLED",
  "DATABASE_URL",
  "AOA_APP_DATABASE_URL",
  "AOA_OPERATOR_DATABASE_URL",
  "AOA_WORKER_SESSION_SIGNING_KEY",
  "AOA_WORKER_POLL_RATE_LIMIT_MAX",
  "AOA_WORKER_POLL_RATE_LIMIT_WINDOW_MS",
  "AOA_STORAGE_PROVIDER",
  "AOA_STORAGE_S3_ENDPOINT",
  "AOA_STORAGE_S3_PRESIGN_ENDPOINT",
  "AOA_STORAGE_S3_BUCKET",
  "AOA_STORAGE_S3_REGION",
  "AOA_STORAGE_S3_FORCE_PATH_STYLE",
  "AOA_WORKER_TARGET_PROFILE_ID",
  "AOA_WORKER_TARGET_SCOPE",
  "AOA_WORKER_CONTROL_PLANE_URL",
  "AOA_WORKER_S3_ENDPOINT",
  "AOA_WORKER_KEY_STORE_MODE",
  "AOA_WORKER_HEALTH_PORT",
  "AOA_WORKER_ENROLLMENT_CODE_FILE",
  "E2B_API_KEY",
  "E2B_DOMAIN",
]);

const clone = (o) => structuredClone(o);
const anyMatch = (violations, re) => violations.some((x) => re.test(x));
const evalValid = (c) =>
  evaluateStagingManifestInvariants(c, { documentedEnvKeys: FIXTURE_DOCUMENTED_ENV_KEYS });

// === Layer 1: real committed artifact =========================================

test("real docker-compose.staging.yml parses and satisfies every DEP-006 invariant", () => {
  const compose = parseYaml(readFileSync(composePath, "utf8"));
  const documentedEnvKeys = collectDocumentedEnvKeys(readFileSync(envDocPath, "utf8"));
  const { violations } = evaluateStagingManifestInvariants(compose, { documentedEnvKeys });
  assert.deepEqual(violations, [], `unexpected violations:\n${violations.join("\n")}`);
});

test("real staging compose parses to exactly the DEP-006 service set", () => {
  const compose = parseYaml(readFileSync(composePath, "utf8"));
  const names = Object.keys(compose.services).sort();
  assert.deepEqual(names, [...STAGING_SERVICES].sort());
});

// === Layer 2a: the hand-built valid baseline passes ===========================

test("hand-built valid staging compose passes with zero violations", () => {
  assert.deepEqual(evalValid(validCompose()).violations, []);
});

// === Layer 2b: NON-VACUOUSNESS — one broken clone per invariant §2.1–§2.8 ======

// §2.1 — migration runs first.
test("REJECT (§2.1): a control-plane not gated on migrate completion", () => {
  const c = clone(validCompose());
  delete c.services["control-plane"].depends_on.migrate;
  const { violations } = evalValid(c);
  assert.ok(anyMatch(violations, /depends_on 'migrate'.*service_completed_successfully/i), violations.join("\n"));
});

test("REJECT (§2.1): a worker gating on migrate with service_healthy (wrong condition)", () => {
  const c = clone(validCompose());
  c.services["worker-a1"].depends_on.migrate = { condition: "service_healthy" };
  const { violations } = evalValid(c);
  assert.ok(anyMatch(violations, /one-shot job 'migrate'.*service_completed_successfully/i), violations.join("\n"));
});

// §2.2 — N/N-1 rollout policy.
test("REJECT (§2.2): a control-plane missing the rolling-update policy", () => {
  const c = clone(validCompose());
  delete c.services["control-plane"].deploy.update_config;
  const { violations } = evalValid(c);
  assert.ok(anyMatch(violations, /rolling-update|update_config/i), violations.join("\n"));
});

test("REJECT (§2.2): a worker rollout with unbounded parallelism (breaks N/N-1)", () => {
  const c = clone(validCompose());
  c.services["worker-b2"].deploy.update_config.parallelism = 4;
  const { violations } = evalValid(c);
  assert.ok(anyMatch(violations, /parallelism/i), violations.join("\n"));
});

// §2.3 — worker drain.
test("REJECT (§2.3): a worker missing stop_grace_period", () => {
  const c = clone(validCompose());
  delete c.services["worker-a2"].stop_grace_period;
  const { violations } = evalValid(c);
  assert.ok(anyMatch(violations, /stop_grace_period/i), violations.join("\n"));
});

test("REJECT (§2.3): a worker missing the documented drain hook", () => {
  const c = clone(validCompose());
  delete c.services["worker-a2"].labels[DRAIN_HOOK_LABEL];
  const { violations } = evalValid(c);
  assert.ok(anyMatch(violations, /drain hook/i), violations.join("\n"));
});

// §2.4 — shared admission cannot fall back to process memory.
test("REJECT (§2.4): a process-local admission env/flag on any service", () => {
  const c = clone(validCompose());
  c.services["control-plane"].environment.AOA_WORKER_ADMISSION_IN_MEMORY = "1";
  const { violations } = evalValid(c);
  assert.ok(anyMatch(violations, /process-local admission|in-memory admission/i), violations.join("\n"));
});

test("REJECT (§2.4): a control-plane with distributed execution disabled (shared limiter unwired)", () => {
  const c = clone(validCompose());
  c.services["control-plane"].environment.AOA_DISTRIBUTED_EXECUTION_ENABLED = "false";
  const { violations } = evalValid(c);
  assert.ok(anyMatch(violations, /AOA_DISTRIBUTED_EXECUTION_ENABLED/i), violations.join("\n"));
});

// §2.5 — provider-control credential confined + absent.
test("REJECT (§2.5): E2B_API_KEY on the control-plane (must be absent)", () => {
  const c = clone(validCompose());
  c.services["control-plane"].environment.E2B_API_KEY = "${AOA_STAGING_E2B_API_KEY}";
  const { violations } = evalValid(c);
  assert.ok(anyMatch(violations, /E2B_API_KEY/i), violations.join("\n"));
});

test("REJECT (§2.5): E2B_API_KEY on a worker (must be absent)", () => {
  const c = clone(validCompose());
  c.services["worker-a1"].environment.E2B_API_KEY = "${AOA_STAGING_E2B_API_KEY}";
  const { violations } = evalValid(c);
  assert.ok(anyMatch(violations, /E2B_API_KEY/i), violations.join("\n"));
});

test("REJECT (§2.5): a baked (literal) E2B_API_KEY on the adapter-manager (not rotatable)", () => {
  const c = clone(validCompose());
  c.services["adapter-manager"].environment.E2B_API_KEY = "e2b_live_deadbeefdeadbeef";
  const { violations } = evalValid(c);
  assert.ok(anyMatch(violations, /baked|literal|rotatable|injection/i), violations.join("\n"));
});

test("REJECT (§2.5): a `${VAR:-baked-literal}` default E2B_API_KEY (resolves to a baked key)", () => {
  const c = clone(validCompose());
  c.services["adapter-manager"].environment.E2B_API_KEY = "${AOA_STAGING_E2B_API_KEY:-e2b_live_bakeddefault}";
  const { violations } = evalValid(c);
  assert.ok(anyMatch(violations, /baked|literal|rotatable|injection/i), violations.join("\n"));
});

test("REJECT (§2.5): E2B_API_KEY smuggled onto a worker via env_file (opaque channel)", () => {
  const c = clone(validCompose());
  c.services["worker-a1"].env_file = ["./provider-secrets.env"];
  const { violations } = evalValid(c);
  assert.ok(anyMatch(violations, /env_file/i), violations.join("\n"));
});

test("REJECT (§2.5): a provider-control secret mounted onto a worker (secrets channel)", () => {
  const c = clone(validCompose());
  c.services["worker-a1"].secrets = ["e2b_api_key"];
  const { violations } = evalValid(c);
  assert.ok(anyMatch(violations, /secrets|provider-control/i), violations.join("\n"));
});

test("REJECT (§2.5): the provider-control credential named in a worker command (inline injection)", () => {
  const c = clone(validCompose());
  c.services["worker-a1"].command = ["sh", "-c", "E2B_API_KEY=$SECRET exec worker"];
  const { violations } = evalValid(c);
  assert.ok(anyMatch(violations, /command|E2B/i), violations.join("\n"));
});

test("REJECT (§2.5): the control-plane attached to provider-ctl-net (provider-control leak)", () => {
  const c = clone(validCompose());
  c.services["control-plane"].networks.push("provider-ctl-net");
  const { violations } = evalValid(c);
  assert.ok(anyMatch(violations, /provider-ctl-net/i), violations.join("\n"));
});

// DEP-010 — dispatch stays OFF by default: no staging worker may set the switches that would
// turn it on. Spans `environment` AND `command`/`entrypoint`, parity with the provider-control
// boundary above — a value delivered inline is a value delivered.
test("REJECT (DEP-010): AOA_WORKER_DISPATCH_ENABLED on a worker's environment", () => {
  const c = clone(validCompose());
  c.services["worker-a1"].environment.AOA_WORKER_DISPATCH_ENABLED = "1";
  const { violations } = evalValid(c);
  assert.ok(anyMatch(violations, /DISPATCH-DEFAULT/i), violations.join("\n"));
});

test("REJECT (DEP-010): AOA_WORKER_DISPATCH_ENABLED in a worker's command (inline)", () => {
  const c = clone(validCompose());
  c.services["worker-a1"].command = ["sh", "-c", "AOA_WORKER_DISPATCH_ENABLED=1 exec worker"];
  const { violations } = evalValid(c);
  assert.ok(anyMatch(violations, /DISPATCH-DEFAULT/i), violations.join("\n"));
});

test("REJECT (DEP-010): AOA_WORKER_SANDBOX_PROVIDER on a worker's environment", () => {
  const c = clone(validCompose());
  c.services["worker-a1"].environment.AOA_WORKER_SANDBOX_PROVIDER = "e2b";
  const { violations } = evalValid(c);
  assert.ok(anyMatch(violations, /DISPATCH-DEFAULT/i), violations.join("\n"));
});

test("REJECT (DEP-010): AOA_WORKER_SANDBOX_PROVIDER in a worker's entrypoint (inline)", () => {
  const c = clone(validCompose());
  c.services["worker-a1"].entrypoint = ["sh", "-c", "AOA_WORKER_SANDBOX_PROVIDER=e2b exec worker"];
  const { violations } = evalValid(c);
  assert.ok(anyMatch(violations, /DISPATCH-DEFAULT/i), violations.join("\n"));
});

// ★ Blocker B — `AOA_WORKER_PROVIDER_URL` is the CONTAINER analogue of the desktop
// `AOA_WORKER_SANDBOX_PROVIDER`: set it and `worker-networked-host` builds a per-run provider
// factory pointed at the adapter-manager. It was legitimately unbanned while NO shipped image
// contained a bin that reads it — the ban was structurally redundant. Blocker B puts that bin
// in the worker image, so the variable becomes live and the ban becomes load-bearing.
test("REJECT (Blocker B): AOA_WORKER_PROVIDER_URL on a worker's environment", () => {
  const c = clone(validCompose());
  c.services["worker-a1"].environment.AOA_WORKER_PROVIDER_URL = "http://adapter-manager:8090";
  const { violations } = evalValid(c);
  assert.ok(anyMatch(violations, /DISPATCH-DEFAULT/i), violations.join("\n"));
  assert.ok(anyMatch(violations, /AOA_WORKER_PROVIDER_URL/i), violations.join("\n"));
});

test("REJECT (Blocker B): AOA_WORKER_PROVIDER_URL in a worker's command (inline)", () => {
  // The env map is not the only delivery route: a value delivered inline is a value delivered,
  // and the same `command:` override is ALSO how the networked-host bin would be entered.
  const c = clone(validCompose());
  c.services["worker-a1"].command = ["sh", "-c", "AOA_WORKER_PROVIDER_URL=http://am:8090 exec worker"];
  const { violations } = evalValid(c);
  assert.ok(anyMatch(violations, /DISPATCH-DEFAULT/i), violations.join("\n"));
  assert.ok(anyMatch(violations, /AOA_WORKER_PROVIDER_URL/i), violations.join("\n"));
});

// §2.6 — all mutable configuration documented.
test("REJECT (§2.6): an undocumented render env key", () => {
  const c = clone(validCompose());
  c.services["control-plane"].environment.AOA_STAGING_UNDOCUMENTED_KNOB = "x";
  const { violations } = evalValid(c);
  assert.ok(anyMatch(violations, /AOA_STAGING_UNDOCUMENTED_KNOB|not documented/i), violations.join("\n"));
});

// §2.7 — autoscaling limits bounded.
test("REJECT (§2.7): a worker with no autoscaling max (unbounded replica count)", () => {
  const c = clone(validCompose());
  delete c.services["worker-a1"].labels[AUTOSCALE_MAX_LABEL];
  const { violations } = evalValid(c);
  assert.ok(anyMatch(violations, /autoscal/i), violations.join("\n"));
});

test("REJECT (§2.7): a worker with min > max autoscaling bounds", () => {
  const c = clone(validCompose());
  c.services["worker-a1"].labels[AUTOSCALE_MIN_LABEL] = "9";
  const { violations } = evalValid(c);
  assert.ok(anyMatch(violations, /autoscal/i), violations.join("\n"));
});

// Structural: failure-domain split (D1 — two failure domains, 1 CP + 2 workers each).
test("REJECT (failure-domain): a worker mislabeled into the wrong domain", () => {
  const c = clone(validCompose());
  c.services["worker-a1"].labels[FAILURE_DOMAIN_LABEL] = "domain-b";
  const { violations } = evalValid(c);
  assert.ok(anyMatch(violations, /failure-domain|failure domain/i), violations.join("\n"));
});

// Structural: `x-`-prefixed label keys are Compose EXTENSION fields (hoisted into
// `#extensions`, dropped from the rendered model) — the topology metadata MUST use real
// `com.aoa.*` label keys, so the pins must not regress to an `x-` prefix.
test("label keys are real (non-x-) label keys so compose does not hoist them to #extensions", () => {
  for (const label of [FAILURE_DOMAIN_LABEL, AUTOSCALE_MIN_LABEL, AUTOSCALE_MAX_LABEL, DRAIN_HOOK_LABEL]) {
    assert.ok(!/^x-/.test(label), `label pin '${label}' must not be x- prefixed (compose hoists x- keys to #extensions)`);
  }
});

// Structural: external stores are pointers, not embedded services.
test("REJECT (external stores): an embedded postgres service (must be external)", () => {
  const c = clone(validCompose());
  c.services["postgres"] = { image: "pgvector/pgvector:pg18", networks: ["store-egress-net"] };
  const { violations } = evalValid(c);
  assert.ok(anyMatch(violations, /unexpected service|embedded/i), violations.join("\n"));
});

// Structural: images injected from admitted-digest env vars, never hardcoded.
test("REJECT (image ref): a hardcoded (non-injected) worker image", () => {
  const c = clone(validCompose());
  c.services["worker-a1"].image = "ghcr.io/meteoritelabs/aoa-worker@sha256:deadbeef";
  const { violations } = evalValid(c);
  assert.ok(anyMatch(violations, /image.*must be injected/i), violations.join("\n"));
});

test("REJECT (image ref): a hardcoded attacker image that merely embeds the injection token", () => {
  const c = clone(validCompose());
  // Fully hardcoded, non-interpolated attacker ref that contains the token as a path
  // component — a bare `includes(token)` gate would have accepted it.
  c.services["worker-a1"].image = "ghcr.io/evil/AOA_STAGING_WORKER_IMAGE@sha256:deadbeef";
  const { violations } = evalValid(c);
  assert.ok(anyMatch(violations, /image.*must be injected/i), violations.join("\n"));
});

// =============================================================================
// DEP-015 — the shipped CI boot overlay and the ONE scoped default-off admission.
//
// The admission is the dangerous edit in this ticket: it lets a worker carry the switches
// DEP-010 bans. So the tests below are mostly REDS. The load-bearing one is the positive
// control the ticket names — the overlay's own worker env, grafted onto the BASE staging
// manifest, still reds — plus proof that every way of widening the admission (another path,
// another worker, another value, the base workers, the inline vector, the in-worker provider)
// reds too.
// =============================================================================

const overlayPath = path.join(repoRoot, SHIPPED_BOOT_OVERLAY_PATH);
const realBase = () => parseYaml(readFileSync(composePath, "utf8"));
const realOverlay = () => parseYaml(readFileSync(overlayPath, "utf8"));
const evalOverlay = (base, overlay, overlayPathArg = SHIPPED_BOOT_OVERLAY_PATH) =>
  evaluateShippedBootOverlayInvariants(base, overlay, { overlayPath: overlayPathArg }).violations;

test("DEP-015: the REAL overlay over the REAL staging manifest satisfies the shipped-boot contract", () => {
  const violations = evalOverlay(realBase(), realOverlay());
  assert.deepEqual(violations, [], violations.join("\n"));
});

test("DEP-015: the real overlay declares exactly the three shipped-boot workers, each armed", () => {
  const overlay = realOverlay();
  for (const name of SHIPPED_BOOT_OVERLAY_WORKERS) {
    const env = overlay.services[name].environment;
    for (const [key, value] of Object.entries(SHIPPED_BOOT_ADMITTED_DISPATCH_ENV)) {
      assert.equal(env[key], value, `${name} ${key}`);
    }
  }
});

test("DEP-015 POSITIVE CONTROL: the overlay's worker env on the BASE staging manifest still reds", () => {
  const base = realBase();
  const armed = realOverlay().services["m1-worker-a"].environment;
  base.services["worker-a1"].environment = { ...base.services["worker-a1"].environment, ...armed };
  const documentedEnvKeys = collectDocumentedEnvKeys(readFileSync(envDocPath, "utf8"));
  const { violations } = evaluateStagingManifestInvariants(base, { documentedEnvKeys });
  assert.ok(anyMatch(violations, /DISPATCH-DEFAULT.*worker-a1.*AOA_WORKER_PROVIDER_URL/), violations.join("\n"));
  assert.ok(anyMatch(violations, /DISPATCH-DEFAULT.*worker-a1.*AOA_WORKER_DISPATCH_ENABLED/), violations.join("\n"));
});

test("DEP-015 POSITIVE CONTROL: base + overlay through the UNSCOPED staging path reds on every overlay worker", () => {
  const merged = mergeComposeModel(realBase(), realOverlay());
  // Even handed options that LOOK like an allowance — the unscoped path has no parameter that
  // can carry the module-private admission.
  const violations = evaluateStagingManifestInvariants(merged, {
    dispatchAllowance: true,
    overlayPath: SHIPPED_BOOT_OVERLAY_PATH,
  }).violations;
  for (const name of SHIPPED_BOOT_OVERLAY_WORKERS) {
    assert.ok(
      anyMatch(violations, new RegExp(`DISPATCH-DEFAULT.*'${name}'.*AOA_WORKER_PROVIDER_URL`)),
      `${name}:\n${violations.join("\n")}`,
    );
  }
});

test("DEP-015 REJECT: the admission is bound to the one overlay path", () => {
  const violations = evalOverlay(realBase(), realOverlay(), "docker/campaign/docker-compose.campaign.yml");
  assert.ok(anyMatch(violations, /scoped to 'docker\/m1-boot\/docker-compose\.m1-boot\.yml' ONLY/), violations.join("\n"));
});

test("DEP-015 REJECT: the admission never reaches a BASE staging worker, even inside the overlay", () => {
  const overlay = realOverlay();
  overlay.services["worker-a1"] = { environment: { AOA_WORKER_PROVIDER_URL: "http://adapter-manager:8090" } };
  const violations = evalOverlay(realBase(), overlay);
  assert.ok(anyMatch(violations, /DISPATCH-DEFAULT.*'worker-a1'.*AOA_WORKER_PROVIDER_URL/), violations.join("\n"));
});

test("DEP-015 REJECT: an UNLISTED worker in the overlay is held to default-off (enumerated by image/name)", () => {
  const overlay = realOverlay();
  overlay.services["m1-worker-d"] = structuredClone(overlay.services["m1-worker-a"]);
  const violations = evalOverlay(realBase(), overlay);
  assert.ok(anyMatch(violations, /DISPATCH-DEFAULT.*'m1-worker-d'/), violations.join("\n"));
  assert.ok(anyMatch(violations, /shipped-boot workers .* != the declared/), violations.join("\n"));
});

test("DEP-015 REJECT: a provider URL that is not the adapter-manager (e.g. a fabricating fake provider)", () => {
  const overlay = realOverlay();
  overlay.services["m1-worker-b"].environment.AOA_WORKER_PROVIDER_URL = "http://fake-provider:8080";
  const violations = evalOverlay(realBase(), overlay);
  assert.ok(anyMatch(violations, /DISPATCH-DEFAULT.*'m1-worker-b'.*AOA_WORKER_PROVIDER_URL/), violations.join("\n"));
});

test("DEP-015 REJECT: an in-worker sandbox provider is never admitted", () => {
  const overlay = realOverlay();
  overlay.services["m1-worker-a"].environment.AOA_WORKER_SANDBOX_PROVIDER = "e2b";
  const violations = evalOverlay(realBase(), overlay);
  assert.ok(anyMatch(violations, /DISPATCH-DEFAULT.*'m1-worker-a'.*AOA_WORKER_SANDBOX_PROVIDER/), violations.join("\n"));
});

test("DEP-015 REJECT: the inline command vector is never admitted, even for an admitted key", () => {
  const overlay = realOverlay();
  overlay.services["m1-worker-c"].command = ["sh", "-c", "AOA_WORKER_PROVIDER_URL=http://adapter-manager:8090 exec node x.js"];
  const violations = evalOverlay(realBase(), overlay);
  assert.ok(anyMatch(violations, /DISPATCH-DEFAULT.*'m1-worker-c'.*inline-injection/), violations.join("\n"));
});

test("DEP-015 REJECT: an overlay worker that LOST its provider URL (boots, enrols, never runs a job)", () => {
  const overlay = realOverlay();
  delete overlay.services["m1-worker-a"].environment.AOA_WORKER_PROVIDER_URL;
  const violations = evalOverlay(realBase(), overlay);
  assert.ok(anyMatch(violations, /'m1-worker-a' must set 'AOA_WORKER_PROVIDER_URL'/), violations.join("\n"));
});

test("DEP-017: every real shipped-boot worker arms the live env-absence probe", () => {
  const overlay = realOverlay();
  for (const name of SHIPPED_BOOT_OVERLAY_WORKERS) {
    assert.equal(overlay.services[name].environment.AOA_WORKER_ENV_PROBE, "1", name);
  }
});

test("DEP-017 REJECT (positive control): an overlay worker that DROPPED the env probe", () => {
  const overlay = realOverlay();
  delete overlay.services["m1-worker-b"].environment.AOA_WORKER_ENV_PROBE;
  const violations = evalOverlay(realBase(), overlay);
  assert.ok(anyMatch(violations, /'m1-worker-b' must set 'AOA_WORKER_ENV_PROBE'/), violations.join("\n"));
});

test("DEP-017 REJECT: an overlay worker whose env probe is not exactly \"1\"", () => {
  const overlay = realOverlay();
  overlay.services["m1-worker-c"].environment.AOA_WORKER_ENV_PROBE = "true";
  const violations = evalOverlay(realBase(), overlay);
  assert.ok(anyMatch(violations, /'m1-worker-c' must set 'AOA_WORKER_ENV_PROBE'/), violations.join("\n"));
});

test("DEP-024: every real shipped-boot worker forwards the bounded run-output redaction probe", () => {
  const overlay = realOverlay();
  for (const name of SHIPPED_BOOT_OVERLAY_WORKERS) {
    assert.equal(overlay.services[name].environment.AOA_WORKER_RUN_OUTPUT_PROBE, "1", name);
  }
});

test("DEP-024 REJECT (positive control): an overlay worker that DROPPED the run-output probe", () => {
  const overlay = realOverlay();
  delete overlay.services["m1-worker-a"].environment.AOA_WORKER_RUN_OUTPUT_PROBE;
  const violations = evalOverlay(realBase(), overlay);
  assert.ok(anyMatch(violations, /'m1-worker-a' must set 'AOA_WORKER_RUN_OUTPUT_PROBE'/), violations.join("\n"));
});

test("DEP-024 REJECT: an overlay worker whose run-output probe is not exactly \"1\"", () => {
  const overlay = realOverlay();
  overlay.services["m1-worker-b"].environment.AOA_WORKER_RUN_OUTPUT_PROBE = "true";
  const violations = evalOverlay(realBase(), overlay);
  assert.ok(anyMatch(violations, /'m1-worker-b' must set 'AOA_WORKER_RUN_OUTPUT_PROBE'/), violations.join("\n"));
});

test("DEP-015 REJECT: the E2B key on a shipped-boot worker (the provider-control boundary still holds)", () => {
  const overlay = realOverlay();
  overlay.services["m1-worker-a"].environment.E2B_API_KEY = "${E2B_API_KEY}";
  const violations = evalOverlay(realBase(), overlay);
  assert.ok(anyMatch(violations, /PROVIDER-CONTROL VIOLATION: service 'm1-worker-a'/), violations.join("\n"));
});

test("DEP-015 REJECT (F10): a control-plane replica without the tenant-set rollout", () => {
  const overlay = realOverlay();
  delete overlay.services["control-plane-b"].environment[DISTRIBUTED_EXECUTION_ROLLOUT_ENV];
  const violations = evalOverlay(realBase(), overlay);
  assert.ok(anyMatch(violations, /replica 'control-plane-b' must set 'AOA_DISTRIBUTED_EXECUTION_ROLLOUT'/), violations.join("\n"));
});

test("DEP-015 REJECT (F10): a rollout that can render empty instead of the one fail-loud job variable", () => {
  const overlay = realOverlay();
  overlay.services["control-plane"].environment[DISTRIBUTED_EXECUTION_ROLLOUT_ENV] = "${AOA_M1_DISTRIBUTED_EXECUTION_ROLLOUT:-}";
  const violations = evalOverlay(realBase(), overlay);
  assert.ok(
    anyMatch(violations, /replica 'control-plane' 'AOA_DISTRIBUTED_EXECUTION_ROLLOUT' must be injected/),
    violations.join("\n"),
  );
});

test("DEP-015 REJECT (S0-8): the crew switch on, or merely unpinned, on any control-plane replica", () => {
  for (const value of ["true", "1", undefined]) {
    const overlay = realOverlay();
    if (value === undefined) delete overlay.services["control-plane-b"].environment[DISTRIBUTED_CREW_ROLLOUT_ENABLED_ENV];
    else overlay.services["control-plane-b"].environment[DISTRIBUTED_CREW_ROLLOUT_ENABLED_ENV] = value;
    const violations = evalOverlay(realBase(), overlay);
    assert.ok(
      anyMatch(violations, /replica 'control-plane-b' must set 'AOA_DISTRIBUTED_CREW_ROLLOUT_ENABLED' to exactly "false"/),
      `${String(value)}:\n${violations.join("\n")}`,
    );
  }
});

test("DEP-015 rendered mode: an engine-merged render passes scoped and reds unscoped", () => {
  // The shape of `docker compose config --format json`: concrete tags, concrete env values.
  const rendered = mergeComposeModel(realBase(), realOverlay());
  for (const svc of Object.values(rendered.services)) {
    if (typeof svc.image === "string" && svc.image.includes("WORKER_IMAGE")) svc.image = "localhost/aoa/worker:0123abc";
  }
  rendered.services["control-plane"].environment[DISTRIBUTED_EXECUTION_ROLLOUT_ENV] = '{"organizations":{}}';
  rendered.services["control-plane-b"].environment[DISTRIBUTED_EXECUTION_ROLLOUT_ENV] = '{"organizations":{}}';
  rendered.services["adapter-manager"].environment.E2B_API_KEY = "";
  const scoped = evaluateShippedBootOverlayInvariants(rendered, null, {
    overlayPath: SHIPPED_BOOT_OVERLAY_PATH,
    rendered: true,
  }).violations;
  assert.deepEqual(scoped, [], scoped.join("\n"));
  const unscoped = evaluateStagingManifestInvariants(rendered).violations;
  assert.ok(anyMatch(unscoped, /DISPATCH-DEFAULT/), unscoped.join("\n"));

  rendered.services["control-plane"].environment[DISTRIBUTED_CREW_ROLLOUT_ENABLED_ENV] = "true";
  const red = evaluateShippedBootOverlayInvariants(rendered, null, {
    overlayPath: SHIPPED_BOOT_OVERLAY_PATH,
    rendered: true,
  }).violations;
  assert.ok(anyMatch(red, /replica 'control-plane' must set 'AOA_DISTRIBUTED_CREW_ROLLOUT_ENABLED'/), red.join("\n"));
});

// =============================================================================
// DEP-015 follow-up (keyed run 35601445269) — the grant redeemers reach and trust the store.
//
// The E2B provider redeems staged-file grants IN THE ADAPTER-MANAGER. The first keyed run
// failed at `stage_files` because the adapter-manager had neither the presign store's network
// nor its CA, and no check looked. These cases pin both, with the reds that make it a check.
// =============================================================================

test("GRANT-REACH/TRUST: the adapter-manager is the declared grant redeemer", () => {
  assert.deepEqual(GRANT_REDEEMING_SERVICES, ["adapter-manager"]);
});

test("GRANT-REACH/TRUST: the REAL overlay puts the adapter-manager on the store network with the store CA", () => {
  const merged = mergeComposeModel(realBase(), realOverlay());
  const am = merged.services["adapter-manager"];
  assert.ok(am.networks.includes("store-egress-net"), JSON.stringify(am.networks));
  assert.equal(am.environment.NODE_EXTRA_CA_CERTS, "/certs/ca.crt");
  assert.ok(am.volumes.some((vol) => String(vol).endsWith(":/certs/ca.crt:ro")), JSON.stringify(am.volumes));
  // The base staging manifest is NOT touched: its adapter-manager stays off the store net.
  assert.ok(!realBase().services["adapter-manager"].networks.includes("store-egress-net"));
});

test("POSITIVE CONTROL (GRANT-REACH): drop the store network from the adapter-manager and it reds", () => {
  const overlay = realOverlay();
  overlay.services["adapter-manager"].networks = ["control-net", "provider-ctl-net"];
  const violations = evalOverlay(realBase(), overlay);
  assert.ok(anyMatch(violations, /GRANT-REACH VIOLATION: 'adapter-manager'.*presign store 'minio'/), violations.join("\n"));
});

test("POSITIVE CONTROL (GRANT-TRUST): drop the CA env from the adapter-manager and it reds", () => {
  const overlay = realOverlay();
  delete overlay.services["adapter-manager"].environment.NODE_EXTRA_CA_CERTS;
  const violations = evalOverlay(realBase(), overlay);
  assert.ok(anyMatch(violations, /GRANT-TRUST VIOLATION: 'adapter-manager'.*does not trust its CA/), violations.join("\n"));
});

test("REJECT (GRANT-TRUST): the CA env set but no file mounted at it", () => {
  const overlay = realOverlay();
  delete overlay.services["adapter-manager"].volumes;
  const violations = evalOverlay(realBase(), overlay);
  assert.ok(anyMatch(violations, /GRANT-TRUST VIOLATION: 'adapter-manager'.*mounted: false/), violations.join("\n"));
});

test("REJECT (GRANT-TRUST): a CA that is not the one the signing control plane trusts", () => {
  const overlay = realOverlay();
  overlay.services["adapter-manager"].volumes = ["./docker/other/ca.crt:/certs/ca.crt:ro"];
  const violations = evalOverlay(realBase(), overlay);
  assert.ok(anyMatch(violations, /GRANT-TRUST VIOLATION: 'adapter-manager' trusts/), violations.join("\n"));
});

test("REJECT: the two control-plane replicas presigning for different stores", () => {
  const overlay = realOverlay();
  overlay.services["control-plane-b"].environment.AOA_STORAGE_S3_PRESIGN_ENDPOINT = "https://other-store:9000";
  const violations = evalOverlay(realBase(), overlay);
  assert.ok(anyMatch(violations, /disagree on 'AOA_STORAGE_S3_PRESIGN_ENDPOINT'/), violations.join("\n"));
});

test("GRANT-REACH/TRUST in rendered mode (the lane's live check): absolute bind paths and long-form volumes", () => {
  const rendered = mergeComposeModel(realBase(), realOverlay());
  for (const svc of Object.values(rendered.services)) {
    if (typeof svc.image === "string" && svc.image.includes("WORKER_IMAGE")) svc.image = "localhost/aoa/worker:0123abc";
    svc.volumes = (svc.volumes ?? []).map((vol) => {
      const [source, target] = String(vol).split(":");
      return { type: "bind", source: source.replace(/^\.\//, "/home/runner/work/AoA/AoA/"), target, read_only: true };
    });
  }
  for (const cp of ["control-plane", "control-plane-b"]) rendered.services[cp].environment[DISTRIBUTED_EXECUTION_ROLLOUT_ENV] = '{"organizations":{}}';
  rendered.services["adapter-manager"].environment.E2B_API_KEY = "";
  const ok = evaluateShippedBootOverlayInvariants(rendered, null, { overlayPath: SHIPPED_BOOT_OVERLAY_PATH, rendered: true }).violations;
  assert.deepEqual(ok, [], ok.join("\n"));
  rendered.services["adapter-manager"].networks = ["control-net", "provider-ctl-net"];
  const red = evaluateShippedBootOverlayInvariants(rendered, null, { overlayPath: SHIPPED_BOOT_OVERLAY_PATH, rendered: true }).violations;
  assert.ok(anyMatch(red, /GRANT-REACH VIOLATION/), red.join("\n"));
});

// Codex (PR #561): the CA reference must hold on EVERY control-plane replica, not only the first.
test("REJECT (GRANT-TRUST): the SECOND control-plane replica without the store CA", () => {
  const overlay = realOverlay();
  delete overlay.services["control-plane-b"].environment.NODE_EXTRA_CA_CERTS;
  const violations = evalOverlay(realBase(), overlay);
  assert.ok(anyMatch(violations, /GRANT-TRUST VIOLATION: control-plane replica 'control-plane-b'.*does not trust its CA/), violations.join("\n"));
});

test("REJECT (GRANT-TRUST): the FIRST control-plane replica without the CA mount (no silent pass for the redeemer)", () => {
  const overlay = realOverlay();
  delete overlay.services["control-plane"].volumes;
  const violations = evalOverlay(realBase(), overlay);
  assert.ok(anyMatch(violations, /GRANT-TRUST VIOLATION: control-plane replica 'control-plane'.*does not trust its CA/), violations.join("\n"));
});

test("REJECT (GRANT-TRUST): the replicas trusting DIFFERENT CAs", () => {
  const overlay = realOverlay();
  overlay.services["control-plane-b"].volumes = ["./docker/other/ca.crt:/certs/ca.crt:ro"];
  const violations = evalOverlay(realBase(), overlay);
  assert.ok(anyMatch(violations, /the control-plane replicas trust different CAs/), violations.join("\n"));
});
