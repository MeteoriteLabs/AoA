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
