// packages/worker-daemon/src/enrollment/hello-provisioning.ts
//
// WRK-011 — fold a self-model read RESPONSE into the `HelloProvisioning` a provisioned
// desktop reports. The self-model route (execution-targets.ts:379) is the daemon's source
// of the admin-ratified ceiling + policy; this derives, from that ceiling and what the device
// can actually provide, the capabilities the device is entitled AND able to advertise.
//
// D4 — FAIL TOWARD ABSENT. A malformed or missing registered profile returns `null` (never
// throws): a device that cannot read a valid self-model reports NO provisioning and stays
// unmatchable, which only costs placement opportunity. The intersection below is the same
// rule applied to capabilities — a device never reports a capability merely because the
// ceiling permits it.

import {
  registeredTargetProfileV1Schema,
  type WorkerCapability,
  type WorkerCapacity,
} from "@armyofagents/worker-protocol";
import { capabilitiesForIsolation, type IsolationMechanism } from "./isolation-capabilities.js";
import type { HelloProvisioning } from "./desktop-hello.js";

/**
 * The workload capabilities THIS daemon can actually supervise today. Batch only — the
 * supervisor for browser_session/service composes in later sprints, and D4 forbids reporting
 * a workload the daemon cannot run. Widening this is a deliberate edit, not a config.
 */
export const SUPERVISABLE_WORKLOAD_CAPABILITIES: readonly WorkerCapability[] = ["workload.batch"];

export function deriveHelloProvisioning(input: {
  /** The self-model read response body (`{ registeredProfile, providerConstraintProfile, … }`). */
  readonly selfModelResponse: unknown;
  /** The already-detected isolation mechanism (`none` until DSK-003 lands the per-OS probes). */
  readonly isolation: IsolationMechanism;
  /** The nameplate capacity to advertise (Math.min'd against the poll capacity server-side). */
  readonly capacity: WorkerCapacity;
}): HelloProvisioning | null {
  const response = input.selfModelResponse;
  if (response === null || typeof response !== "object") return null;
  const parsed = registeredTargetProfileV1Schema.safeParse(
    (response as { registeredProfile?: unknown }).registeredProfile,
  );
  if (!parsed.success) return null; // fail toward absent

  const deviceCanProvide = new Set<string>([
    ...SUPERVISABLE_WORKLOAD_CAPABILITIES,
    ...capabilitiesForIsolation(input.isolation),
  ]);
  // ★ INTERSECT the admin ceiling with what the device can provide (M16). Reporting the
  // ceiling verbatim would advertise, e.g., `sandbox.*` on a device whose isolation is `none`.
  const reportedCapabilities = parsed.data.capabilityCeiling.filter((cap) => deviceCanProvide.has(cap));

  return { reportedCapabilities, policyHash: parsed.data.policyHash, capacity: input.capacity };
}
