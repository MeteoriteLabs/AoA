// packages/browser-runtime/src/launch-guard.ts
//
// BRW-002 — the enforcer for `public_cdp_endpoint`.
//
// That token is a FORBIDDEN EFFECT named in the frozen golden-journey fixture
// (`tests/fixtures/distributed-execution/browser-approval-download.json:222`) and, until this
// module, nothing in the tree checked it — `forbiddenEffects` is only length-checked by
// `golden-journeys.test.ts`. A named forbidden effect nobody enforces is this programme's
// signature defect.
//
// THE DANGER IS MEASURED, NOT ASSUMED. A probe run from a GitHub runner fetched marker
// content from port 9222 of a live E2B sandbox with no credentials of any kind
// (`packages/sandbox-e2b-provider/scripts/probe-e2b-port-exposure.mjs`). E2B routes sandbox
// ports on a public wildcard domain and the URL is derivable from the sandboxId alone. So a
// Chromium that binds a debugging port publishes a fully-privileged browser control endpoint
// — cookies, storage state, arbitrary navigation — to the internet.
//
// WHY THIS CHECKS OPTIONS AND NOT ONLY ARGS. An earlier design inspected `args` alone. That
// is the wrong surface. `cdpPort` is a LAUNCH OPTION that never appears in `args`, and on its
// own it flips Playwright off the pipe transport (`browserType.js:265-266`):
//     if (options.cdpPort !== void 0 || !this.supportsPipeTransport())
//       transport = await WebSocketTransport.connect(progress, wsEndpoint);
//     else
//       transport = new PipeTransport(stdio[3], stdio[4]);
//
// Pure and synchronous: no I/O, no clock, no process access. The caller supplies `env` rather
// than the module reading `process.env`, so every case is directly testable.

/** The launch surface this guard inspects. A structural subset of Playwright's
 * `LaunchOptions` — deliberately not imported, so this package stays dependency-free and the
 * guard can run anywhere (including on the host, before a runner is staged). */
export interface BrowserLaunchOptions {
  readonly headless?: boolean;
  /** Playwright pushes `--no-sandbox` unless this is exactly `true` (chromium.js:295-296). */
  readonly chromiumSandbox?: boolean;
  /** Set at all ⇒ WebSocket transport on a TCP port. Never appears in `args`. */
  readonly cdpPort?: number;
  readonly args?: readonly string[];
}

export type BrowserLaunchRefusal =
  | "cdp_port_requested"
  | "remote_debugging_arg"
  | "remote_endpoint_env"
  | "chromium_sandbox_disabled";

export type BrowserLaunchCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: BrowserLaunchRefusal; readonly detail: string };

/** Env vars that reroute the driver to a remote endpoint instead of a local pipe. */
const REMOTE_ENDPOINT_ENV = ["SELENIUM_REMOTE_URL", "PW_TEST_CONNECT_WS_ENDPOINT"] as const;

/**
 * Argument prefixes that open, or hand over, a remote control channel.
 *
 * `--remote-debugging-pipe` is included even though a pipe is what we WANT: Playwright manages
 * it itself and throws if the caller passes it (chromium.js:281-282, "Playwright manages
 * remote debugging connection itself"). Refusing it here turns a launch-time crash into a
 * typed refusal.
 *
 * Matching is on a `--flag` boundary — the flag itself, or the flag followed by `=`. A bare
 * `startsWith` would also refuse `--remote-allow-origins`, and an over-broad guard that
 * refuses safe launches is a guard that gets relaxed later.
 */
const REMOTE_DEBUGGING_FLAGS = [
  "--remote-debugging-port",
  "--remote-debugging-address",
  "--remote-debugging-pipe",
] as const;

/** Arguments that defeat Chromium's OS sandbox by name. */
const SANDBOX_DEFEATING_FLAGS = ["--no-sandbox", "--disable-setuid-sandbox"] as const;

/** True iff `arg` is exactly `flag` or `flag=<value>`, ignoring case and surrounding space. */
function matchesFlag(arg: string, flag: string): boolean {
  const normalized = arg.trim().toLowerCase();
  return normalized === flag || normalized.startsWith(`${flag}=`);
}

function findFlag(args: readonly string[], flags: readonly string[]): string | null {
  for (const arg of args) {
    for (const flag of flags) {
      if (matchesFlag(arg, flag)) return arg.trim();
    }
  }
  return null;
}

/**
 * Decide whether a browser launch may proceed.
 *
 * Refusal order is FIXED and asserted by a test: a launch can violate several rules at once,
 * and an unstable reason would make every reason-asserting test flaky as the implementation
 * is reordered. Order: cdpPort → debugging args → env → OS sandbox.
 */
export function checkBrowserLaunchSafety(
  options: BrowserLaunchOptions,
  env: NodeJS.ProcessEnv,
): BrowserLaunchCheck {
  // `!== undefined`, never truthiness: `cdpPort: 0` asks the OS to pick an ephemeral port
  // (exactly what Playwright's bidi path does with `--remote-debugging-port=0`), and 0 is
  // falsy — so `if (options.cdpPort)` would wave through the very case that opens a port.
  if (options.cdpPort !== undefined) {
    return {
      ok: false,
      reason: "cdp_port_requested",
      detail: `cdpPort=${options.cdpPort} selects the WebSocket transport instead of the pipe`,
    };
  }

  const args = options.args ?? [];

  const debuggingArg = findFlag(args, REMOTE_DEBUGGING_FLAGS);
  if (debuggingArg !== null) {
    return {
      ok: false,
      reason: "remote_debugging_arg",
      detail: `argument ${debuggingArg} opens or reassigns a remote control channel`,
    };
  }

  for (const name of REMOTE_ENDPOINT_ENV) {
    // An empty value reroutes nothing; refusing it would make the guard noisy enough to be
    // switched off, which is worse than the case it would catch.
    if ((env[name] ?? "") !== "") {
      return {
        ok: false,
        reason: "remote_endpoint_env",
        detail: `${name} reroutes the driver to a remote endpoint`,
      };
    }
  }

  // Playwright DISABLES Chromium's own OS sandbox unless this is exactly `true`. Every
  // containment claim in BRW-002 assumes the renderer stays contained, so an omitted flag is
  // a silent downgrade, not a default.
  if (options.chromiumSandbox !== true) {
    return {
      ok: false,
      reason: "chromium_sandbox_disabled",
      detail: "chromiumSandbox must be true; Playwright otherwise passes --no-sandbox",
    };
  }

  const sandboxDefeatingArg = findFlag(args, SANDBOX_DEFEATING_FLAGS);
  if (sandboxDefeatingArg !== null) {
    return {
      ok: false,
      reason: "chromium_sandbox_disabled",
      detail: `argument ${sandboxDefeatingArg} defeats the OS sandbox`,
    };
  }

  return { ok: true };
}
