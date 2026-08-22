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

/**
 * The closed placement-provider vocabulary the caller supplies (Lane C/D6). Restated here as a
 * literal rather than imported, so a drift in `EXECUTION_TARGET_KINDS` shows up as a failure in
 * `execution-target-kinds.test.ts` and not as a silently-agreeing fixture here.
 */
const KNOWN = ["desktop", "dedicated_worker", "e2b", "local_host", "pooled_gvisor"];

const placement = { provider: "e2b", template: "aoa-base", knownProviders: KNOWN };

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

  it("matches TEMPLATE values exactly, never by prefix or case", () => {
    // These are identifiers, not prose. A prefix match would make killing `aoa-base` also kill
    // `aoa-base-2`, and a case-insensitive one would depend on how an operator typed it.
    //
    // The near-miss cases live on the TEMPLATE dimension because template values are free-form.
    // A provider near-miss is a different fact — it is outside the closed vocabulary, and D6
    // refuses it rather than reading it as "matches nothing"; see the D6 block below.
    for (const value of ["aoa", "AOA-BASE", "aoa-base-2", " aoa-base"]) {
      expect(
        evaluateKillSwitches({
          document: doc([live({ dimension: "template", value, reason: "near miss" })]),
          ...placement,
        }),
        value,
      ).toEqual({ killed: false });
    }
  });

  it("matches a PROVIDER value exactly among the known kinds", () => {
    // Both of these are real kinds; only one is this worker's. Exactness still governs.
    expect(evaluateKillSwitches({ document: doc([live({ value: "local_host" })]), ...placement }))
      .toEqual({ killed: false });
    expect(evaluateKillSwitches({ document: doc([live({ value: "e2b" })]), ...placement }).killed)
      .toBe(true);
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

  it("KILLS on a TEMPLATE entry whose VALUE is empty or not a string", () => {
    // Mutation testing found that the provider-dimension version of this case (below) is
    // MASKED by D6: an empty or non-string value is not in the closed vocabulary either, so
    // the vocabulary check refuses first and the value check itself stays unpinned. The
    // template dimension has no vocabulary, so only this case proves the value check exists.
    for (const value of ["", 7, null, undefined, {}]) {
      const result = evaluateKillSwitches({
        document: doc([live({ dimension: "template", value, reason: "cve" })]), ...placement,
      });
      expect(result.killed, JSON.stringify(value) ?? "undefined").toBe(true);
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
        knownProviders: KNOWN,
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

    expect(evaluateKillSwitches({
      document: doc([]), provider: "e2b", template: null, knownProviders: KNOWN,
    })).toEqual({ killed: false });
    expect(evaluateKillSwitches({
      document: templateSwitch, provider: "e2b", template: null, knownProviders: KNOWN,
    })).toEqual({ killed: false });

    const unknown = evaluateKillSwitches({
      document: templateSwitch, provider: "e2b", template: undefined, knownProviders: KNOWN,
    });
    expect(unknown.killed).toBe(true);
    // Lane C/D2 renamed this outcome: "a switch this caller structurally cannot evaluate" is a
    // different operator problem from "the document is malformed", and the drain reason is the
    // only diagnostic the operator gets.
    expect(unknown.killed && unknown.reason).toBe("placement_unknown");

    // A provider switch still bites a worker with no template — the dimensions are
    // independent, and one being absent must not excuse the other.
    expect(evaluateKillSwitches({
      document: doc([live()]), provider: "e2b", template: null, knownProviders: KNOWN,
    }).killed).toBe(true);
  });
});

describe("REL-004 Lane C/D2 — an unknown template refuses ONLY when a template switch exists", () => {
  // The control plane holds no template fact for a distributed worker: the E2B alias is pinned
  // worker-side in packages/sandbox-e2b-provider, and the frozen hello / provider-constraint /
  // registered-target schemas have no field for it. So the poll passes `template: undefined`
  // FOREVER, not occasionally — and refusing every document on that basis would mean killing
  // pooled_gvisor drained the e2b fleet too.
  const providerSwitch = doc([{ dimension: "provider", value: "pooled_gvisor", reason: "incident" }]);
  const templateSwitch = doc([{ dimension: "template", value: "aoa-base", reason: "cve" }]);

  it("evaluates a provider-only document normally when the template is UNKNOWN", () => {
    expect(evaluateKillSwitches({
      document: providerSwitch, provider: "e2b", template: undefined, knownProviders: KNOWN,
    })).toEqual({ killed: false });
  });

  it("still kills a MATCHING provider switch when the template is UNKNOWN", () => {
    // Non-vacuity for the case above: the document is being read, not skipped.
    expect(evaluateKillSwitches({
      document: doc([{ dimension: "provider", value: "e2b", reason: "incident" }]),
      provider: "e2b", template: undefined, knownProviders: KNOWN,
    })).toEqual({ killed: true, dimension: "provider", value: "e2b", reason: "incident" });
  });

  it("REFUSES a template switch when the template is UNKNOWN, with its own reason", () => {
    // Over-broad and loud beats narrow and false. A silent no-op would tell an operator that a
    // compromised template was blocked when nothing was ever checked.
    expect(evaluateKillSwitches({
      document: templateSwitch, provider: "e2b", template: undefined, knownProviders: KNOWN,
    })).toEqual({ killed: true, dimension: null, value: null, reason: "placement_unknown" });
  });

  it("refuses on the FIRST template switch even when a later provider switch would match", () => {
    // Order matters: an unevaluatable entry must not be skipped so a later one can be honoured.
    // Skipping it would report a narrower reason than the truth.
    expect(evaluateKillSwitches({
      document: doc([
        { dimension: "template", value: "aoa-base", reason: "cve" },
        { dimension: "provider", value: "e2b", reason: "incident" },
      ]),
      provider: "e2b", template: undefined, knownProviders: KNOWN,
    })).toEqual({ killed: true, dimension: null, value: null, reason: "placement_unknown" });
  });

  it("scans PAST a non-matching provider switch to a later matching one", () => {
    // Guards the `continue` in the provider branch: returning early there would make only the
    // first entry in a document count.
    expect(evaluateKillSwitches({
      document: doc([
        { dimension: "provider", value: "local_host", reason: "unrelated" },
        { dimension: "provider", value: "e2b", reason: "the real one" },
      ]),
      provider: "e2b", template: undefined, knownProviders: KNOWN,
    })).toEqual({ killed: true, dimension: "provider", value: "e2b", reason: "the real one" });
  });

  it("still evaluates a template switch normally when the template IS known", () => {
    expect(evaluateKillSwitches({
      document: templateSwitch, provider: "e2b", template: "aoa-base", knownProviders: KNOWN,
    })).toEqual({ killed: true, dimension: "template", value: "aoa-base", reason: "cve" });
  });

  it("refuses a template that is neither string, null, nor undefined — but only when scanned", () => {
    expect(evaluateKillSwitches({
      document: templateSwitch, provider: "e2b", template: 7, knownProviders: KNOWN,
    })).toEqual({ killed: true, dimension: null, value: null, reason: "policy_unreadable" });
    // The same garbage template is irrelevant to a provider-only document.
    expect(evaluateKillSwitches({
      document: providerSwitch, provider: "e2b", template: 7, knownProviders: KNOWN,
    })).toEqual({ killed: false });
  });
});

describe("REL-004 Lane C/D6 — a provider value outside the closed vocabulary is refused", () => {
  it("refuses a mistyped provider value rather than reading it as 'matches nothing'", () => {
    // `E2B` / `e2b-prod` is exactly the shape of an operator typo. Silently permitting is how a
    // switch they just threw does nothing at all — the same argument the module already makes
    // for a mistyped `dimension`.
    for (const value of ["E2B", "e2b-prod", "e2", " e2b", "gvisor"]) {
      const result = evaluateKillSwitches({
        document: doc([live({ value })]), ...placement,
      });
      expect(result.killed, value).toBe(true);
      expect(result.killed && result.reason, value).toBe("policy_unreadable");
    }
  });

  it("refuses when the vocabulary itself is missing or malformed", () => {
    for (const knownProviders of [undefined, null, [], "e2b", [""], [1], {}]) {
      const result = evaluateKillSwitches({
        document: doc([live()]), provider: "e2b", template: null, knownProviders,
      });
      expect(result.killed, JSON.stringify(knownProviders) ?? "undefined").toBe(true);
      expect(result.killed && result.reason).toBe("policy_unreadable");
    }
  });

  it("refuses a malformed vocabulary even for a TEMPLATE-only document", () => {
    // Mutation testing found this gap: with a provider switch present, the per-value vocabulary
    // check refuses anyway, so the up-front length/shape guard was untested and `length === 0`
    // was indistinguishable from `length < 0`. A template-only document never consults the
    // vocabulary, so only this case pins the guard. A mis-wired caller is fail-closed territory
    // whatever dimension the operator happened to use.
    for (const knownProviders of [[], undefined, "e2b"]) {
      const result = evaluateKillSwitches({
        document: doc([live({ dimension: "template", value: "aoa-base", reason: "cve" })]),
        provider: "e2b", template: "aoa-base", knownProviders,
      });
      expect(result.killed, JSON.stringify(knownProviders) ?? "undefined").toBe(true);
      expect(result.killed && result.reason).toBe("policy_unreadable");
    }
  });

  it("does not kill an OBSERVED provider that merely starts with a killed kind", () => {
    // Mutation testing found this gap too: no kind is a prefix of another, so `===` and
    // `startsWith` are indistinguishable for observed providers drawn from the vocabulary.
    // They are NOT indistinguishable for an observed provider outside it, and that is exactly
    // where a prefix match does damage — killing `e2b` must not kill `e2b-staging`.
    expect(evaluateKillSwitches({
      document: doc([live({ value: "e2b" })]),
      provider: "e2b-staging", template: null, knownProviders: KNOWN,
    })).toEqual({ killed: false });
  });

  it("does NOT require the OBSERVED provider to be in the vocabulary", () => {
    // An unrecognized execution_targets.kind is an enrollment fault that
    // normalizePlacementRegistryTarget fails closed on a few lines later. Coupling the kill
    // switch to it would widen a policy check into placement validation.
    expect(evaluateKillSwitches({
      document: doc([live()]), provider: "some_legacy_kind", template: null, knownProviders: KNOWN,
    })).toEqual({ killed: false });
  });

  it("leaves the vocabulary irrelevant to a template switch", () => {
    // Template aliases are provider-side identifiers with no closed server-side vocabulary.
    expect(evaluateKillSwitches({
      document: doc([live({ dimension: "template", value: "anything-at-all", reason: "cve" })]),
      provider: "e2b", template: "anything-at-all", knownProviders: KNOWN,
    })).toEqual({ killed: true, dimension: "template", value: "anything-at-all", reason: "cve" });
  });

  it("lets the ABSENT-document rule win before any input validation", () => {
    // A fresh install has no document AND, on the poll path, no knowable template. If input
    // validation ran first, every such install would drain instead of running.
    expect(evaluateKillSwitches({
      document: undefined, provider: "e2b", template: undefined, knownProviders: undefined,
    })).toEqual({ killed: false });
  });
});
