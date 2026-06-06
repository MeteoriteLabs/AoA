/** In-flight tool-call counter — the watchdog must never terminate while > 0. */
export function createInFlightCounter() {
  let n = 0;
  return {
    enter() { n++; },
    leave() { n = Math.max(0, n - 1); },
    get count() { return n; },
  };
}

/**
 * stdin EOF means "no more requests are coming". The bug was exiting *immediately*
 * on EOF, which dropped a response for a tools/call that was still awaiting. The
 * fix is to DRAIN first: poll the in-flight counter and exit only once it reaches
 * 0 (every in-flight response has been written). This is drain-safe — it never
 * terminates while a call is in flight — and, unlike PPID liveness, it does not
 * depend on the spawning process tree (robust across the Windows .cmd-wrapper
 * launch the integration harness uses). Returns a canceller.
 */
export function drainThenExit(opts: {
  getInFlight: () => number;
  onDrained: () => void;
  intervalMs?: number;
}) {
  if (opts.getInFlight() <= 0) { opts.onDrained(); return () => {}; }
  const timer = setInterval(() => {
    if (opts.getInFlight() > 0) return; // still draining; keep the response path open
    clearInterval(timer);
    opts.onDrained();
  }, opts.intervalMs ?? 50);
  if (typeof timer.unref === "function") timer.unref();
  return () => clearInterval(timer);
}

/**
 * Terminate the bridge only when its parent (the spawning CLI) is gone — and
 * NEVER while a tool call is in flight. PPID liveness is fragile (Windows
 * reparenting / .cmd wrappers), so a single failed probe is "unknown", not
 * "dead": require N consecutive failures.
 */
export function startParentWatchdog(opts: {
  getInFlight: () => number;
  onDead: () => void;
  ppid?: number;
  intervalMs?: number;
  graceFailures?: number;
}) {
  const ppid = opts.ppid ?? process.ppid;
  const graceFailures = opts.graceFailures ?? 3;
  let failures = 0;
  const timer = setInterval(() => {
    let alive = true;
    try { process.kill(ppid, 0); } catch (e: any) { alive = e?.code === "EPERM"; } // EPERM = exists, no perm = alive
    if (alive) { failures = 0; return; }
    if (++failures < graceFailures) return;          // unknown, not dead yet
    if (opts.getInFlight() > 0) return;              // never kill mid-call
    clearInterval(timer);
    opts.onDead();
  }, opts.intervalMs ?? 1000);
  if (typeof timer.unref === "function") timer.unref();
  return () => clearInterval(timer);
}
