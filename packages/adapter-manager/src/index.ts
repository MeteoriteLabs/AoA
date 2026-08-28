// Public surface of the adapter-manager package (DEP-012 Slice 1 · Unit A).
// The out-of-process networked host of the per-op `SandboxProvider`.

export { createProviderServer } from "./server.js";
export type { CreateProviderServerOptions } from "./server.js";

export { CapabilityVerificationError, verifyOwnedLabelsCapability } from "./capability-verify.js";
export { gateExecute } from "./execute-gate.js";
export type { ExecuteGateDeps } from "./execute-gate.js";
