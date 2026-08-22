/**
 * REL-004 Lane C — provider and template kill switches (clause 3a: stop new leases).
 *
 * A KILL SWITCH IS A DENY-LIST OVER A PLACEMENT DIMENSION, not an identity revocation.
 * Three different questions, deliberately not merged:
 *
 *   "may this device work"                  -> JOB-007 revokeExecutionTarget, generation-fenced
 *   "may work be PLACED on this provider"   -> here
 *   "may work RUN FROM this template"       -> here
 *
 * Merging them would mean killing one bad E2B template required revoking every target that
 * used it — destroying enrollment state to express a policy opinion.
 *
 * THE ABSENT-DOCUMENT RULE DIFFERS FROM DSK-004's, AND THE DIFFERENCE IS THE POINT.
 * DSK-004 refuses an absent version deny-list, because there "absent" means a service that
 * should have served the policy did not, and reading that as "nothing is denied" promotes a
 * withdrawn build. Here the document lives in `instance_settings`, the same store as the
 * leasing decision itself: if it cannot be read, the lease transaction has already failed.
 * An absent document is the normal steady state of every install that has never thrown a
 * switch, so treating it as fail-closed would stop all work everywhere on a fresh instance.
 *
 * What IS fail-closed is a document that exists and cannot be understood — a malformed
 * entry, an unknown dimension, a missing reason. "No policy" and "unreadable policy" are
 * different facts, and only the second is a reason to stop.
 */

import { describe, expect, it } from "vitest";

import {
  KILL_SWITCH_DIMENSIONS,
  evaluateKillSwitches,
} from "../services/execution-kill-switches.js";

const placement = { provider: "e2b", template: "aoa-base" };

const doc = (switches: unknown) => ({ schema: 1, switches });

const live = (overrides: Record<string, unknown> = {}) => ({
  dimension: "provider",
  value: "e2b",
  reason: "provider incident 2026-08-22",
  ...overrides,
});

describe("REL-004/I8 — a killed provider or template stops new leases", () => {
  it("permits placement when no switch matches", () => {
    // Non-vacuity for every refusal below.
    expect(evaluateKillSwitches({ document: doc([]), ...placement })).toEqual({ killed: false });
  });

  it("kills placement on a killed PROVIDER, naming the switch", () => {
    expect(evaluateKillSwitches({ document: doc([live()]), ...placement })).toEqual({
      killed: true,
      dimension: "provider",
      value: "e2b",
      reason: "provider incident 2026-08-22",
    });
  });

  it("kills placement on a killed TEMPLATE", () => {
    const document = doc([live({ dimension: "template", value: "aoa-base", reason: "bad image" })]);
    expect(evaluateKillSwitches({ document, ...placement })).toMatchObject({
      killed: true,
      dimension: "template",
      value: "aoa-base",
    });
  });

  it("does not kill a DIFFERENT provider or template", () => {
    const document = doc([
      live({ value: "local_host" }),
      live({ dimension: "template", value: "other-template", reason: "x" }),
    ]);
    expect(evaluateKillSwitches({ document, ...placement })).toEqual({ killed: false });
  });

  it("matches values exactly, never by prefix or case", () => {
    // These are identifiers, not prose. A prefix match would make killing `e2b` also kill
    // `e2b-staging`, and a case-insensitive one would depend on how an operator typed it.
    for (const value of ["e2", "E2B", "e2b-staging", " e2b"]) {
      expect(evaluateKillSwitches({ document: doc([live({ value })]), ...placement }), value)
        .toEqual({ killed: false });
    }
  });

  it("covers exactly the two placement dimensions, and target is NOT one of them", () => {
    // `target` belongs to JOB-007 and stays there: revocation is generation-fenced identity
    // surgery, and a policy opinion must not reach for it.
    expect([...KILL_SWITCH_DIMENSIONS]).toEqual(["provider", "template"]);
  });
});

