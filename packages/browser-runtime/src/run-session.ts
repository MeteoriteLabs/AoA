// packages/browser-runtime/src/run-session.ts
//
// BRW-002 — the session orchestrator.
//
// This is the in-guest control flow: guard, measure, launch, drive, persist, close. It takes
// an INJECTED driver rather than importing Playwright, for one reason that is about proof
// rather than tidiness — the ORDER of operations here is a security and durability property,
// and an injected driver makes that order an assertion instead of a comment.
//
// THE ORDERING IS MUTUALLY CONSTRAINED, and neither half is visible from a screenshot:
//   * Playwright writes video only when the context CLOSES.
//   * Closing the context DELETES the `downloadsPath` staging area.
// So every download must be persisted with `saveAs` BEFORE close, and close must still
// happen. Getting it wrong loses the downloads or the video, silently, in a way no
// happy-path test would notice.
//
// Runs inside the sandbox next to Chromium, because the CDP pipe rides file descriptors 3
// and 4 of the spawned child (`playwright-core/lib/server/browserType.js:268-269`) and only
// the spawning process can hold them. A host-side orchestrator cannot drive Playwright across
// the sandbox boundary — it can only start this and read what it emits.
import { checkBrowserLaunchSafety, type BrowserLaunchOptions } from "./launch-guard.js";
import { listeningPortDelta } from "./listening-ports.js";

export interface SessionStep {
  readonly action: "navigate";
  readonly url: string;
}

export interface SessionConfig {
  readonly downloadRoot: string;
  readonly steps: readonly SessionStep[];
  readonly launch: BrowserLaunchOptions;
}

/** A download the browser produced. `saveAs` is the only durable sink. */
export interface DownloadHandle {
  suggestedFilename(): string;
  saveAs(target: string): Promise<void>;
}

export interface BrowserPage {
  navigate(url: string): Promise<void>;
  collectDownloads(): Promise<readonly DownloadHandle[]>;
  /** Flushes video. Also destroys the download staging area — hence the ordering. */
  close(): Promise<void>;
}

export interface BrowserDriver {
  launch(options: BrowserLaunchOptions): Promise<BrowserPage>;
}

/** Result of resolving a download destination; mirrors `path-adapter`'s shape. */
export type ResolveResult =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly reason: string; readonly detail: string };

export interface SessionDeps {
  readonly driver: BrowserDriver;
  /** Called twice: immediately before launch and immediately after. */
  readonly measurePorts: () => Promise<readonly number[]>;
  readonly resolvePath: (root: string, name: string) => ResolveResult;
  readonly env: NodeJS.ProcessEnv;
}

export type SessionFailure =
  | "cdp_port_requested"
  | "remote_debugging_arg"
  | "argument_not_allowed"
  | "remote_endpoint_env"
  | "chromium_sandbox_disabled"
  | "port_opened"
  | "download_refused"
  | "launch_failed"
  | "step_failed";

export type SessionResult =
  | { readonly ok: true; readonly savedDownloads: readonly string[] }
  | { readonly ok: false; readonly reason: SessionFailure; readonly detail: string };

/**
 * Run one browser session to completion.
 *
 * Failure is reported, never thrown: this runs as the sandbox's entrypoint, and a thrown
 * error would surface as an opaque non-zero exit with no reason attached.
 */
export async function runBrowserSession(
  config: SessionConfig,
  deps: SessionDeps,
): Promise<SessionResult> {
  // 1. GUARD FIRST. A refused launch must not start a browser — checking afterwards would
  //    mean the endpoint we are trying to prevent had already existed.
  const safety = checkBrowserLaunchSafety(config.launch, deps.env);
  if (!safety.ok) return { ok: false, reason: safety.reason, detail: safety.detail };

  // 2. Baseline the sockets BEFORE launch, so the comparison is a delta and not an absolute
  //    set (envd already holds a port in every sandbox).
  const portsBefore = await deps.measurePorts();

  let page: BrowserPage;
  try {
    page = await deps.driver.launch(config.launch);
  } catch (error) {
    return {
      ok: false,
      reason: "launch_failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  // Everything below runs with a live browser, so every exit path goes through `finish`,
  // which persists evidence and then closes. A bare `throw` here would leak the browser and
  // lose whatever it had already produced.
  let stepFailure: string | null = null;
  try {
    const portsAfter = await deps.measurePorts();
    const opened = listeningPortDelta(portsBefore, portsAfter);
    if (opened.length > 0) {
      return await finish(page, config, deps, {
        ok: false,
        reason: "port_opened",
        detail: `browser opened listening port(s): ${opened.join(", ")}`,
      });
    }

    for (const step of config.steps) {
      try {
        await page.navigate(step.url);
      } catch (error) {
        stepFailure = error instanceof Error ? error.message : String(error);
        break;
      }
    }
  } catch (error) {
    stepFailure = error instanceof Error ? error.message : String(error);
  }

  return await finish(
    page,
    config,
    deps,
    stepFailure === null ? null : { ok: false, reason: "step_failed", detail: stepFailure },
  );
}

/**
 * Persist evidence, then close.
 *
 * `pending` is the failure already decided, or null. A download refusal outranks it: a
 * destination that escaped the job root is a containment finding and must not be masked by
 * an ordinary step failure that happened first.
 */
async function finish(
  page: BrowserPage,
  config: SessionConfig,
  deps: SessionDeps,
  pending: { ok: false; reason: SessionFailure; detail: string } | null,
): Promise<SessionResult> {
  const saved: string[] = [];
  let refusal: { reason: SessionFailure; detail: string } | null = null;

  try {
    const downloads = await page.collectDownloads();
    for (const download of downloads) {
      const resolved = deps.resolvePath(config.downloadRoot, download.suggestedFilename());
      if (!resolved.ok) {
        // Do NOT write. A refused destination is the case this guard exists for.
        refusal ??= {
          reason: "download_refused",
          detail: `${download.suggestedFilename()}: ${resolved.detail}`,
        };
        continue;
      }
      await download.saveAs(resolved.path);
      saved.push(resolved.path);
    }
  } catch (error) {
    refusal ??= {
      reason: "download_refused",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  // ALWAYS close, even after a failure: this is what flushes video, and a browser left open
  // is a leak the sandbox TTL would have to clean up.
  try {
    await page.close();
  } catch {
    // A close failure must not mask the real reason; the sandbox teardown reclaims it.
  }

  if (refusal !== null) return { ok: false, ...refusal };
  if (pending !== null) return pending;
  return { ok: true, savedDownloads: saved };
}
