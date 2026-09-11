// M1.1 — the read-only "Connected devices" client. Org-scoped, org-admin gated
// (server/src/routes/desktop-devices.ts: GET /organizations/:orgId/desktop-devices).
//
// A LISTING IS A READ. There is deliberately no enroll / connect / rotate / revoke
// here — device mutation is a follow-up once the desktop installer path is live
// (DSK-00 keeps it CI-disabled). Do not add a write to this client.
//
// `ApiError` is THROWN by `./client` (never swallowed), so React Query surfaces
// every failure to the section's visible error UI: a 403 renders the access-required
// state (non org-admin), a 404 renders "not enabled" (distributed-execution flag off —
// the route is mounted inside that block and does not exist otherwise).
import { api } from "./client";

/**
 * One enrolled desktop device, exactly as `projectDesktopDevice`
 * (server/src/services/desktop-device-projection.ts) returns it. Seven
 * allowlisted fields — no credential, owner, or join key. Kept in lockstep with
 * `DESKTOP_DEVICE_PROJECTION_KEYS`; do not widen this shape without widening the
 * server allowlist (which is deliberately gated).
 */
export interface DesktopDevice {
  deviceId: string;
  targetSlug: string;
  label: string;
  status: string;
  deviceGeneration: number;
  enrolledAt: string | null;
  lastSeenAt: string | null;
}

export const desktopDevicesApi = {
  list: (organizationId: string) =>
    api.get<DesktopDevice[]>(`/organizations/${organizationId}/desktop-devices`),
};
