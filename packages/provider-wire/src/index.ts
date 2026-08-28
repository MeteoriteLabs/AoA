// Public surface of the provider-wire package (DEP-012 Slice 1 · Unit A).
// The shared, provider-neutral wire: the (de)serialization + error-vocab codec and the
// networked `SandboxProvider` driver. NOT in `worker-protocol` (this wire is non-frozen).

export {
  WireProtocolError,
  decodeOpRequest,
  decodeOpResponse,
  encodeErrResponse,
  encodeOkResponse,
  encodeOpRequest,
  reconstructError,
  serializeError,
} from "./codec.js";
export type { OpRequestEnvelope, SerializedError } from "./codec.js";

export { NetworkedProviderDriver } from "./driver.js";
export type { NetworkedProviderDriverOptions } from "./driver.js";
