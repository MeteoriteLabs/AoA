// server/src/services/execution-kill-switches.ts
//
// REL-004 Lane C — provider and template kill switches (clause 3a: stop new leases).
//
// A KILL SWITCH IS A DENY-LIST OVER A PLACEMENT DIMENSION, not an identity revocation.
// Three questions, deliberately not merged:
//
//   "may this device work"                -> JOB-007 `revokeExecutionTarget`, generation-fenced
//   "may work be PLACED on this provider" -> here
//   "may work RUN FROM this template"     -> here
//
// Merging them would mean killing one bad E2B template required revoking every target that
// used it — destroying enrollment state to express a policy opinion. This is the same
// separation DSK-004 drew between its version deny-list and JOB-007, for the same reason.
//
// THE ABSENT-DOCUMENT RULE DIFFERS FROM DSK-004's, AND THE DIFFERENCE IS DELIBERATE.
// DSK-004 refuses an absent deny-list, because there "absent" means a service that should
// have served the policy did not, and reading that as "nothing denied" installs a withdrawn
// build. Here the document lives in `instance_settings` — the same store as the leasing
// decision itself. If it cannot be read, the lease transaction has already failed; there is
// no separate service whose outage could quietly turn "absent" into "permitted". And an
// absent document is the normal steady state of every install that has never thrown a
// switch, so fail-closed would stop all work on a fresh instance.
//
// What IS fail-closed is a document that EXISTS and cannot be understood: a malformed
// entry, an unknown dimension, a missing reason. "No policy" and "unreadable policy" are
// different facts, and only the second is a reason to stop. In particular a malformed entry
// never causes the rest to be honoured and the bad one skipped — that is how a typo
// silently disables a switch an operator believes they have thrown.
//
// Pure. The caller reads `instance_settings.general.killSwitches` and supplies it.

/**
 * The placement dimensions a switch can name. `target` is absent on purpose: it belongs to
 * JOB-007, whose revocation is generation-fenced identity surgery.
 */
export const KILL_SWITCH_DIMENSIONS = ["provider", "template"] as const;
export type KillSwitchDimension = (typeof KILL_SWITCH_DIMENSIONS)[number];

const DOCUMENT_SCHEMA = 1;

export type KillSwitchVerdict =
  | { readonly killed: false }
  | {
      readonly killed: true;
      readonly dimension: KillSwitchDimension | null;
      readonly value: string | null;
      readonly reason: string;
    };

export interface KillSwitchInput {
  /** `instance_settings.general.killSwitches`, or undefined when none has ever been set. */
  readonly document: unknown;
  /** The execution target's `kind` — the provider this work would be placed on. */
  readonly provider: unknown;
  /**
   * The pinned sandbox template alias.
   *
   * `null` means DEFINITELY NONE — the worker has no pinned template, so a template switch
   * cannot apply to it. `undefined` means UNKNOWN, and is fail-closed: a caller that could
   * not determine the template must not be able to express that as "no template" and slip
   * past a switch. The distinction is the contract; do not collapse them.
   */
  readonly template: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unreadable(): KillSwitchVerdict {
  return { killed: true, dimension: null, value: null, reason: "policy_unreadable" };
}

function isStatedReason(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Decide whether placement is killed.
 *
 * Never throws: a leasing path must get a verdict, not an exception, and the fail-closed
 * verdict is more useful to the caller than a stack trace.
 */
export function evaluateKillSwitches(input: KillSwitchInput): KillSwitchVerdict {
  if (!isPlainObject(input)) return unreadable();
  const { document, provider, template } = input;

  // Absent is the steady state, not a failure. See the header for why this differs from
  // DSK-004's rule rather than contradicting it.
  if (document === undefined || document === null) return { killed: false };

  if (!isPlainObject(document)) return unreadable();
  if (document.schema !== DOCUMENT_SCHEMA) return unreadable();
  if (!Array.isArray(document.switches)) return unreadable();

  // If we do not know where this work would be placed, we cannot know whether it is killed.
  if (typeof provider !== "string" || provider.length === 0) return unreadable();
  if (template !== null && typeof template !== "string") return unreadable();

  for (const entry of document.switches) {
    if (!isPlainObject(entry)) return unreadable();
    const { dimension, value, reason } = entry;
    // An unknown dimension is refused rather than ignored: `providers` for `provider` is
    // exactly the shape of an operator typo, and ignoring it means the switch they just
    // threw does nothing at all.
    if (typeof dimension !== "string"
        || !(KILL_SWITCH_DIMENSIONS as readonly string[]).includes(dimension)) {
      return unreadable();
    }
    if (typeof value !== "string" || value.length === 0) return unreadable();
    // A kill switch stops other people's work; why it was thrown is not decoration.
    if (!isStatedReason(reason)) return unreadable();

    // Exact match. These are identifiers: a prefix match would make killing `e2b` also kill
    // `e2b-staging`, and a case-insensitive one would depend on how an operator typed it.
    const placed = dimension === "provider" ? provider : template;
    if (placed !== null && placed === value) {
      return { killed: true, dimension: dimension as KillSwitchDimension, value, reason };
    }
  }

  return { killed: false };
}
