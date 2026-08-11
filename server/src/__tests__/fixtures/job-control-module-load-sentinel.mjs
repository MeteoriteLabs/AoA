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
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (process.env.AOA_JOB_CONTROL_MODULE_LOAD_SENTINEL !== "identity" ||
      loaded.format !== "module" || loaded.source === undefined || loaded.source === null) {
      return loaded;
    }
    const normalizedUrl = url.replaceAll("\\", "/");
    const moduleName = [
      ["job-control-metrics", "/server/src/services/job-control-metrics."],
      ["job-ready-scheduler", "/server/src/services/job-ready-scheduler."],
      ["job-outbox-worker", "/server/src/services/job-outbox-worker."],
      ["worker-control", "/server/src/routes/worker-control."],
      ["job-leasing", "/server/src/services/job-leasing."],
    ].find(([, path]) => normalizedUrl.includes(path))?.[0];
    if (!moduleName) return loaded;
    const functionByModule = {
      "job-control-metrics": "createPinoJobControlMetrics",
      "job-ready-scheduler": "createJobReadyScheduler",
      "job-outbox-worker": "createJobOutboxWorker",
      "worker-control": "workerControlRoutes",
      "job-leasing": "createJobLeasingService",
    };
    const factory = functionByModule[moduleName];
    const metricFactory = moduleName === "job-control-metrics";
    const instrumentation = metricFactory
      ? `
const __job003OriginalFactory = ${factory};
${factory} = (...args) => {
  const instance = __job003OriginalFactory(...args);
  globalThis[Symbol.for("aoa.job003.metrics.identity")] = instance;
  process.stderr.write("JOB_CONTROL_METRICS_IDENTITY:metrics\\n");
  return instance;
};`
      : `
const __job003OriginalFactory = ${factory};
${factory} = (input, ...rest) => {
  const marker = globalThis[Symbol.for("aoa.job003.metrics.identity")];
  const same = marker !== undefined && input?.${moduleName === "worker-control" ? "jobControlMetrics" : "metrics"} === marker;
  process.stderr.write("JOB_CONTROL_METRICS_IDENTITY:${moduleName}:" + (same ? "same" : "different") + "\\n");
  return __job003OriginalFactory(input, ...rest);
};`;
    return { ...loaded, source: `${String(loaded.source)}\n${instrumentation}\n` };
  },
});
