import { tenantIsolationEnforced } from "../config/deployment-mode.js";
import { assertUnsandboxedMultitenantAllowed } from "./unsandboxed-multitenant-guard.js";

/** Fail closed before any tenant-controlled workspace command reaches the API host. */
export function assertLocalWorkspaceCommandAllowed(sink: string): void {
  assertUnsandboxedMultitenantAllowed(
    { type: "local" },
    { tenantIsolationEnforced: tenantIsolationEnforced(), sink },
  );
}
