// packages/browser-runtime/src/index.ts
//
// BRW-002 — the sandbox-local browser runtime.
//
// This package is deliberately DEPENDENCY-FREE at runtime. It is staged into the job sandbox
// and executed there, next to Chromium, because the CDP pipe rides file descriptors 3 and 4
// of the spawned child (`playwright-core/lib/server/browserType.js:268-269`) and only the
// spawning process can hold them. A host-side orchestrator can start this and read its
// output; it cannot drive Playwright across the sandbox boundary.
export {
  checkBrowserLaunchSafety,
  type BrowserLaunchCheck,
  type BrowserLaunchOptions,
  type BrowserLaunchRefusal,
} from "./launch-guard.js";
export {
  listeningPortDelta,
  parseListeningPorts,
  readListeningPorts,
  type ReadProcFile,
} from "./listening-ports.js";
export {
  resolveUnderRoot,
  safeDownloadName,
  type PathRefusal,
  type ResolvedUnderRoot,
} from "./path-adapter.js";
