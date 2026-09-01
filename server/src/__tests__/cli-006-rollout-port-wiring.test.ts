// Unit 1.5 — the wiring, proven at RUNTIME where it can be, structurally where it cannot.
//
// The defect this file exists for was measured on a live single-box fleet, not inferred: an
// HTTP-created task, assigned to an eligible `org`/`claude_local` agent, with the rollout dial
// correctly set to `mode:"canary"`, produced
//
//     heartbeat_runs = 1, execution_owner = NULL, and NO `[CLI-006]` log line at all
//
// The hook existed, the dial was right, the flag was on — and the instance that actually ran
// the task was built as a bare `heartbeatService(db)` on the wakeup path, so its
// `options?.distributedRollout` was `undefined` and the canary conjunct could never be true.
// Indistinguishable from "the canary evaluated this run and chose legacy": a silent,
// unfalsifiable no-op. `distributed-cancellation-port.ts` documents this exact hazard and
// names `distributedRollout` as its example; Unit 1.5 finally closes it.
//
// The `[CLI-006]` block has SEVEN conjuncts, so its silence does not by itself isolate the
// hook — the probe gave the symptom, the source gives the cause. See the header of
// services/distributed-rollout-port.ts for which conjuncts that probe independently
// satisfied and why a missing hook is sufficient to explain all of the rest.
//
// ★ THE FALLBACK IS ASSERTED AT RUNTIME, NOT SCANNED FOR. `??` short-circuits, so the port
// getter is invoked if and only if no explicit hook was supplied. That makes both halves of
// the contract — the fallback AND the precedence — directly observable by spying on the
// mocked port module while constructing the REAL `heartbeatService`. A source-contract test
// would pass just as happily against a call whose result is discarded.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const getPort = vi.fn((): unknown => undefined);
vi.mock("../services/distributed-rollout-port.js", () => ({
  getDistributedRolloutPort: () => getPort(),
  setDistributedRolloutPort: vi.fn(),
}));

vi.mock("@armyofagents/db", () => {
  const makeTable = () =>
    new Proxy({}, { get: (_target, prop) => (prop === "$inferSelect" || prop === "$inferInsert" ? {} : Symbol(String(prop))) });
  return {
    agents: makeTable(),
    agentRuntimeState: makeTable(),
    agentTaskSessions: makeTable(),
    agentWakeupRequests: makeTable(),
    heartbeatRunEvents: makeTable(),
    heartbeatRuns: makeTable(),
    costEvents: makeTable(),
    environments: makeTable(),
    issues: makeTable(),
    projectWorkspaces: makeTable(),
    memoryItems: makeTable(),
    companies: makeTable(),
    taskDependencies: makeTable(),
    issueAttachments: makeTable(),
    issueComments: makeTable(),
    assets: makeTable(),
    projects: makeTable(),
    companySkills: makeTable(),
    teamMembers: makeTable(),
    teamCoordinations: makeTable(),
    teams: makeTable(),
    discussions: makeTable(),
    discussionExtractedItems: makeTable(),
    embeddingQueue: makeTable(),
  };
});

vi.mock("drizzle-orm", () => ({
  and: (..._args: unknown[]) => "and",
  asc: (..._args: unknown[]) => "asc",
  desc: (..._args: unknown[]) => "desc",
  eq: (..._args: unknown[]) => "eq",
  gt: (..._args: unknown[]) => "gt",
  inArray: (..._args: unknown[]) => "inArray",
  lte: (..._args: unknown[]) => "lte",
  ne: (..._args: unknown[]) => "ne",
  or: (..._args: unknown[]) => "or",
  sql: new Proxy(() => ({ as: () => "sql" }), {
    get: () => () => ({ as: () => "sql" }),
    apply: () => ({ as: () => "sql" }),
  }),
}));

