// Global test setup for server test suite
// Suppress transient Node 24 IPC worker process teardown rejections from embedded-postgres child process cleanup
process.on("unhandledRejection", (reason: any) => {
  if (
    reason?.code === "ERR_IPC_CHANNEL_CLOSED" ||
    reason?.code === "ERR_IPC_DISCONNECTED" ||
    reason?.message === "Channel closed"
  ) {
    return;
  }
});
