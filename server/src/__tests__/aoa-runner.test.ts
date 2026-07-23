import { describe, expect, it, vi } from "vitest";
const { execMock, createEventMock, buildMcpMock, buildBridgeSpecMock, runLogStoreMock } = vi.hoisted(() => ({
  execMock: vi.fn().mockResolvedValue({ exitCode: 0 }),
  createEventMock: vi.fn().mockResolvedValue(undefined),
  buildMcpMock: vi.fn(() => ({ mcpServers: {} })),
  // T1: the runner opens a run transcript before adapter.execute. run-log-store
  // imports `node:fs` — a DIFFERENT specifier than the `node:fs/promises` this
  // file mocks — so without this the "mocked" runner would do REAL filesystem
  // I/O, scattering .ndjson files keyed on fixture ids (co-1/ext-1/run-1) that
  // repeat across test files. vitest runs files in parallel workers and begin()
  // TRUNCATES, so that is a latent cross-file flake, not just litter.
  runLogStoreMock: {
    begin: vi.fn().mockResolvedValue({ store: "local_file", logRef: "co-1/ext-1/run-1.ndjson" }),
    append: vi.fn().mockResolvedValue(undefined),
    finalize: vi.fn().mockResolvedValue({ bytes: 0, compressed: false }),
    read: vi.fn(),
  },
  // MX2: runner now also builds the provider-neutral bridge spec. Mock mirrors
  // buildMcpBridgeSpec's shape ({command:"node",args,env}) keyed off the params
  // the runner passes (companyId → AOA_SESSION_COMPANY_ID) so the contract is
  // observable without importing the real cli-mode module.
  buildBridgeSpecMock: vi.fn((p: any) => ({
    command: "node",
    args: ["/x/mcp-bridge.js"],
    env: { AOA_SESSION_COMPANY_ID: p?.companyId ?? "" },
  })),
}));
// Task 8: the runtime resolver now also looks up the company-level
// `provider:<id>` secret, so these harnesses must model `isNull` + the
// company_secrets tables. The stubbed row that comes back has no
// `status: "active"`, so it is skipped and no key is injected — these tests
// keep asserting exactly what they asserted before.
vi.mock("drizzle-orm", () => ({ and:(...a:unknown[])=>({and:a}), eq:(a:unknown,b:unknown)=>({eq:[a,b]}), isNull:(a:unknown)=>({isNull:a}) }));
vi.mock("@armyofagents/db", () => { const t=(n:string)=>new Proxy({},{get:(_x,p)=>typeof p==="string"?Symbol(`${n}.${p}`):undefined}); return { agents:t("a"), internalAgentRuns:t("iar"), discussionEntries:t("de"), memoryItems:t("mi"), discussions:t("disc"), discussionExtractedItems:t("dei"), embeddingQueue:t("eq"), memoryItemVersions:t("miv"), memoryRetrievals:t("mr"), suggestions:t("sug"), companySecrets:t("cs"), companySecretVersions:t("csv"), companySecretBindings:t("csb"), companySecretProviderConfigs:t("cspc"), runtimeProviderKeys:t("rpk"), secretAccessEvents:t("sae") }; });
vi.mock("../adapters/registry.js", () => ({ getServerAdapter: () => ({ execute: execMock, getRuntimeCommandSpec: () => ({}) }) }));
vi.mock("../services/costs.js", () => ({ costService: () => ({ createEvent: createEventMock }) }));
vi.mock("../services/internal-agent/cli-mode.js", () => ({ buildMcpConfig: buildMcpMock, buildMcpBridgeSpec: buildBridgeSpecMock }));
vi.mock("../services/heartbeat.js", () => ({ resolveAdapterExecutionContext: () => ({ executionTarget:{}, runtimeCommandSpec:{} }) }));
vi.mock("../services/internal-agent/aoa-agents/bridge-path.js", () => ({ resolveBridgeEntrypoint: () => "/x/mcp-bridge.js" }));
vi.mock("node:fs/promises", () => ({ writeFile: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../services/run-log-store.js", () => ({ getRunLogStore: () => runLogStoreMock }));
vi.mock("../middleware/logger.js", () => ({ logger:{ child:()=>({info:vi.fn(),warn:vi.fn(),error:vi.fn()}) } }));
import { discussionEntries } from "@armyofagents/db";
import { runAoaAgent } from "../services/internal-agent/aoa-agents/runner.js";
function ch(ret:unknown[]){const c:any={};c.values=()=>c;c.set=()=>c;c.where=()=>c;c.from=()=>c;c.returning=()=>Promise.resolve(ret);c.then=(r:(v:unknown[])=>unknown)=>Promise.resolve(ret).then(r);return c;}
it("happy: bridge attached via adapterConfig.args, run completed, cost emitted, agentId stamped", async () => {
  const insertedRuns:any[]=[];
  const db:any = {
    select:()=>ch([{ id:"ext-1", companyId:"co-1", name:"Scribe", adapterType:"process", adapterConfig:{}, runtimeConfig:{ aoa:{ instruction:"do extraction", role:"scribe" } } }]),
    insert:()=>({ values:(v:any)=>{ insertedRuns.push(v); return { returning:()=>Promise.resolve([{id:"run-1"}]) }; } }),
    update:()=>ch([{ id:"e1" }]), // claim returns non-empty (claimed)
  };
  await runAoaAgent(db, "ext-1", { companyId:"co-1", source:"discussion_entry_pending", entryId:"e1" });
  expect(buildMcpMock).toHaveBeenCalled();
  const execArg = execMock.mock.calls[0][0];
  // MX2: superseded-test update (controller-authorized). The old assertion
  // `execArg.config.args).toContain("--mcp-config")` pinned the pre-MX2
  // claude-only-for-ALL-adapters delivery this milestone deliberately
  // generalizes. The real contract is now two-pronged and re-asserted here:
  //  (a) non-claude adapters (this agent is adapterType:"process") must NOT
  //      get the bogus claude --mcp-config flag leaked into config.args;
  //  (b) the neutral mcpBridge spec is handed to every adapter via ctx.
  // process adapter has no adapterConfig.args, so config.args is absent; the
  // contract is simply "the bogus claude flag never appears". Default to []
  // so the assertion is robust whether args is absent or a real array.
  expect(execArg.config.args ?? []).not.toContain("--mcp-config");
  expect(execArg.mcpBridge).toMatchObject({ command:"node" });
  expect(Array.isArray(execArg.mcpBridge.args)).toBe(true);
  expect(execArg.mcpBridge.env).toMatchObject({ AOA_SESSION_COMPANY_ID:"co-1" });
  // T1: the run transcript is opened for the agent+run, and the sink is REALLY
  // wired to the adapter — the pre-T1 bug was two literal no-op callbacks that
  // silently discarded every byte, so asserting the callbacks reach the store is
  // the whole point.
  expect(runLogStoreMock.begin).toHaveBeenCalledWith({ companyId:"co-1", agentId:"ext-1", runId:"run-1" });
  await execArg.onLog("stdout", "transcript chunk");
  expect(runLogStoreMock.append.mock.calls.at(-1)?.[1]).toMatchObject({ stream:"stdout", chunk:"transcript chunk" });
  expect(insertedRuns[0].agentId).toBe("ext-1");          // Finding R1: run attributed to the agent
  expect(createEventMock).toHaveBeenCalledTimes(1);
  expect(createEventMock.mock.calls[0][1].agentId).toBe("ext-1");
  expect(createEventMock.mock.calls[0][1].costCents).toBe(0); // §16.3 zeroed
});
it("claude-family: --mcp-config tmp file kept (byte-identical) AND mcpBridge also set", async () => {
  execMock.mockClear();
  const db:any = {
    select:()=>ch([{ id:"cl-1", companyId:"co-1", name:"Scribe", adapterType:"claude_local", adapterConfig:{}, runtimeConfig:{ aoa:{ instruction:"do extraction", role:"scribe" } } }]),
    insert:()=>({ values:()=>({ returning:()=>Promise.resolve([{id:"run-c"}]) }) }),
    update:()=>ch([{ id:"e1" }]),
  };
  await runAoaAgent(db, "cl-1", { companyId:"co-1", source:"discussion_entry_pending", entryId:"e1" });
  const execArg = execMock.mock.calls[0][0];
  // claude_local keeps the pre-MX2 delivery BYTE-IDENTICAL: --mcp-config
  // followed by the aoa-mcp-<agentId>-<runId>.json tmp path, prepended to args.
  expect(execArg.config.args[0]).toBe("--mcp-config");
  expect(String(execArg.config.args[1])).toMatch(/aoa-mcp-cl-1-run-c\.json$/);
  // ...and the neutral bridge spec is ALSO handed over (MX3 consumes it).
  expect(execArg.mcpBridge).toMatchObject({ command:"node" });
  expect(execArg.mcpBridge.env).toMatchObject({ AOA_SESSION_COMPANY_ID:"co-1" });
});
it("failure isolated: adapter throws → never rethrows", async () => {
  execMock.mockRejectedValueOnce(new Error("boom"));
  const db:any = { select:()=>ch([{ id:"ext-1", companyId:"co-1", name:"Scribe", adapterType:"process", adapterConfig:{}, runtimeConfig:{} }]), insert:()=>ch([{id:"run-2"}]), update:()=>ch([{id:"e2"}]) };
  // T1.0: runner now returns AoaRunResult instead of void. Adapter threw,
  // so we expect status='failed' with the thrown message.
  const r1 = await runAoaAgent(db,"ext-1",{ companyId:"co-1", source:"discussion_entry_pending", entryId:"e2" });
  expect(r1.status).toBe("failed");
  expect(r1.errorMessage).toBe("boom");
});
it("not claimable (concurrent): atomic claim empty → adapter NOT called, returns", async () => {
  execMock.mockClear();
  const claimChain:any = { set:()=>claimChain, where:()=>claimChain, returning:()=>Promise.resolve([]) }; // claim RETURNING empty
  const db:any = {
    select:()=>ch([{ id:"ext-1", companyId:"co-1", name:"Scribe", adapterType:"process", adapterConfig:{}, runtimeConfig:{} }]),
    insert:()=>ch([{ id:"run-9" }]),
    // Discriminate by TABLE, not by call order: the runner now also writes the
    // run-log pointer (internal_agent_runs.log_store/log_ref) before the claim,
    // so a positional "1st update === the claim" harness silently handed the
    // claim a non-empty result and the run proceeded past the abort.
    update:(tbl:unknown)=> (tbl === discussionEntries ? claimChain : ch([{ id:"run-9" }])),
  };
  // T1.0: not-claimable returns succeeded (it's a concurrent race, not a
  // failure — another run owns this entry). Pre-T1.0 this was undefined.
  // P1-C: claim gate requires source="outbox". Other sources skip the claim
  // (and therefore the not-claimable abort path). Using "outbox" preserves
  // the test's original intent: claim attempted, empty result → adapter NOT
  // called, function returns early.
  const r9 = await runAoaAgent(db,"ext-1",{ companyId:"co-1", source:"outbox", entryId:"e9" });
  expect(r9.status).toBe("succeeded");
  expect(execMock).not.toHaveBeenCalled();
});
