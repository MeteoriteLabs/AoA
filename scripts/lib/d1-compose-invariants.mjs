// -----------------------------------------------------------------------------
// d1-compose-invariants — pure static topology invariants for the DEP-002 D1
// isolated compose stack (`docker-compose.d1.yml`).
//
//   evaluateComposeInvariants(parsedCompose, options?) -> { violations: string[] }
//
// An empty `violations` array means the topology satisfies the DEP-002 network-
// segmentation matrix (§2.3 of the E6-deployment-test-harness plan). This module
// is PURE (no I/O): the runner `scripts/check-d1-compose.mjs` parses the YAML and
// feeds the object here; the node:test corpus feeds hand-built objects (including
// deliberately-broken ones) to prove the checks are non-vacuous.
//
// The load-bearing isolation invariant is `worker services MUST NOT be attached to
// data-net` (enforced in checkNetworkMatrix + checkWorkerNotOnDataNet below): a
// worker with a route to PostgreSQL breaks the tenant-data boundary.
// -----------------------------------------------------------------------------

export const DATA_NET = "data-net";
export const CONTROL_NET = "control-net";
export const WORKER_NET = "worker-net";
export const PROVIDER_CTL_NET = "provider-ctl-net";

export const ISOLATION_NETWORKS = [DATA_NET, CONTROL_NET, WORKER_NET, PROVIDER_CTL_NET];

/** The EXACT network-attachment matrix from plan §2.3 (order-independent sets). */
export const EXPECTED_NETWORKS = {
  postgres: [DATA_NET],
  minio: [DATA_NET, CONTROL_NET, WORKER_NET],
  "control-plane": [DATA_NET, CONTROL_NET, WORKER_NET, PROVIDER_CTL_NET],
  "worker-a": [CONTROL_NET, WORKER_NET, PROVIDER_CTL_NET],
  "worker-b": [CONTROL_NET, WORKER_NET, PROVIDER_CTL_NET],
  "fake-provider": [CONTROL_NET, WORKER_NET, PROVIDER_CTL_NET],
  // Toxiproxy sits in-path on control-plane<->postgres (data-net),
  // worker<->control-plane (control-net) and worker<->minio (worker-net); it needs
  // NO provider-ctl-net (no proxied provider link).
  toxiproxy: [DATA_NET, CONTROL_NET, WORKER_NET],
  migrate: [DATA_NET],
  "test-runner": [CONTROL_NET],
};

export const WORKER_SERVICES = ["worker-a", "worker-b"];

export const FAKE_PROVIDER_SERVICE = "fake-provider";
export const CONTROL_PLANE_SERVICE = "control-plane";

// FIX A — the control-endpoint peer allowlist that gates who may SCRIPT the fake
// provider (/script, /reset, /invocations). The boundary "control-plane must not
// script the fake" is enforced at the application layer (fake-provider-entry.mjs);
// this static invariant guards the compose-declared allowlist so a future edit
// cannot silently add control-plane to it and pass every gate that runs.
export const FAKE_PROVIDER_CTL_ALLOW_ENV = "AOA_FAKE_PROVIDER_CTL_ALLOW";
export const EXPECTED_CTL_ALLOW_PEERS = ["worker-a", "worker-b", "test-runner"];

// Run-to-completion job services: they EXIT after their command, so a long-running
// container healthcheck is meaningless. They are exempt from the healthcheck
// requirement, and services that depend on them use `service_completed_successfully`
// (not `service_healthy`). This is the principled reading of "every service has a
// healthcheck" for one-shot jobs (see docker/d1/README.md). `migrate` is the only
// one-shot; `test-runner` is a long-running idle in-stack utility (it must stay up
// so the host-driven live lane can `docker compose exec` into it), so it carries a
// (trivial) healthcheck like every other long-running service.
export const ONE_SHOT_SERVICES = ["migrate"];

const VALID_DEPENDS_CONDITIONS = ["service_healthy", "service_completed_successfully"];