describe("REL-004/I10 — no policy and unreadable policy are different facts", () => {
  it("permits when the document is ABSENT — the normal steady state", () => {
    // Every install that has never thrown a switch is in this state. Fail-closed here
    // would stop all work on a fresh instance, and the DSK-004 argument does not carry
    // across: this document shares a store with the leasing decision, so there is no
    // separate service whose outage could make "absent" mean "nothing denied".
    for (const document of [undefined, null]) {
      expect(evaluateKillSwitches({ document, ...placement }), String(document))
        .toEqual({ killed: false });
    }
  });

  it("permits a document with an empty switch list", () => {
    expect(evaluateKillSwitches({ document: doc([]), ...placement })).toEqual({ killed: false });
  });

  it("KILLS when a present document cannot be understood", () => {
    // Existing-but-unreadable is the fail-closed case: we cannot tell whether a switch is
    // set, and guessing "probably none" is how a thrown switch does nothing.
    for (const document of [
      { schema: 2, switches: [] },
      { schema: 1, switches: "none" },
      { schema: 1 },
      { switches: [] },
      "killSwitches",
      7,
      [],
    ]) {
      const result = evaluateKillSwitches({ document, ...placement });
      expect(result.killed, JSON.stringify(document)).toBe(true);
      expect(result.killed && result.reason).toBe("policy_unreadable");
    }
  });

  it("KILLS on a malformed entry rather than skipping it and honouring the rest", () => {
    // Skipping the bad entry is how a typo silently disables a kill switch an operator
    // believes they have thrown.
    for (const bad of [null, "provider", 7, {}, { dimension: "provider" }, { value: "e2b" }]) {
      const result = evaluateKillSwitches({ document: doc([bad]), ...placement });
      expect(result.killed, JSON.stringify(bad)).toBe(true);
      expect(result.killed && result.reason).toBe("policy_unreadable");
    }
  });

  it("KILLS on an entry whose VALUE is empty or not a string", () => {
    // Every malformed entry above also lacks a reason, so the reason check masks this one.
    // These are well-formed apart from the value, and the harm is specific: an empty value
    // matches no real provider, so the switch is a silent no-op an operator believes they
    // have thrown.
    for (const value of ["", 7, null, undefined, {}]) {
      const result = evaluateKillSwitches({
        document: doc([live({ value })]), ...placement,
      });
      expect(result.killed, JSON.stringify(value) ?? "undefined").toBe(true);
      expect(result.killed && result.reason).toBe("policy_unreadable");
    }
  });

  it("KILLS on an unknown dimension rather than ignoring it", () => {
    // `providers` instead of `provider` is exactly the shape of an operator typo, and
    // ignoring it means the switch they just threw does nothing at all.
    const result = evaluateKillSwitches({
      document: doc([live({ dimension: "providers" })]), ...placement,
    });
    expect(result.killed).toBe(true);
    expect(result.killed && result.reason).toBe("policy_unreadable");
  });

  it("KILLS on a switch with no stated reason", () => {
    // A kill switch stops other people's work. Who threw it and why is not decoration.
    for (const reason of [undefined, "", "   ", 7]) {
      const result = evaluateKillSwitches({ document: doc([live({ reason })]), ...placement });
      expect(result.killed, JSON.stringify(reason) ?? "undefined").toBe(true);
      expect(result.killed && result.reason).toBe("policy_unreadable");
    }
  });

  it("never throws on caller-supplied garbage", () => {
    for (const bad of [undefined, null, 0, "", [], { document: doc([]) }]) {
      expect(() => evaluateKillSwitches(bad as never), JSON.stringify(bad) ?? "undefined").not.toThrow();
    }
  });

  it("treats a missing placement value as unplaceable, not as unmatched", () => {
    // If we do not know which provider this worker is, we cannot know whether it is killed.
    for (const provider of [undefined, null, "", 7]) {
      const result = evaluateKillSwitches({
        document: doc([live()]), provider: provider as never, template: "aoa-base",
      });
      expect(result.killed, JSON.stringify(provider) ?? "undefined").toBe(true);
    }
  });

  it("distinguishes 'definitely no template' (null) from 'unknown' (undefined)", () => {
    // The distinction is the contract, and getting it backwards would be a real defect in
    // either direction. NULL means the worker genuinely has no pinned template: it cannot
    // be running from `aoa-base`, so a switch on `aoa-base` does not touch it. UNDEFINED
    // means the caller could not determine the template, and then we cannot know whether
    // it is killed — so it is.
    const templateSwitch = doc([live({ dimension: "template", value: "aoa-base", reason: "x" })]);

    expect(evaluateKillSwitches({ document: doc([]), provider: "e2b", template: null }))
      .toEqual({ killed: false });
    expect(evaluateKillSwitches({ document: templateSwitch, provider: "e2b", template: null }))
      .toEqual({ killed: false });

    const unknown = evaluateKillSwitches({ document: templateSwitch, provider: "e2b", template: undefined });
    expect(unknown.killed).toBe(true);
    expect(unknown.killed && unknown.reason).toBe("policy_unreadable");

    // A provider switch still bites a worker with no template — the dimensions are
    // independent, and one being absent must not excuse the other.
    expect(evaluateKillSwitches({ document: doc([live()]), provider: "e2b", template: null }).killed)
      .toBe(true);
  });
});
