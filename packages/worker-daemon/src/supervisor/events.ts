/**
 * Sequenced worker-event production into an INJECTED sink (WRK-004).
 *
 * The supervisor emits `workerEventV1` records with CONTIGUOUS `seq` (each one
 * greater than the last) and a per-event `eventDigest` computed via the frozen
 * `canonicalEventDigestInputV1` + `node:crypto` SHA-256 — byte-identical to the
 * server's verifier. Events are handed to an injected {@link WorkerEventSink};
 * the durable outbox + `event_upload` wiring is WRK-006 (NOT in CORE).
 *
 * Every event is validated against the frozen `workerEventV1Schema` before it
 * leaves — a malformed payload or non-canonicalizable value fails HERE, never on
 * the wire.
 *
 * Runtime imports: `@armyofagents/worker-protocol` (frozen schema + canonical
 * digest) + `node:crypto` — the E4-D01 boundary.
 */

import { createHash, randomUUID } from "node:crypto";

import {
  canonicalEventDigestInputV1,
  workerEventV1Schema,
  type NetworkDeniedPayloadV1,
  type TerminalEventStatus,
  type WorkerEventType,
  type WorkerEventV1,
} from "@armyofagents/worker-protocol";

import { scrubEventStrings } from "./redaction.js";

/** The four frozen network-denial destination classes (`NETWORK_DENIAL_CLASSES`). */
export type NetworkDenialClass = NetworkDeniedPayloadV1["destinationClass"];

/** The delivery identity every event under a lease repeats verbatim. */
export interface EventDeliveryIdentity {
  readonly organizationId: string;
  readonly companyId: string;
  readonly workerId: string;
  readonly jobId: string;
  readonly attempt: number;
  readonly leaseId: string;
  readonly fenceToken: string;
}

/** The injected destination for sequenced events (durable upload = WRK-006). */
export interface WorkerEventSink {
  emit(event: WorkerEventV1): Promise<void> | void;
}

export interface EventSequencerDeps {
  readonly identity: EventDeliveryIdentity;
  readonly sink: WorkerEventSink;
  /** Injectable id/clock for deterministic tests. */
  readonly newEventId?: () => string;
  readonly now?: () => string;
  /** DAT-005 D4 — the PER-RUN secret canaries. Every string in every emitted event
   * is scrubbed of these substrings BEFORE the digest (so the durable outbox can
   * never seal a value). Passed explicitly per run — never a module singleton — to
   * avoid cross-run bleed. An empty array = no redaction (verbatim emit).
   *
   * REQUIRED (never optional): every construction site must make a deliberate choice
   * so a sequencer can never be built unscrubbed by omission — the exact defect that
   * left the supervisor's primary lifecycle stream unredacted while only the
   * fence-close denial stream was scrubbed. Pass `[]` to opt out explicitly. */
  readonly redactionCanaries: readonly string[];
}

/** lowercase-hex SHA-256 over the canonical event bytes. */
function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Produces contiguous, digest-stamped, schema-valid worker events into the sink.
 * One sequencer per lease/attempt; `seq` starts at 1 and increments by exactly 1.
 */
export class EventSequencer {
  readonly #identity: EventDeliveryIdentity;
  readonly #sink: WorkerEventSink;
  readonly #newEventId: () => string;
  readonly #now: () => string;
  readonly #canaries: readonly string[];
  #seq = 0;

  constructor(deps: EventSequencerDeps) {
    this.#identity = deps.identity;
    this.#sink = deps.sink;
    this.#newEventId = deps.newEventId ?? randomUUID;
    this.#now = deps.now ?? (() => new Date().toISOString());
    this.#canaries = deps.redactionCanaries ?? [];
  }

  /** The seq the NEXT emitted event will carry. */
  nextSeq(): number {
    return this.#seq + 1;
  }

  async #emit(eventType: WorkerEventType, payload: unknown): Promise<WorkerEventV1> {
    this.#seq += 1;
    const withoutDigest = {
      protocolVersion: 1 as const,
      eventId: this.#newEventId(),
      organizationId: this.#identity.organizationId,
      companyId: this.#identity.companyId,
      workerId: this.#identity.workerId,
      jobId: this.#identity.jobId,
      attempt: this.#identity.attempt,
      leaseId: this.#identity.leaseId,
      fenceToken: this.#identity.fenceToken,
      seq: this.#seq,
      occurredAt: this.#now(),
      extensions: [] as const,
      eventType,
      payload,
    };
    // DAT-005 D4 — scrub per-run secret canaries from EVERY string BEFORE the digest,
    // so the digest + parse below cover the scrubbed bytes and the durable outbox
    // (which seals verbatim + never re-digests) can never persist a value.
    const scrubbed = scrubEventStrings(withoutDigest, this.#canaries);
    const eventDigest = sha256Hex(canonicalEventDigestInputV1(scrubbed));
    // Parse the COMPLETE event (contiguity + shape + forbidden-key scan) before
    // it leaves — a contract failure surfaces here, not on the wire.
    const event = workerEventV1Schema.parse({ ...scrubbed, eventDigest });
    await this.#sink.emit(event);
    return event;
  }

  /** `attempt_started` — the sandbox is up and the tenant command is running
   * inside it. */
  attemptStarted(sandboxId: string): Promise<WorkerEventV1> {
    return this.#emit("attempt_started", { sandboxId });
  }

  /** `network_denied` — a governed egress attempt was refused. WRK-005's
   * fence-close proxy emits this (the positive counterpart of the
   * `CleanupAuthority.openEgress` hard denial) when an egress is attempted after
   * the fence has closed. */
  networkDenied(input: { destinationClass: NetworkDenialClass; reason: string }): Promise<WorkerEventV1> {
    return this.#emit("network_denied", { destinationClass: input.destinationClass, reason: input.reason });
  }

  /** The terminal attempt event (succeeded/failed/cancelled/expired). */
  terminal(input: {
    status: TerminalEventStatus;
    exitCode: number | null;
    errorCode?: string | null;
    errorMessage?: string | null;
  }): Promise<WorkerEventV1> {
    return this.#emit("terminal", {
      status: input.status,
      exitCode: input.exitCode,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
    });
  }
}