// Env keys that must route a link through Toxiproxy (host === "toxiproxy") so the
// proxy is provably in-path for the three declared links.
const CONTROL_PLANE_DB_ENV = "DATABASE_URL";
const WORKER_CONTROL_PLANE_ENV = "AOA_WORKER_CONTROL_PLANE_URL";
const WORKER_S3_ENV = "AOA_WORKER_S3_ENDPOINT";
// Distinct-profile discriminator env key (worker-a vs worker-b must differ).
const WORKER_PROFILE_ID_ENV = "AOA_WORKER_TARGET_PROFILE_ID";

function asArray(value) {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function serviceNetworks(service) {
  const nets = service?.networks;
  if (nets === null || nets === undefined) return [];
  if (Array.isArray(nets)) return nets.map(String);
  if (typeof nets === "object") return Object.keys(nets); // long-form { net: {...} }
  return [String(nets)];
}

function envValue(service, key) {
  const env = service?.environment;
  if (env && typeof env === "object" && !Array.isArray(env)) {
    return env[key];
  }
  if (Array.isArray(env)) {
    for (const entry of env) {
      const s = String(entry);
      const idx = s.indexOf("=");
      if (idx !== -1 && s.slice(0, idx) === key) return s.slice(idx + 1);
    }
  }
  return undefined;
}

/** Enumerate a service's environment as [key, value] pairs (object OR `K=V` list form). */
function envEntries(service) {
  const env = service?.environment;
  if (env && typeof env === "object" && !Array.isArray(env)) {
    return Object.entries(env);
  }
  if (Array.isArray(env)) {
    return env.map((entry) => {
      const s = String(entry);
      const idx = s.indexOf("=");
      return idx === -1 ? [s, ""] : [s.slice(0, idx), s.slice(idx + 1)];
    });
  }
  return [];
}

/** Extract the host authority from a URL-ish or `host:port` string (best-effort). */
function extractHost(value) {
  if (typeof value !== "string" || value === "") return undefined;
  let s = value;
  const scheme = s.indexOf("://");
  if (scheme !== -1) s = s.slice(scheme + 3);
  if (s.includes("@")) s = s.slice(s.indexOf("@") + 1); // strip credentials
  // strip path/query
  s = s.split("/")[0].split("?")[0];
  // strip port (last colon that precedes only digits)
  s = s.replace(/:\d+$/, "");
  return s;
}

function setsEqual(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
}

// --- individual checks -------------------------------------------------------

function checkServiceSet(services, v) {
  const present = new Set(Object.keys(services));
  const expected = new Set(Object.keys(EXPECTED_NETWORKS));
  for (const name of expected) {
    if (!present.has(name)) v.push(`missing required service '${name}'`);
  }
  for (const name of present) {
    if (!expected.has(name)) v.push(`unexpected service '${name}' (not part of the D1 topology matrix)`);
  }
}

function checkNetworkMatrix(services, v) {
  for (const [name, expected] of Object.entries(EXPECTED_NETWORKS)) {
    const service = services[name];
    if (!service) continue; // reported by checkServiceSet
    const actual = serviceNetworks(service);
    if (!setsEqual(actual, expected)) {
      v.push(
        `service '${name}' network set {${[...new Set(actual)].sort().join(", ")}} != required {${[...expected].sort().join(", ")}}`,
      );
    }
  }
}

/** LOAD-BEARING: no worker service may be attached to data-net. */
function checkWorkerNotOnDataNet(services, v) {
  for (const name of WORKER_SERVICES) {
    const service = services[name];
    if (!service) continue;
    if (serviceNetworks(service).includes(DATA_NET)) {
      v.push(`ISOLATION VIOLATION: worker '${name}' MUST NOT be attached to '${DATA_NET}' (it must not reach PostgreSQL)`);
    }
  }
}

/**
 * FIX A — the fake-provider control-endpoint peer allowlist must be declared,
 * non-empty, and must NOT include the control-plane. `control-plane` sharing all
 * three of the fake's networks means Docker segmentation cannot express this
 * boundary; the app-layer allowlist (fake-provider-entry.mjs) does. This static
 * check guards the compose-declared value so a regression that adds control-plane
 * to the allowlist is caught by every gate, not only the AOA_D1_LIVE 403 proof.
 */
function checkFakeProviderCtlAllowlist(services, v) {
  const fake = services[FAKE_PROVIDER_SERVICE];
  if (!fake) return; // absence reported by checkServiceSet
  const raw = envValue(fake, FAKE_PROVIDER_CTL_ALLOW_ENV);
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    v.push(`'${FAKE_PROVIDER_SERVICE}' must declare a non-empty '${FAKE_PROVIDER_CTL_ALLOW_ENV}' (control-endpoint peer allowlist)`);
    return;
  }
  const peers = String(raw).split(",").map((s) => s.trim()).filter((s) => s !== "");
  if (peers.length === 0) {
    v.push(`'${FAKE_PROVIDER_SERVICE}' '${FAKE_PROVIDER_CTL_ALLOW_ENV}' is empty; it must list the allowlisted control-endpoint peers`);
    return;
  }
  if (peers.includes(CONTROL_PLANE_SERVICE)) {
    v.push(`ISOLATION VIOLATION: '${CONTROL_PLANE_SERVICE}' must not appear in '${FAKE_PROVIDER_SERVICE}' '${FAKE_PROVIDER_CTL_ALLOW_ENV}' (the control-plane may not script the fake provider)`);
  }
  if (!setsEqual(peers, EXPECTED_CTL_ALLOW_PEERS)) {
    v.push(`'${FAKE_PROVIDER_SERVICE}' '${FAKE_PROVIDER_CTL_ALLOW_ENV}' peer set {${[...new Set(peers)].sort().join(", ")}} != required {${[...EXPECTED_CTL_ALLOW_PEERS].sort().join(", ")}}`);
  }
}

