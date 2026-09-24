import io, json, subprocess

AMEND = """

### ★★★ AMENDMENT, 2026-09-24 — the MECHANISM half is corrected; the CHOICE half stands

**Raised by Codex on PR #594 and verified at source before acting. The correction is real and it
matters, because this decision is locked and its mechanism as first written would have been
actively harmful.**

The decision above says the invalidation route *"reuses machinery that already exists"* and that the
fix is *"enqueue a convergence record from `advanceTargetGeneration` … and let the existing fanout
re-place or terminalise the affected attempts."* **Enqueueing an `execution_target_revocations`
record is NOT a safe mechanism**, for two measured reasons:

1. **It would REVOKE the target.** `execution-target-revocation-fanout.ts` calls
   `ensureExecutionTargetCutoff`, which calls `bumpExecutionTargetGeneration`
   (`server/src/services/execution-targets.ts`). That helper sets
   `deviceGeneration: sql\`… + 1\`` **and `status: "disabled"`** in the same update. So enqueueing a
   revocation record for a successful device ROTATION would bump the generation a SECOND time and
   **disable the target** — converting a rotation into a revocation, which is precisely the outcome
   the fix exists to avoid.
2. **It CANCELS rather than re-places.** The fanout's Phase-1b terminalises stranded attempts to
   `cancelled`. That is correct for a revoked target, where the work cannot run anywhere on it. For
   a rotation the target is still serving, so cancelling is a heavier remedy than the defect
   warrants; re-placement onto the current generation is the outcome an operator would expect.

**What the decision now requires instead.** A path that is NOT the revocation record: either a
**distinct convergence record kind** for a generation advance, or a **branch in the existing fanout
that skips `ensureExecutionTargetCutoff` entirely** while still doing the two things that made the
fanout the right precedent — converging old-generation attempts and **releasing the pinned
Organization capacity slot**. Whether those attempts should be re-placed or terminalised on a
rotation is part of the owning ticket's design, and the second binding condition (the capacity leak
is part of the fix) applies to it unchanged.

**What is NOT changed.** The choice stands: explicit invalidation, and the generation **floor is
still refused** for the reason originally given. Both binding conditions stand. The equality pin is
still not relitigated.

★ **How this was got wrong, recorded because it is the same error as the rest of this ticket.** The
"reuse the existing fanout" mechanism was reasoned from the fanout's own Phase-1b COMMENT — which
does describe exactly the right outcome — without measuring what `ensureExecutionTargetCutoff`
actually does when invoked. **The chain, not the link**, for the fourth time in this ticket, and this
time inside a recommendation handed up for ratification. It is the strongest argument yet that a
mechanism named in a decision must be measured end to end before it is locked, not only motivated.
"""

P = "docs/replatform/epics/E3-job-control/decisions.md"
s = io.open(P, encoding="utf-8", newline="").read()
assert "AMENDMENT, 2026-09-24" not in s
assert "## E3-D-GEN-INVALIDATION" in s
s = s.rstrip("\n") + "\n" + AMEND
assert "\r" not in s
io.open(P, "w", encoding="utf-8", newline="").write(s)

# ---- the finding points at the amendment too ----
F = "docs/replatform/epics/E3-job-control/findings.md"
f = io.open(F, encoding="utf-8", newline="").read()
old = "Read the decision for the full reasoning."
new = ("Read the decision for the full reasoning. ★ **AMENDED the same day**: enqueueing an "
       "`execution_target_revocations` record is NOT the mechanism — the fanout calls "
       "`ensureExecutionTargetCutoff`, whose `bumpExecutionTargetGeneration` also sets "
       "`status: \"disabled\"`, so it would convert a rotation into a REVOCATION, and it cancels "
       "rather than re-places. A distinct record kind, or a fanout branch that skips the cutoff, is "
       "required. The CHOICE (invalidation, not a floor) and both conditions are unchanged.")
assert f.count(old) == 1
f = f.replace(old, new)
assert "\r" not in f
io.open(F, "w", encoding="utf-8", newline="").write(f)

# ---- the ownership reason must reflect the ruling (Codex P2) ----
OWN = (
    "HIGH, filed 2026-09-24 by DEP-021 (source-level; NOT observed live). The lease-candidate "
    "predicate in job-control.ts pins placementTargetGeneration by EQUALITY against the polling "
    "worker's current target generation, while worker-enrollment.ts advanceTargetGeneration bumps "
    "execution_targets.device_generation on re-enrolment of an already-bound worker and leaves the "
    "target ACTIVE. The only convergence path (execution-target-revocation-fanout) is driven solely "
    "off execution_target_revocations rows, inserted only by revokeExecutionTarget, so a "
    "re-enrolment strands every already-placed pending attempt permanently: never offered, never "
    "failed, never expired, nothing logged, and an Organization capacity slot pinned when the "
    "attempt was 'held'. RULED E3-D-GEN-INVALIDATION (founder delegation F2, 2026-09-24): explicit "
    "invalidation; the generation FLOOR is REFUSED. AMENDED the same day after a Codex finding "
    "verified at source: enqueueing an execution_target_revocations record is NOT the mechanism, "
    "because the fanout calls ensureExecutionTargetCutoff whose bumpExecutionTargetGeneration also "
    "sets status='disabled' (it would convert a rotation into a revocation) and because the fanout "
    "cancels rather than re-places; a distinct convergence record kind, or a fanout branch that "
    "skips the cutoff, is required. UNOWNED because no implementation ticket exists yet -- NOT "
    "because the remedy is undecided; it is decided, and two binding conditions gate it: the defect "
    "must first be REPRODUCED LIVE (re-enrol a bound worker while one of its jobs sits pending and "
    "placed), and the fix must also release the pinned capacity slot. NOT the cause of DEP-021's own "
    "harness failures: a restart with a persisted identity takes the refreshSelfHello branch and does "
    "not advance the generation."
)
OW = "scripts/finding-ownership.json"
base = json.loads(subprocess.run(["git", "show", "HEAD:" + OW], capture_output=True, text=True,
                                 encoding="utf-8", check=True).stdout)
cur = json.loads(io.open(OW, encoding="utf-8").read())
assert set(cur["findings"]) == set(base["findings"])
before = dict(cur["findings"])
cur["findings"]["E3-F041"]["reason"] = OWN
changed = [k for k in before if before[k] != cur["findings"][k]]
assert changed == ["E3-F041"], f"unexpected mutations: {changed}"
assert set(cur["findings"]) == set(base["findings"]), "key set changed"
io.open(OW, "w", encoding="utf-8", newline="").write(json.dumps(cur, indent=2, ensure_ascii=False) + "\n")
print(f"amended; ownership keys {len(base['findings'])} unchanged, exactly E3-F041 reworded")
