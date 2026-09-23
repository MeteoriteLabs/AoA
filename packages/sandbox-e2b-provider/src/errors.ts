// -----------------------------------------------------------------------------
// Denial classes the E2B driver + its invoke-adapter throw (CLI-001/D1).
//
// The authority denials are the EXACT worker-daemon classes (re-exported here for
// one import site): `EffectAuthorityWithdrawnError`, `CleanupAuthorityDeniedError`
// (with `.attemptedOperation`), `ResourceNotAvailableError`, `SandboxNotFoundError`,
// and `UnsupportedProviderOperation` (with `.operation`). Reusing the real classes
// (not shape-mirrors) means a real adapter conforms to the DEP-008 suite's
// duck-typed `name`+discriminant assertions against production identities.
//
// `SandboxEgressDeniedError` is the ONE denial worker-daemon has no class for
// (its egress denial is an EVENT payload carrying a `NetworkDenialClass`, not a
// thrown error). It is defined here, provider-neutral, carrying the frozen
// destination class as `destinationClass` — matched by-name in the isolation suite.
// -----------------------------------------------------------------------------

export {
  EffectAuthorityWithdrawnError,
  CleanupAuthorityDeniedError,
  ResourceNotAvailableError,
  SandboxNotFoundError,
  UnsupportedProviderOperation,
  // SVC-008a — a launch that could not be acknowledged, and a record whose lifecycle
  // state could not be classified. Same reuse rule as above: these are the worker-daemon
  // classes, not shape-mirrors, so `instanceof` works across the seam — which for
  // `SandboxRecordIndeterminateError` is load-bearing rather than tidy: `CleanupAuthority`
  // must RECOGNIZE it to keep an unreadable record from disarming the forced destroy.
  ProcessLaunchNotAcknowledged,
  SandboxRecordIndeterminateError,
} from "@armyofagents/worker-daemon";

/**
 * Provider-neutral egress denial. Thrown when an active-fence egress attempt is
 * refused; `destinationClass` carries the frozen network-denial class
 * (`metadata` / `private` / `control_plane` / `not_allowlisted`) as an opaque
 * label — no new NETWORK_DENIAL vocabulary is minted. Matched duck-typed
 * (`name` + `destinationClass`) by `runSandboxIsolationConformance` §2.6.
 */
export class SandboxEgressDeniedError extends Error {
  readonly destinationClass: string;
  constructor(destinationClass: string) {
    super(`egress denied: ${destinationClass}`);
    this.name = "SandboxEgressDeniedError";
    this.destinationClass = destinationClass;
  }
}

/**
 * CLI-012, planning-session ruling on §11.9 (2026-09-23) — **SD-5's refusal, shipped BEFORE
 * SD-5's scanner.** No export scanner is configured, or the one configured is not callable.
 *
 * ★★★ FAIL-CLOSED ON PRESENCE, NEVER ON A FLAG. `E7-D11` rules SD-5 REQUIRED before `M1b`'s
 * campaign, but until `CLI-017-B` supplies the scanner the only thing closing that window was a
 * PROSE precondition — which in this programme is the *"a check that nothing runs is not a
 * check"* class. Codex proposed closing it by deferring the producer's composition; the ruling
 * refused that (it would un-promote `E5-2` under `E5-D07` ruling 4, and it protects only the one
 * path someone remembered to defer) and ordered this instead: the export boundary itself refuses
 * while the scanner is absent. Every caller is covered, including callers nobody defers, and the
 * ship order inverts correctly — `CLI-017-B` flips this on against an interface that already
 * refuses without it.
 *
 * ★ REFUSED BEFORE THE READ, so the bytes are not even materialised, let alone uploaded.
 */
export class SandboxExportScannerUnavailableError extends Error {
  constructor() {
    super("artifact export refused: no export secret scanner is configured (SD-5 fail-closed)");
    this.name = "SandboxExportScannerUnavailableError";
  }
}

/**
 * CLI-012 — the scanner ran and did NOT clear the bytes: it rejected, or it threw.
 *
 * ★ A THROWN SCANNER IS A REFUSAL, NOT A BYPASS. A scanner that fails to complete has witnessed
 * nothing, and "the check errored" must never read as "the check passed".
 *
 * ★ THE SCANNER'S OWN MESSAGE NEVER RIDES OUT. It has seen the file's bytes and may have been
 * handed the grant, so interpolating it here would be the exfiltration channel the scan exists to
 * close. Fixed string, deliberately.
 */
export class SandboxExportScannerRefusedError extends Error {
  constructor() {
    super("artifact export refused: the export secret scanner did not clear the bytes");
    this.name = "SandboxExportScannerRefusedError";
  }
}