// FIX C — a worker must carry NO PostgreSQL credential. toxiproxy is deliberately
// multi-homed (data-net + worker-net) and its :15432 control-plane->postgres proxy
// listens 0.0.0.0, so a worker's TCP path to postgres via toxiproxy:15432 is
// reachable BY DESIGN. Isolation therefore does NOT rely on hiding that port — it
// rests on (a) no direct worker->postgres:5432 route (worker not on data-net),
// (b) workers holding no DB credential (this check), and (c) E2 FORCE-RLS. A worker
// with a DSN or DB user/password could authenticate through the bridge, so forbid it.
const WORKER_DB_CRED_KEY_RE =
  /(?:^|_)DATABASE_UR[LI]$|^PG(?:PASSWORD|USER|DATABASE|HOST|PORT)$|(?:^|_)(?:POSTGRES|PG|DB)_(?:PASSWORD|PASS|USER|USERNAME|URL|URI|DSN)$/i;
const WORKER_DB_DSN_VALUE_RE = /\bpostgres(?:ql)?:\/\//i;
const WORKER_DB_ROLE_VALUE_RE = /\baoa_app\b/;

function checkWorkersHaveNoDbCredential(services, v) {
  for (const name of WORKER_SERVICES) {
    const service = services[name];
    if (!service) continue;
    for (const [key, value] of envEntries(service)) {
      const val = value === undefined || value === null ? "" : String(value);
      if (WORKER_DB_CRED_KEY_RE.test(String(key))) {
        v.push(`ISOLATION VIOLATION: worker '${name}' declares DB-credential env '${key}' (workers must carry NO PostgreSQL credential; even reaching toxiproxy:15432 they must be unable to authenticate)`);
        continue;
      }
      if (WORKER_DB_DSN_VALUE_RE.test(val) || WORKER_DB_ROLE_VALUE_RE.test(val)) {
        v.push(`ISOLATION VIOLATION: worker '${name}' env '${key}' carries a PostgreSQL credential/DSN (workers must carry NO PostgreSQL credential)`);
      }
    }
  }
}

function checkNetworksInternal(compose, v) {
  const defs = compose?.networks;
  if (!defs || typeof defs !== "object") {
    v.push("top-level 'networks:' block is missing");
    return;
  }
  for (const net of ISOLATION_NETWORKS) {
    if (!(net in defs)) {
      v.push(`network '${net}' is not declared at top level`);
      continue;
    }
    const def = defs[net];
    if (!def || def.internal !== true) {
      v.push(`network '${net}' must be declared 'internal: true' (no external egress)`);
    }
  }
}

