import { afterAll } from "vitest";

// Global test setup for server test suite
// Suppress transient Node 24 IPC worker process teardown rejections from embedded-postgres child process cleanup
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

// Remove async-exit-hook listeners added by embedded-postgres import that prevent clean tinypool worker exits
afterAll(() => {
  const events: Array<NodeJS.Signals | "uncaughtException" | "unhandledRejection"> = [
    "SIGINT",
    "SIGTERM",
    "SIGHUP",
  ];
  for (const event of events) {
    const listeners = process.listeners(event);
    for (const listener of listeners) {
      if (
        listener.name === "uncaughtHandler" ||
        listener.toString().includes("gracefulShutdown") ||
        listener.toString().includes("exitHook")
      ) {
        process.removeListener(event, listener);
      }
    }
  }
});
