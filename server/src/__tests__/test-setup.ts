// Global test setup for server test suite
// 1. Suppress transient Node 24 IPC worker process teardown rejections from embedded-postgres child process cleanup
const handleIpcErr = (reason: any) => {
  if (
    reason?.code === "ERR_IPC_CHANNEL_CLOSED" ||
    reason?.code === "ERR_IPC_DISCONNECTED" ||
    reason?.message === "Channel closed" ||
    String(reason?.stack ?? "").includes("ERR_IPC_CHANNEL_CLOSED")
  ) {
    return;
  }
};

process.on("unhandledRejection", handleIpcErr);
process.on("uncaughtException", handleIpcErr);

// 2. Prevent third-party packages (e.g. embedded-postgres / async-exit-hook) from calling process.exit()
// which terminates the Vitest worker process prematurely and breaks tinypool IPC channel communication.
process.exit = function () {
  return undefined as never;
} as typeof process.exit;

// 3. Prevent embedded-postgres async-exit-hook from attaching process signal / exit hooks
// that hijack Vitest tinypool worker teardown and close worker IPC channels.
const origOn = process.on.bind(process);
const origAddListener = process.addListener.bind(process);

function isExitHookListener(listener: any): boolean {
  const fnStr = String(listener ?? "");
  return (
    listener?.name === "uncaughtHandler" ||
    fnStr.includes("gracefulShutdown") ||
    fnStr.includes("exitHook")
  );
}

process.on = function (event: any, listener: any) {
  if (isExitHookListener(listener)) {
    return process;
  }
  return origOn(event, listener);
} as typeof process.on;

process.addListener = function (event: any, listener: any) {
  if (isExitHookListener(listener)) {
    return process;
  }
  return origAddListener(event, listener);
} as typeof process.addListener;
