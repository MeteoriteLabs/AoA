# E10 — Desktop, Migration, and Realtime

**Status:** `backlog`
**Depends on:** ticket-level E3–E7 dependencies in the program design; MIG-003 begins before the E7 exit gate
**Tickets:** DSK-001 through DSK-004; MIG-001 through MIG-004
**Exit gate:** signed desktop lifecycle, enrollment/folder/offline policies, Decision #117 cutover, fenced cross-target handoff, and two-replica durable realtime catch-up pass.

## Mandatory planning brief

E10 has four lanes: legacy target cutover/placement UX, desktop runtime/distribution, workspace/handoff, and durable realtime. The plan must cover Decision #117 route-by-credential migration without dual scheduling; required/preferred/forbidden target UX; owner/locality no-fallback; device replace/loss/revoke/membership removal/keychain recovery; the DSK-001/002 OS-protected device-local credential-handle adapter and DAT-004/DAT-005 fence-aware local broker/egress contract; background service/autostart/diagnostics/repair/uninstall; signed Windows/macOS installers and notarization; signed staged updates, drain, forced fencing, interrupted recovery, N-1 compatibility, and rollback.

Add `MIG-001 — Decision #117 target/credential-routing cutover`, `MIG-004 — Cross-target handoff`, `DSK-003 — Desktop host and signed installers`, and `DSK-004 — Desktop update/drain/rollback`. Handoff is a new fenced attempt or instance, never live migration: managed↔dedicated mobility is independent of desktop artifacts, while any desktop source or destination direction is a conditional extension that requires DSK-004 and the advertised desktop matrix. JOB-008 may land first only with explicit-refresh UX and no reconnect-safe claim; MIG-003 must land before CLI-006, BRW-006, or SVC-007 may claim durable reconnect evidence.

Required evidence includes lost/replaced device, owner removal online/offline, locked/unavailable OS store, local-handle grant/revoke and zero upload, lease/fence/target-generation expiry while public Internet remains reachable, direct broker/egress bypass denial, and destruction of per-job activation; installer update/rollback/interruption/uninstall; active-work drain/forced fencing; target fallback allowed/denied; managed→dedicated and dedicated→managed handoff without desktop artifacts plus conditional desktop directions; matching/changed bases; source/destination no-concurrent-effects races; destination failure with no source revival; stale orphan output; and two-replica realtime authorization/replay/gap/duplicate/broker-outage cases.
