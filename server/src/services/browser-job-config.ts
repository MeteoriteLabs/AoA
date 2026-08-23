// server/src/services/browser-job-config.ts
//
// BRW-001 — normalise a browser job's submission `input` into the FROZEN
// `browserWorkloadV1Schema` shape, at submit time.
//
// WHY THIS EXISTS. `buildJobEnvelope` (job-leasing.ts) passes the job's raw `input` blob
// straight through as the workload and gates it only with `jobEnvelopeV1Schema.safeParse`,
// which returns null — and therefore NO LEASE — on any mismatch. The submission surface
// types that blob as `z.record(z.unknown())` bounded only at 64 KiB. Without this module a
// browser job submits successfully and then silently never leases, with the failure
// surfacing far from its cause as an absence rather than an error.
//
//   submit(input: unknown)                         <-- caller, untyped
//        |
//        v
//   normalizeBrowserJobInput  ---- reject ---->    400 at SUBMIT (the caller can act)
//        |  accept
//        v
//   job.input := BrowserWorkloadV1                 <-- already frozen-valid
//        |
//        v
//   buildJobEnvelope: workload = job.input         <-- unchanged pass-through, now parses
//
// The FROZEN schema is the final authority, not this module: every accepted output is
// re-validated against `browserWorkloadV1Schema` before being returned, so the normaliser
// cannot drift from the wire contract.
//
// Pure and synchronous — no I/O, no database, no clock. The caller decides WHERE to run it;
// `submitJobWithinTenant` runs it strictly AFTER the admission gate so a denied caller
// cannot distinguish a malformed config from a valid one (BRW-001 review finding F1).
import { browserWorkloadV1Schema, type BrowserWorkloadV1 } from "@armyofagents/worker-protocol";

/** The frozen wire ceiling on `maxSessionSeconds` (`browserWorkloadV1Schema`, 1..43_200).
 * Mirrored here so the server ceiling can be checked against it; the frozen schema still
 * has the last word on every accepted value. */
export const FROZEN_MAX_SESSION_SECONDS = 43_200;

export interface BrowserSessionCeilings {
  readonly maxSessionSeconds: number;
}

/** Server-owned ceilings, deliberately BENEATH the frozen wire ceiling. The platform
 * ceiling is the authoritative bound; the frozen ceiling is the backstop. */
export const BROWSER_SESSION_CEILINGS: BrowserSessionCeilings = Object.freeze({
  maxSessionSeconds: 3_600,
});

/** The default session TTL applied when a caller omits one. Bounded by the ceiling. */
const DEFAULT_MAX_SESSION_SECONDS = 900;

// GUARD — a server ceiling above the frozen ceiling would let this module emit a workload
// the frozen schema rejects, reintroducing the silent-non-lease it exists to close. Fail at
// module load rather than at the first browser submission.
if (
  !Number.isInteger(BROWSER_SESSION_CEILINGS.maxSessionSeconds) ||
  BROWSER_SESSION_CEILINGS.maxSessionSeconds < 1 ||
  BROWSER_SESSION_CEILINGS.maxSessionSeconds > FROZEN_MAX_SESSION_SECONDS
) {
  throw new Error("browser session ceiling must be an integer within the frozen 1..43200 bound");
}
if (
  !Number.isInteger(DEFAULT_MAX_SESSION_SECONDS) ||
  DEFAULT_MAX_SESSION_SECONDS < 1 ||
  DEFAULT_MAX_SESSION_SECONDS > BROWSER_SESSION_CEILINGS.maxSessionSeconds
) {
  throw new Error("default browser session TTL must be within the server ceiling");
}

/** Why a browser configuration was refused. Machine-readable so the route can map it to a
 * status and the caller can act on it. */
export type BrowserConfigRejection =
  | "not_an_object"
  | "unknown_field"
  | "invalid_field"
  | "max_session_seconds_above_ceiling";

export type NormalizeBrowserJobInputResult =
  | { readonly ok: true; readonly value: BrowserWorkloadV1 }
  | { readonly ok: false; readonly reason: BrowserConfigRejection };

/** The exact key set a caller may supply. Anything else is refused rather than dropped: a
 * caller who smuggles `cookies` into the config must be told, not quietly ignored, or they
 * would believe a credential was delivered when it was not. */
const ALLOWED_FIELDS = new Set([
  "engine",
  "viewport",
  "locale",
  "timezone",
  "recordTrace",
  "recordVideo",
  "maxSessionSeconds",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Normalise a caller-supplied browser configuration into a frozen-valid workload.
 *
 * Applies defaults for the ergonomic fields, enforces the server session ceiling, and
 * validates the result against the frozen schema. Never throws; never mutates `raw`; emits
 * keys in a fixed order so an equivalent resubmission produces a byte-identical workload.
 */
export function normalizeBrowserJobInput(
  raw: unknown,
  ceilings: BrowserSessionCeilings = BROWSER_SESSION_CEILINGS,
): NormalizeBrowserJobInputResult {
  if (!isPlainObject(raw)) return { ok: false, reason: "not_an_object" };

  for (const key of Object.keys(raw)) {
    if (!ALLOWED_FIELDS.has(key)) return { ok: false, reason: "unknown_field" };
  }

  // Fixed key order — a stable serialisation is what makes an equivalent resubmission
  // produce an identical stored workload.
  const candidate = {
    engine: raw.engine ?? "chromium",
    viewport: raw.viewport ?? { width: 1280, height: 720 },
    locale: raw.locale ?? "en-US",
    timezone: raw.timezone ?? "UTC",
    recordTrace: raw.recordTrace ?? false,
    recordVideo: raw.recordVideo ?? false,
    maxSessionSeconds: raw.maxSessionSeconds ?? DEFAULT_MAX_SESSION_SECONDS,
  };

  // The server ceiling is checked BEFORE the frozen schema so an over-ceiling TTL carries
  // its own typed reason rather than a generic invalid-field one. A non-numeric value falls
  // through to the frozen schema, which rejects it.
  if (
    typeof candidate.maxSessionSeconds === "number" &&
    candidate.maxSessionSeconds > ceilings.maxSessionSeconds
  ) {
    return { ok: false, reason: "max_session_seconds_above_ceiling" };
  }

  const parsed = browserWorkloadV1Schema.safeParse(candidate);
  if (!parsed.success) return { ok: false, reason: "invalid_field" };
  return { ok: true, value: parsed.data };
}
