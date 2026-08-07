# E11 — Hardening and Private-beta Release

**Status:** `backlog`
**Depends on:** E8, E9, DEP-009, and core MIG-001 through MIG-003; DSK and MIG-004 closure is conditional on the advertised target matrix
**Tickets:** REL-001 through REL-005
**Exit gate:** tenant/secret adversarial, load/fairness, disaster recovery, signed-image, provider-kill, and private-beta evidence gates pass on one release candidate.

## Mandatory planning brief

E11 gates the advertised hybrid target matrix by workload, target class, OS, provider, isolation, credential kind, locality, offline policy, and handoff mode. Unsupported combinations fail closed. Fake-provider evidence alone is insufficient: core release evidence includes malicious workers, real E2B isolation/cleanup, owner/target/revocation/fallback cases, backup/restore, two-replica realtime catch-up, and target/provider kill switches. When desktop or handoff is advertised, its conditional evidence additionally includes desktop staging/conflict/quarantine, old-fence denial after handoff, signed/notarized installers/updater metadata, and backup/restore with device generations.

REL-001 through REL-004 form the cloud-managed core. Before REL-005, freeze the advertised target/provider/OS/credential/locality/fallback/mobility matrix with stable row IDs and directed handoff pairs, then apply the conditional joins in `program-design.md`. Every advertised row must meet its D6 SLI. An enabled desktop OS additionally requires DSK-003/004, MIG-001, DAT-006, the per-OS desktop beta gate, and desktop-covered REL-001/003/004 evidence; MIG-004 is required when mobility is advertised. When desktop is disabled, its enrollment, leasing, route, and updater flags remain hard off with negative evidence. When mobility is disabled, its flags/API/UI/routes remain hard off and target loss cannot create a cross-target attempt. Thus neither desktop packaging nor mobility blocks a cloud-only non-mobile private beta. Every enabled provider still requires DEP-008 and its real-provider gate. Release notes state E2B limits and that a self-hosted Firecracker platform is not included; provider-contract evidence demonstrates it can be added later without changing common authority or wire contracts.
