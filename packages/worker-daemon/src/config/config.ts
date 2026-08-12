/**
 * Strict worker configuration parser (WRK-001).
 *
 * `loadWorkerConfig(env)` is a pure, throwing parser: any invalid endpoint,
 * unparseable boolean/enum/int, non-loopback health host, or inconsistent
 * trust/scope combination throws BEFORE any I/O, and the entrypoint exits
 * non-zero before opening a socket. It NEVER reads a database URL — a present
 * `*_DATABASE_URL` is neither required nor consulted.
 */

import { parseEnumEnv, parseIntEnv, parseUnitFloatEnv, type Env } from "./env.js";

/**
 * The worker's declared version string. Hardcoded rather than imported from
 * package.json: a `../package.json` import would escape the `src` rootDir and
 * break the leaf-package tsconfig. DEP-001 stamps the released image version.
 */
export const WORKER_VERSION = "0.1.0";

/** Device-key custody mode (WRK-002 binds concrete stores). */
export const KEY_STORE_MODES = ["mounted_secret", "os_keychain"] as const;
export type KeyStoreMode = (typeof KEY_STORE_MODES)[number];

/** Registered-target scope the worker enrolls under (it can only narrow). */
export const TARGET_SCOPES = ["platform", "organization", "owner"] as const;
export type TargetScope = (typeof TARGET_SCOPES)[number];

/** Where the enrollment code is read from — the SOURCE, never the code itself. */
export type EnrollmentCodeSource =
  | { readonly kind: "path"; readonly path: string }
  | { readonly kind: "env"; readonly envVar: string };

export interface WorkerConfig {
  readonly controlPlaneBaseUrl: string;
  readonly enrollmentCodeSource: EnrollmentCodeSource;
  readonly keyStoreMode: KeyStoreMode;
  readonly targetScope: TargetScope;
  readonly concurrency: {
    readonly batch: number;
    readonly browser: number;
    readonly service: number;
  };
  readonly pollTimeoutMs: number;
  readonly backoff: {
    readonly baseMs: number;
    readonly maxMs: number;
    readonly jitter: number;
  };
  readonly health: {
    readonly host: string;
    readonly port: number;
  };
}

/** Env var names the worker reads (documented here, never logged with values). */
export const ENV = {
  controlPlaneUrl: "AOA_WORKER_CONTROL_PLANE_URL",
  enrollmentCodeFile: "AOA_WORKER_ENROLLMENT_CODE_FILE",
  enrollmentCodeEnv: "AOA_WORKER_ENROLLMENT_CODE_ENV",
  keyStoreMode: "AOA_WORKER_KEY_STORE_MODE",
  targetScope: "AOA_WORKER_TARGET_SCOPE",
  concurrencyBatch: "AOA_WORKER_CONCURRENCY_BATCH",
  concurrencyBrowser: "AOA_WORKER_CONCURRENCY_BROWSER",
  concurrencyService: "AOA_WORKER_CONCURRENCY_SERVICE",
  pollTimeoutMs: "AOA_WORKER_POLL_TIMEOUT_MS",
  backoffBaseMs: "AOA_WORKER_BACKOFF_BASE_MS",
  backoffMaxMs: "AOA_WORKER_BACKOFF_MAX_MS",
  backoffJitter: "AOA_WORKER_BACKOFF_JITTER",
  healthHost: "AOA_WORKER_HEALTH_HOST",
  healthPort: "AOA_WORKER_HEALTH_PORT",
} as const;

// Numeric loopback ONLY (no `localhost`): a hosts-file remap of a name could
// make the health/metrics surface routable while still "passing" a name check.
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1"]);

/** True iff `host` is a loopback bind address. */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host);
}

