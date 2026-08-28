// -----------------------------------------------------------------------------
// provider-wire codec (DEP-012 Slice 1 · Unit A).
//
// The per-op request/response envelopes + (de)serialization + the error-vocab
// codec, imported by BOTH the adapter-manager server and the networked driver.
// It is provider-NEUTRAL: it serves the frozen provider ops, it does not extend
// them. Unit A wires only `create` + `execute`, but the codec itself is op-agnostic
// (it carries opaque `args`), so no op is special-cased here.
//
// THE ERROR VOCAB. The wire preserves the error CLASS by `.name` + its discriminant,
// so a caller's duck-typed (`.name` + field) checks — and the DEP-008 conformance
// suite — see production identities across the hop. The reconstructed classes are the
// AUTHORITATIVE ones: `UnsupportedProviderOperation`/`SandboxNotFoundError` are
// worker-daemon's (re-exported through the e2b leaf's `errors.js` as the single import
// site), `SandboxEgressDeniedError` is the provider-neutral egress denial (worker-daemon
// has no class for it). An UNKNOWN or garbled payload maps to a generic `WireProtocolError`
// — NEVER silently to an `ok` result.
// -----------------------------------------------------------------------------

import type { ProviderOpContext } from "@armyofagents/worker-daemon";
import {
  SandboxEgressDeniedError,
  SandboxNotFoundError,
  UnsupportedProviderOperation,
} from "@armyofagents/sandbox-e2b-provider/errors.js";

/**
 * A wire-transport / protocol failure that is NOT one of the modelled provider
 * domain errors: a garbled body, a response that is neither `ok` nor `err`, or an
 * `err` payload whose class name the codec does not recognise. It exists so a
 * malformed hop can never be mistaken for success.
 */
export class WireProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WireProtocolError";
  }
}

/** The request envelope every op crosses in: opaque `args` + the op context. */
export interface OpRequestEnvelope {
  readonly args: unknown;
  readonly ctx: ProviderOpContext;
}

/** The serialized error shape. `name` selects the class; the optional STRUCTURED fields
 * (`operation`/`destinationClass`) carry only the modelled class discriminants — never a
 * sensitive projection. `message` is server-authored diagnostic text (not tenant data);
 * an UNMODELLED error forwards its own `message` verbatim, so a producer must not put
 * sensitive values there. */
export interface SerializedError {
  readonly name: string;
  readonly message: string;
  readonly operation?: string;
  readonly destinationClass?: string;
}

// ---- request codec (client encodes, server decodes) -------------------------

export function encodeOpRequest(args: unknown, ctx: ProviderOpContext): string {
  const envelope: OpRequestEnvelope = { args, ctx };
  return JSON.stringify(envelope);
}

export function decodeOpRequest(body: string): OpRequestEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new WireProtocolError("request body is not valid JSON");
  }
  if (!isRecord(parsed) || !("args" in parsed) || !isValidCtx(parsed.ctx)) {
    throw new WireProtocolError("request body is missing a valid { args, ctx } envelope");
  }
  return { args: parsed.args, ctx: parsed.ctx };
}

// ---- response codec (server encodes, client decodes) ------------------------

export function encodeOkResponse(result: unknown): string {
  return JSON.stringify({ ok: result });
}

export function encodeErrResponse(err: unknown): string {
  return JSON.stringify({ err: serializeError(err) });
}

/**
 * Decode a server response. Returns the `ok` result, or THROWS the reconstructed
 * domain error, or THROWS a `WireProtocolError` for anything unrecognised. It never
 * returns for an `err`/garbled body — a fault can never read as success.
 */
export function decodeOpResponse<R>(body: string): R {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new WireProtocolError("response body is not valid JSON");
  }
  if (!isRecord(parsed)) {
    throw new WireProtocolError("response body is not an object");
  }
  if ("ok" in parsed) {
    return parsed.ok as R;
  }
  if ("err" in parsed) {
    throw reconstructError(parsed.err);
  }
  throw new WireProtocolError("response body is neither an ok nor an err envelope");
}

// ---- error vocab ------------------------------------------------------------

/** Extract the class name + its discriminant from a thrown error. Only the modelled
 * discriminants (`operation`, `destinationClass`) cross — nothing else. */
export function serializeError(err: unknown): SerializedError {
  if (err instanceof UnsupportedProviderOperation) {
    return { name: err.name, message: err.message, operation: String(err.operation) };
  }
  if (err instanceof SandboxEgressDeniedError) {
    return { name: err.name, message: err.message, destinationClass: err.destinationClass };
  }
  if (err instanceof SandboxNotFoundError) {
    return { name: err.name, message: err.message };
  }
  // Anything else is not a modelled domain error — carry only its name/message; the
  // decoder maps an unrecognised name to a generic WireProtocolError.
  if (err instanceof Error) {
    return { name: err.name, message: err.message };
  }
  return { name: "WireProtocolError", message: String(err) };
}

/** Rebuild the AUTHORITATIVE domain error from a serialized payload. An unknown or
 * malformed name maps to a generic `WireProtocolError` — never silently discarded. */
export function reconstructError(raw: unknown): Error {
  if (!isRecord(raw) || typeof raw.name !== "string") {
    return new WireProtocolError("err payload is missing a class name");
  }
  const message = typeof raw.message === "string" ? raw.message : "";
  switch (raw.name) {
    case "UnsupportedProviderOperation": {
      // The DeclinableOperation union is wider than ProviderOperation; the ctor
      // accepts the string discriminant, re-widened via a narrow cast.
      const operation = typeof raw.operation === "string" ? raw.operation : "";
      return new UnsupportedProviderOperation(operation as ConstructorParameters<typeof UnsupportedProviderOperation>[0]);
    }
    case "SandboxNotFoundError":
      return new SandboxNotFoundError();
    case "SandboxEgressDeniedError": {
      const destinationClass = typeof raw.destinationClass === "string" ? raw.destinationClass : "";
      return new SandboxEgressDeniedError(destinationClass);
    }
    default:
      return new WireProtocolError(`unrecognised error class over the wire: ${raw.name}${message ? ` (${message})` : ""}`);
  }
}

// ---- helpers ----------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidCtx(value: unknown): value is ProviderOpContext {
  return isRecord(value) && typeof value.deadlineMs === "number" && typeof value.idempotencyKey === "string";
}
