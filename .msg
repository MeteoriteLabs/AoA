sweep: close three defect CLASSES at every site, not at the instance

Method: M1-BUILD-RULES.md section E. Per class: definition, a quotable
enumeration, and checked/found/fixed/filed counts (in the result record).

Class 1 - a refusal that short-circuits a scan that already has a finding.
leakScan now keeps a REFUSAL LEDGER: the capture-failed marker and the
TRUNCATED-sentinel arms no longer return before the evidence and job-log
scans, joining the ABSENT arm that PR #574 deferred. The comment that
claimed "the scans below always run" while two siblings short-circuited is
corrected. checked 5 / found 2 / fixed 2 / filed 0.

Class 2 - a bounded operation that returns at its deadline without aborting
the underlying work. Swept repo-wide beyond E2bSandboxProvider. checked 46 /
found 3 / fixed 0 / filed 1 (E7-F042, unowned): all three need a widened
SupervisorDeps signature, which is a ticket, not a sweep. E7-F040 re-confirmed
at source and still correctly scoped.

Class 3 - an unbounded per-item emission past a cap. E7-F041 CLOSED: the
producer's refusal channel is now bounded on itself, per reason and per
invocation, with the tail folded into one counted record. checked 14 /
found 2 / fixed 1 / filed 1 (E6-F027, unowned).

Mutations, each reverted: M1/M2 restore the two short-circuits (each reds its
PRECEDENCE case); M3 unbounds the refusal budget and M4 drops the flush (3 red
each); M5 hoists the budget into the factory closure (reds the cross-tenant
per-invocation arm, founder ruling F10).

Locally executed: m1-shipped-boot 97/97; worker-daemon 1268 pass / 1 skipped
across 166 files, typecheck clean; full pure-node guard set + evidence
immutability + finding-ownership + register-citation-integrity all green.
NO CI: GitHub Actions is down repo-wide (account billing), so nothing here
claims a ci-required verdict.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