function parseControlPlaneUrl(env: Env): string {
  const raw = env[ENV.controlPlaneUrl]?.trim();
  if (raw === undefined || raw === "") {
    throw new Error(`${ENV.controlPlaneUrl} is required (an absolute http(s) control-plane URL)`);
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // NEVER echo the raw value — a control-plane URL may carry userinfo
    // (`https://user:token@host`); the env-var name alone identifies the fault.
    throw new Error(`${ENV.controlPlaneUrl} is not an absolute http(s) URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `${ENV.controlPlaneUrl} must use an http(s) scheme, got ${JSON.stringify(url.protocol)}`,
    );
  }
  return raw;
}

function parseEnrollmentCodeSource(env: Env): EnrollmentCodeSource {
  const file = env[ENV.enrollmentCodeFile]?.trim();
  const envVar = env[ENV.enrollmentCodeEnv]?.trim();
  const hasFile = file !== undefined && file !== "";
  const hasEnv = envVar !== undefined && envVar !== "";
  if (hasFile && hasEnv) {
    throw new Error(
      `${ENV.enrollmentCodeFile} and ${ENV.enrollmentCodeEnv} are mutually exclusive; ` +
        "set exactly one enrollment-code source",
    );
  }
  // Only the SOURCE (a file path or an env-var NAME) is retained — never the
  // enrollment code value itself, which stays out of the parsed config.
  if (hasFile) return Object.freeze({ kind: "path", path: file } as const);
  if (hasEnv) return Object.freeze({ kind: "env", envVar } as const);
  throw new Error(
    `an enrollment-code source is required: set ${ENV.enrollmentCodeFile} or ${ENV.enrollmentCodeEnv}`,
  );
}

// E4-D10: keyStoreMode (device-key CUSTODY, a deployment-mode property) and
// targetScope (a property of the enrollment CODE, validated by the control plane
// at enrollment/placement) are ORTHOGONAL in the authoritative model:
// worker-enrollment scope is `organization | owner`, `execution_targets` scope is
// defined by org/owner nullability, and `workerPlatformSchema` carries no custody
// dimension. The worker therefore enforces NO config-load custody↔scope coupling
// (an earlier invented coupling wrongly rejected valid deployments such as a
// desktop org-scoped worker or a container owner-scoped worker). Each field is
// still validated independently against its own closed enum above.

export function loadWorkerConfig(env: Env): WorkerConfig {
  const controlPlaneBaseUrl = parseControlPlaneUrl(env);
  const enrollmentCodeSource = parseEnrollmentCodeSource(env);
  const keyStoreMode = parseEnumEnv(env, ENV.keyStoreMode, KEY_STORE_MODES);
  const targetScope = parseEnumEnv(env, ENV.targetScope, TARGET_SCOPES);

  const concurrency = Object.freeze({
    batch: parseIntEnv(env, ENV.concurrencyBatch, { defaultValue: 1, min: 0, max: 10000 }),
    browser: parseIntEnv(env, ENV.concurrencyBrowser, { defaultValue: 1, min: 0, max: 10000 }),
    service: parseIntEnv(env, ENV.concurrencyService, { defaultValue: 1, min: 0, max: 10000 }),
  });

  const pollTimeoutMs = parseIntEnv(env, ENV.pollTimeoutMs, {
    defaultValue: 30_000,
    min: 1_000,
    max: 600_000,
  });

  const baseMs = parseIntEnv(env, ENV.backoffBaseMs, { defaultValue: 1_000, min: 1, max: 600_000 });
  const maxMs = parseIntEnv(env, ENV.backoffMaxMs, { defaultValue: 30_000, min: 1, max: 3_600_000 });
  const jitter = parseUnitFloatEnv(env, ENV.backoffJitter, 0.5);
  if (maxMs < baseMs) {
    throw new Error(
      `${ENV.backoffMaxMs} (${maxMs}) must be >= ${ENV.backoffBaseMs} (${baseMs})`,
    );
  }
  const backoff = Object.freeze({ baseMs, maxMs, jitter });

  const host = env[ENV.healthHost]?.trim() || "127.0.0.1";
  if (!isLoopbackHost(host)) {
    throw new Error(
      `${ENV.healthHost}=${JSON.stringify(host)} is not a loopback address; ` +
        "the health/metrics surface must bind loopback only",
    );
  }
  const port = parseIntEnv(env, ENV.healthPort, { defaultValue: 9_464, min: 1, max: 65_535 });
  const health = Object.freeze({ host, port });

  return Object.freeze({
    controlPlaneBaseUrl,
    enrollmentCodeSource,
    keyStoreMode,
    targetScope,
    concurrency,
    pollTimeoutMs,
    backoff,
    health,
  });
}