vi.mock("../services/live-events.js", () => ({ publishLiveEvent: vi.fn() }));
vi.mock("../services/run-log-store.js", () => ({ getRunLogStore: vi.fn() }));
vi.mock("../services/activity-log.js", () => ({ logActivity: vi.fn() }));
vi.mock("../adapters/index.js", () => ({ getServerAdapter: vi.fn(), runningProcesses: new Map() }));
vi.mock("../agent-auth-jwt.js", () => ({ createLocalAgentJwt: vi.fn() }));
vi.mock("../adapters/api-common.js", () => ({ setSecretResolver: vi.fn() }));
vi.mock("../services/secrets.js", () => ({ secretService: vi.fn(() => ({})) }));
vi.mock("../services/output-detection.js", () => ({ outputDetectionService: vi.fn(() => ({})) }));
vi.mock("../services/run-summary.js", () => ({ formatRunSummary: vi.fn() }));
vi.mock("../services/environment-run-orchestrator.js", () => ({
  environmentRunOrchestrator: vi.fn(() => ({
    acquireForRun: vi.fn(),
  })),
}));
vi.mock("../middleware/logger.js", () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { heartbeatService } from "../services/heartbeat.js";

const HOOK = { marker: "explicit" } as never;
const PORT_HOOK = { marker: "from-port" } as never;

beforeEach(() => {
  vi.clearAllMocks();
  getPort.mockReturnValue(undefined);
});

describe("Unit 1.5 — a bare heartbeatService(db) consults the rollout port", () => {
  it("reads the port when constructed with NO options — the measured defect", () => {
    // routes/issues.ts, issue-assignee-wakeup.ts, comment-wakeup-outbox.ts, agents.ts,
    // approvals.ts and work-question-continuations.ts all construct exactly like this, and
    // enqueueWakeup EXECUTES on its own instance (dispatchQueuedRunsAfterAgentSignal ->
    // startQueuedRunsForSingleAgent -> claimQueuedRun -> executeRun). Before this fallback,
    // every one of them ran legacy in silence.
    getPort.mockReturnValue(PORT_HOOK);
    heartbeatService({} as never);
    expect(getPort).toHaveBeenCalled();
  });

  it("reads the port when options are supplied WITHOUT a rollout hook", () => {
    // A caller passing some other option must not accidentally opt out of the canary.
    getPort.mockReturnValue(PORT_HOOK);
    heartbeatService({} as never, {} as never);
    expect(getPort).toHaveBeenCalled();
  });

  it("does NOT read the port when an explicit hook is injected — the scheduler is unchanged", () => {
    // `??` short-circuits. index.ts's scheduler instance still passes its own hook, so this
    // change is byte-identical for the one construction site that was already correct.
    heartbeatService({} as never, { distributedRollout: HOOK } as never);
    expect(getPort).not.toHaveBeenCalled();
  });

  it("DOES read the port for an explicit `undefined` hook — stated, not hidden", () => {
    // The one behaviour change beyond the fix itself. `{ distributedRollout: undefined }` is
    // indistinguishable from `{}` under `??`, so such a caller now inherits the port. No
    // caller in the tree does this deliberately, and a real opt-out is expressed by not
    // registering a port at all — the flag-off default.
    getPort.mockReturnValue(PORT_HOOK);
    heartbeatService({} as never, { distributedRollout: undefined } as never);
    expect(getPort).toHaveBeenCalled();
  });
});

// ── the composition root, asserted structurally ──────────────────────────────
//
// index.ts is not reachable from an in-process unit test, so this mirrors the guard shape of
// distributed-shadow-port-registration.test.ts — for the same reason and against the same
// failure: a port that nothing registers is inert, and its silence reads as "no traffic"
// rather than "not wired". A CHECK THAT NOTHING RUNS IS NOT A CHECK.

const SRC = readFileSync(fileURLToPath(new URL("../index.ts", import.meta.url)), "utf8");

describe("Unit 1.5 — the composition root registers the rollout port", () => {
  it("calls setDistributedRolloutPort exactly once", () => {
    expect(
      SRC.match(/setDistributedRolloutPort\(/g) ?? [],
      "every non-scheduler heartbeat instance is hookless without this call; a second call " +
        "would silently replace the first hook",
    ).toHaveLength(1);
  });

  it("registers the real hook, not a placeholder", () => {
    expect(SRC).toMatch(/setDistributedRolloutPort\(\s*distributedRolloutHook\s*\)/);
  });

  it("registers it OUTSIDE the heartbeat-scheduler conditional", () => {
    // The heart of the fix. The route-constructed instances that execute task runs exist
    // whether or not `config.heartbeatSchedulerEnabled` is true, so registration gated on the
    // scheduler would reproduce the original defect on any deployment that runs the API
    // without the scheduler.
    const register = SRC.indexOf("setDistributedRolloutPort(");
    const scheduler = SRC.indexOf("if (config.heartbeatSchedulerEnabled) {");
    expect(register, "expected a registration call").toBeGreaterThan(-1);
    expect(scheduler, "expected the scheduler conditional").toBeGreaterThan(-1);
    expect(register).toBeLessThan(scheduler);
  });

  it("sits inside the distributed-execution composition, not at module scope", () => {
    // Same reasoning as the shadow port: a rollout seam for a default-off platform must not
    // arm itself on deployments that never composed distributed execution. Indentation is the
    // marker that it sits inside that block.
    expect(SRC).toMatch(/^[ \t]+setDistributedRolloutPort\(/m);
    expect(SRC).not.toMatch(/^setDistributedRolloutPort\(/m);
  });

  it("still passes the explicit hook to the scheduler instance", () => {
    // The port is a fallback, not a replacement. Removing the explicit injection would make
    // the scheduler depend on registration ORDER — a worse contract than the one being fixed.
    expect(SRC).toMatch(
      /heartbeatService\(db as any, \{ distributedRollout: distributedRolloutHook \}\)/,
    );
  });
});

describe("Unit 1.5 — heartbeat.ts prefers the explicit option over the port", () => {
  const heartbeat = readFileSync(
    fileURLToPath(new URL("../services/heartbeat.ts", import.meta.url)),
    "utf8",
  );

  it("uses ?? so an explicitly-injected hook always wins", () => {
    // `||` behaves identically today but would silently swap precedence for any future
    // falsy-but-present hook. The runtime tests above pin the short-circuit either way.
    expect(heartbeat).toContain("options?.distributedRollout ?? getDistributedRolloutPort()");
  });
});
