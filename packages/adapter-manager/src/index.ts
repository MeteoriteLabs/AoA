// Public surface of the adapter-manager package (DEP-012 Slice 1 · Units A + B1 + B2).
// The out-of-process networked host of the per-op `SandboxProvider`.

export { createProviderServer } from "./server.js";
export type { CreateProviderServerOptions } from "./server.js";

export { CapabilityVerificationError, verifyOwnedLabelsCapability } from "./capability-verify.js";
export { gateList, gateOwnedOp, redactProjection } from "./owned-op-gate.js";
export type { OwnedOpGateDeps } from "./owned-op-gate.js";
