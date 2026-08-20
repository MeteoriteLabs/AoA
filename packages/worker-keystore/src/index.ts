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
