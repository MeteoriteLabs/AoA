import { registerHooks } from "node:module";

const guardedModules = [
  "worker-control",
  "job-leasing",
  "job-control-metrics",
  "job-ready-scheduler",
  "job-outbox-worker",
];
registerHooks({
  resolve(specifier, context, nextResolve) {
    const guarded = guardedModules.find((name) => specifier.includes(name));
    if (guarded) {
      process.stderr.write(`JOB_CONTROL_MODULE_LOAD:${guarded}\n`);
    }
    return nextResolve(specifier, context);
  },
});