function checkHealthchecks(services, v) {
  for (const [name, service] of Object.entries(services)) {
    if (ONE_SHOT_SERVICES.includes(name)) continue; // run-to-completion jobs are exempt
    const hc = service?.healthcheck;
    const test = hc?.test;
    const hasTest = typeof test === "string" ? test.trim() !== "" : Array.isArray(test) && test.length > 0;
    if (!hc || !hasTest) {
      v.push(`service '${name}' is missing a healthcheck (long-running services must declare 'healthcheck.test')`);
    }
  }
}

function checkDependsOn(services, v) {
  for (const [name, service] of Object.entries(services)) {
    const deps = service?.depends_on;
    if (deps === null || deps === undefined) continue;
    if (Array.isArray(deps)) {
      v.push(`service '${name}' uses short-form 'depends_on' (list); it must use the long form with 'condition:'`);
      continue;
    }
    if (typeof deps !== "object") {
      v.push(`service '${name}' has a malformed 'depends_on'`);
      continue;
    }
    for (const [dep, spec] of Object.entries(deps)) {
      const condition = spec?.condition;
      if (!VALID_DEPENDS_CONDITIONS.includes(condition)) {
        v.push(`service '${name}' depends_on '${dep}' with condition '${condition ?? "(none)"}'; expected one of ${VALID_DEPENDS_CONDITIONS.join("/")}`);
        continue;
      }
      if (ONE_SHOT_SERVICES.includes(dep) && condition !== "service_completed_successfully") {
        v.push(`service '${name}' depends_on one-shot job '${dep}' with '${condition}'; it must be 'service_completed_successfully'`);
      }
    }
  }
}

/** Deterministic startup: control-plane must wait for the migration job to finish. */
function checkMigrateGate(services, v) {
  const cp = services["control-plane"];
  const deps = cp?.depends_on;
  const migrate = deps && !Array.isArray(deps) ? deps.migrate : undefined;
  if (!migrate || migrate.condition !== "service_completed_successfully") {
    v.push("'control-plane' must depends_on 'migrate' with condition 'service_completed_successfully' (migrate completes before control-plane serves)");
  }
}

/** No two services may share a read-write volume/bind mount. */
function checkNoSharedRwVolume(compose, services, v) {
  const declaredVolumes = new Set(Object.keys(compose?.volumes ?? {}));
  const rwOwners = new Map(); // mount-key -> [serviceName, ...]
  for (const [name, service] of Object.entries(services)) {
    for (const mount of asArray(service?.volumes)) {
      // long-form object mount
      if (mount && typeof mount === "object") {
        const ro = mount.read_only === true;
        const key = `${mount.type ?? "volume"}:${mount.source ?? ""}`;
        if (!ro) pushOwner(rwOwners, key, name);
        if ((mount.type ?? "volume") === "volume" && mount.source && !declaredVolumes.has(mount.source)) {
          v.push(`service '${name}' mounts undeclared named volume '${mount.source}'`);
        }
        continue;
      }
      // short-form string mount:  SOURCE:TARGET[:MODE]
      const parts = String(mount).split(":");
      // On POSIX-style compose sources there are no drive letters; keep it simple.
      const source = parts[0];
      const mode = parts.length >= 3 ? parts[parts.length - 1] : "";
      const ro = mode === "ro";
      const named = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(source) && !source.startsWith(".") && !source.startsWith("/");
      const key = named ? `volume:${source}` : `bind:${source}`;
      if (!ro) pushOwner(rwOwners, key, name);
      if (named && !declaredVolumes.has(source)) {
        v.push(`service '${name}' mounts undeclared named volume '${source}'`);
      }
    }
  }
  for (const [key, owners] of rwOwners) {
    const uniqueOwners = [...new Set(owners)];
    if (uniqueOwners.length > 1) {
      v.push(`shared read-write mount '${key}' is used by multiple services: ${uniqueOwners.join(", ")} (no two services may share a rw mount)`);
    }
  }
}

function pushOwner(map, key, name) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(name);
}

