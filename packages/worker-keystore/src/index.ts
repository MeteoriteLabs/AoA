// packages/worker-keystore/src/index.ts
//
// DSK-001 — OS-protected device-identity custody for the worker daemon.
//
// **The dependency arrow points keystore → daemon, never the reverse (D1).** The
// worker-daemon's runtime dependency manifest is pinned to exactly
// `["@armyofagents/worker-protocol", "pino"]` by
// `scripts/lib/worker-daemon-boundary.mjs:53`, and
// `scripts/check-worker-daemon-boundary.mjs` rejects a bare specifier the moment a
// file under `packages/worker-daemon/src` names it. So this package may depend on
// the daemon and implement its `DeviceKeyStore` port, but **no file under
// `packages/worker-daemon/src` may ever import `@armyofagents/worker-keystore`** —
// the host composes it in. That single rule is what makes an OS binding legal here
// and illegal inside the daemon, and it is the same shape
// `packages/sandbox-e2b-provider` already uses.

export {
  classifyStoreOutcome,
  type KeyStoreProbeOutcome,
  type StoreCommandResult,
} from "./outcome.js";

export {
  planVaultCommand,
  POWERSHELL_ABSOLUTE_PATH,
  type VaultOp,
  type VaultRef,
  type VaultCommandPlan,
} from "./command-plan.js";

export {
  encodeIdentityEnvelope,
  decodeIdentityEnvelope,
  IDENTITY_ENVELOPE_VERSION,
  type DeviceIdentityRecord,
} from "./envelope.js";

export {
  createOsIdentityStore,
  DeviceKeyStoreError,
  type CommandRunner,
  type DeviceIdentityStore,
} from "./identity-store.js";

// The subprocess host. Importing this pulls in `node:child_process`; every other
// module in this package is deliberately OS-free.
export { createCommandRunner } from "./command-runner.js";

export { resolveVaultRefs, VaultPathError, type VaultRefs } from "./blob-path.js";

export {
  encodeEnrollmentReceipt,
  decodeEnrollmentReceipt,
  RECEIPT_ENVELOPE_VERSION,
  type DeviceEnrollmentReceipt,
} from "./receipt-envelope.js";

export { createOsRecordStore, type DeviceRecordStore, type RecordCodec } from "./identity-store.js";

// The composition host — the only module here that names the worker-daemon
// bootstrap. Importing it pulls in both packages by design.
export {
  runDesktopHost,
  RESET_IDENTITY_FLAG,
  RESET_ACKNOWLEDGEMENT_FLAG,
  type DesktopHostDeps,
} from "./bin/desktop-host.js";

// The entry guard's redactor. Exported so a packaging host (DSK-003) reuses it
// rather than reinventing the one path that bypasses the logger.
export { redactEnrollmentCodes } from "./bin/aoa-worker-desktop.js";

// DSK-003 Lane C — per-user, unprivileged autostart manifests.
export {
  AUTOSTART_PLATFORMS,
  AutostartManifestError,
  buildAutostartManifest,
} from "./install/autostart.js";
export type {
  AutostartManifest,
  AutostartManifestInput,
  AutostartPlatform,
} from "./install/autostart.js";

// DSK-003 Lane A — what an invocation of the desktop binary means.
export { resolveDesktopInvocation } from "./bin/desktop-invocation.js";
export type { DesktopInvocation } from "./bin/desktop-invocation.js";

// DSK-003 Lane A — where the control token and host state record live.
export { resolveControlPaths, type ControlPaths } from "./control-paths.js";