/** ≥2 worker services registered with DISTINCT target profiles. */
function checkDistinctWorkerProfiles(services, v) {
  const presentWorkers = WORKER_SERVICES.filter((w) => services[w]);
  if (presentWorkers.length < 2) {
    v.push(`expected ≥2 worker services; found ${presentWorkers.length}`);
    return;
  }
  const ids = presentWorkers.map((w) => envValue(services[w], WORKER_PROFILE_ID_ENV));
  presentWorkers.forEach((w, i) => {
    if (!ids[i]) v.push(`worker '${w}' is missing a distinct '${WORKER_PROFILE_ID_ENV}' env value`);
  });
  const nonEmpty = ids.filter((x) => x !== undefined && x !== null && x !== "");
  if (new Set(nonEmpty).size !== nonEmpty.length) {
    v.push(`worker services must register DISTINCT target profiles; '${WORKER_PROFILE_ID_ENV}' values collide: ${JSON.stringify(ids)}`);
  }
}

/** Toxiproxy is provably in-path on the three declared links (env host routing). */
function checkToxiproxyInPath(services, v) {
  const cpDb = extractHost(envValue(services["control-plane"], CONTROL_PLANE_DB_ENV));
  if (cpDb !== "toxiproxy") {
    v.push(`control-plane<->postgres is not routed through toxiproxy: '${CONTROL_PLANE_DB_ENV}' host is '${cpDb ?? "(unset)"}', expected 'toxiproxy'`);
  }
  for (const w of WORKER_SERVICES) {
    if (!services[w]) continue;
    const cp = extractHost(envValue(services[w], WORKER_CONTROL_PLANE_ENV));
    if (cp !== "toxiproxy") {
      v.push(`worker '${w}'<->control-plane is not routed through toxiproxy: '${WORKER_CONTROL_PLANE_ENV}' host is '${cp ?? "(unset)"}', expected 'toxiproxy'`);
    }
    const s3 = extractHost(envValue(services[w], WORKER_S3_ENV));
    if (s3 !== "toxiproxy") {
      v.push(`worker '${w}'<->minio is not routed through toxiproxy: '${WORKER_S3_ENV}' host is '${s3 ?? "(unset)"}', expected 'toxiproxy'`);
    }
  }
}

// DAT-002 slice-7 — the control-plane's object-storage env for the live-MinIO tier.
// The frozen artifact grant `url` is strictly https (httpsUrlSchema) and the presign
// must fail closed on non-https, so the compose MUST wire an https PRESIGN endpoint;
// SigV4 requires the signed Host to equal the connected host, so path-style is forced
// (Host stays literally `toxiproxy:19000`). This static check guards those facts so a
// regression that reverts to http (or drops path-style / the s3 provider) is caught by
// every gate, not only the AOA_D1_LIVE round-trip.
const STORAGE_PROVIDER_ENV = "AOA_STORAGE_PROVIDER";
const STORAGE_S3_ENDPOINT_ENV = "AOA_STORAGE_S3_ENDPOINT";
const STORAGE_S3_PRESIGN_ENDPOINT_ENV = "AOA_STORAGE_S3_PRESIGN_ENDPOINT";
const STORAGE_S3_FORCE_PATH_STYLE_ENV = "AOA_STORAGE_S3_FORCE_PATH_STYLE";

function checkPresignEndpoint(services, v) {
  const cp = services[CONTROL_PLANE_SERVICE];
  if (!cp) return; // absence reported by checkServiceSet
  const provider = envValue(cp, STORAGE_PROVIDER_ENV);
  if (provider !== "s3") {
    v.push(`'${CONTROL_PLANE_SERVICE}' must set '${STORAGE_PROVIDER_ENV}=s3' for the live-MinIO artifact tier (got '${provider ?? "(unset)"}')`);
  }
  const endpoint = envValue(cp, STORAGE_S3_ENDPOINT_ENV);
  if (typeof endpoint !== "string" || !endpoint.startsWith("https://")) {
    v.push(`'${CONTROL_PLANE_SERVICE}' '${STORAGE_S3_ENDPOINT_ENV}' must be https (the internal S3 endpoint over TLS); got '${endpoint ?? "(unset)"}'`);
  }
  const presign = envValue(cp, STORAGE_S3_PRESIGN_ENDPOINT_ENV);
  if (typeof presign !== "string" || !presign.startsWith("https://")) {
    v.push(`'${CONTROL_PLANE_SERVICE}' '${STORAGE_S3_PRESIGN_ENDPOINT_ENV}' must be https (the frozen grant url is strictly https); got '${presign ?? "(unset)"}'`);
  }
  const pathStyle = envValue(cp, STORAGE_S3_FORCE_PATH_STYLE_ENV);
  if (String(pathStyle) !== "true") {
    v.push(`'${CONTROL_PLANE_SERVICE}' '${STORAGE_S3_FORCE_PATH_STYLE_ENV}' must be 'true' so the SigV4 Host matches the presign endpoint host; got '${pathStyle ?? "(unset)"}'`);
  }
}

/** control-plane / worker images must be injected from the DEP-001 admitted-digest
 * env vars — never a hardcoded (unadmitted) digest or tag in the committed file. */
function checkAdmittedImageRefs(services, v) {
  const cpImage = services["control-plane"]?.image;
  if (typeof cpImage !== "string" || !cpImage.includes("AOA_D1_CONTROL_PLANE_IMAGE")) {
    v.push("control-plane 'image' must be injected via ${AOA_D1_CONTROL_PLANE_IMAGE} (a DEP-001 admitted digest), not hardcoded");
  }
  for (const w of WORKER_SERVICES) {
    const img = services[w]?.image;
    if (typeof img !== "string" || !img.includes("AOA_D1_WORKER_IMAGE")) {
      v.push(`worker '${w}' 'image' must be injected via \${AOA_D1_WORKER_IMAGE} (a DEP-001 admitted digest), not hardcoded`);
    }
  }
}

/**
 * @param {any} compose parsed docker-compose.d1.yml
 * @param {{ toxiproxyConfig?: any }} [options]
 * @returns {{ violations: string[] }}
 */
export function evaluateComposeInvariants(compose, options = {}) {
  const v = [];
  const services = compose?.services;
  if (!services || typeof services !== "object") {
    return { violations: ["compose has no 'services' block"] };
  }

  checkServiceSet(services, v);
  checkNetworkMatrix(services, v);
  checkWorkerNotOnDataNet(services, v);
  checkFakeProviderCtlAllowlist(services, v);
  checkWorkersHaveNoDbCredential(services, v);
  checkNetworksInternal(compose, v);
  checkHealthchecks(services, v);
  checkDependsOn(services, v);
  checkMigrateGate(services, v);
  checkNoSharedRwVolume(compose, services, v);
  checkDistinctWorkerProfiles(services, v);
  checkToxiproxyInPath(services, v);
  checkAdmittedImageRefs(services, v);
  checkPresignEndpoint(services, v);

  if (options.toxiproxyConfig !== undefined) {
    v.push(...evaluateToxiproxyConfig(options.toxiproxyConfig));
  }

  return { violations: v };
}

/** The three declared in-path links Toxiproxy must proxy (name -> upstream). */
export const EXPECTED_TOXIPROXY_UPSTREAMS = {
  "control-plane-to-postgres": "postgres:5432",
  "worker-to-control-plane": "control-plane:3100",
  "worker-to-minio": "minio:9000",
};

/** Validate a parsed toxiproxy.json declares exactly the three in-path proxies. */
export function evaluateToxiproxyConfig(config) {
  const v = [];
  if (!Array.isArray(config)) {
    return ["toxiproxy config must be a JSON array of proxy definitions"];
  }
  const byName = new Map(config.map((p) => [p?.name, p]));
  for (const [name, upstream] of Object.entries(EXPECTED_TOXIPROXY_UPSTREAMS)) {
    const proxy = byName.get(name);
    if (!proxy) {
      v.push(`toxiproxy proxy '${name}' is not defined`);
      continue;
    }
    if (proxy.upstream !== upstream) {
      v.push(`toxiproxy proxy '${name}' upstream is '${proxy.upstream}', expected '${upstream}'`);
    }
    if (typeof proxy.listen !== "string" || proxy.listen === "") {
      v.push(`toxiproxy proxy '${name}' has no 'listen' address`);
    }
  }
  return v;
}
