import { describe, expect, it, vi } from "vitest";
import {
  isFakeCrewLlmEnabled,
  maybeExecuteFakeCrewTurn,
} from "../services/internal-agent/aoa-agents/fake-crew-llm.js";

const db = {} as never;

describe("fake crew LLM e2e harness", () => {
  it("is disabled unless AOA_E2E_FAKE_CREW_LLM=1", async () => {
    expect(isFakeCrewLlmEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isFakeCrewLlmEnabled({ AOA_E2E_FAKE_CREW_LLM: "1" } as NodeJS.ProcessEnv)).toBe(true);

    const addEntry = vi.fn();
    const result = await maybeExecuteFakeCrewTurn({
      db,
      agent: { id: "agent-adj", name: "Adjutant" },
      payload: { companyId: "co-1", source: "thread.controller", threadId: "thr-1" },
      env: {},
      deps: { addEntry },
    });

    expect(result).toBeNull();
    expect(addEntry).not.toHaveBeenCalled();
  });

  it("review fix (minor): never enables in production even when the env flag is set", async () => {
    // Defense-in-depth: NODE_ENV=production must hard-disable the harness even if
    // AOA_E2E_FAKE_CREW_LLM leaked into the prod environment.
    expect(
      isFakeCrewLlmEnabled({
        AOA_E2E_FAKE_CREW_LLM: "1",
        NODE_ENV: "production",
      } as NodeJS.ProcessEnv),
    ).toBe(false);

    const addEntry = vi.fn();
    const result = await maybeExecuteFakeCrewTurn({
      db,
      agent: { id: "agent-adj", name: "Adjutant" },
      payload: { companyId: "co-1", source: "thread.controller", threadId: "thr-1" },
      env: { AOA_E2E_FAKE_CREW_LLM: "1", NODE_ENV: "production" } as NodeJS.ProcessEnv,
      deps: { addEntry },
    });

    expect(result).toBeNull();
    expect(addEntry).not.toHaveBeenCalled();
  });

  it("posts an Adjutant chat reply for a normal founder message", async () => {
    const addEntry = vi.fn().mockResolvedValue({});
    const result = await maybeExecuteFakeCrewTurn({
      db,
      agent: { id: "agent-adj", name: "Adjutant" },
      payload: { companyId: "co-1", source: "thread.controller", threadId: "thr-1" },
      env: { AOA_E2E_FAKE_CREW_LLM: "1" } as NodeJS.ProcessEnv,
      deps: {
        loadLatestHumanEntry: async () => ({
          id: "entry-1",
          rawContent: "Can we discuss the central panel experience?",
          seq: 1,
        }),
        addEntry,
      },
    });

    expect(result?.resultJson).toMatchObject({ fakeCrewLlm: true, action: "post_entry" });
    expect(addEntry).toHaveBeenCalledWith(
      "co-1",
      "thr-1",
      expect.objectContaining({
        inputType: "agent",
        authorAgentId: "agent-adj",
        rawContent: expect.stringContaining("Adjutant:"),
      }),
      "agent-adj",
    );
  });

  it("posts a directly mentioned crew agent reply", async () => {
    const addEntry = vi.fn().mockResolvedValue({});
    await maybeExecuteFakeCrewTurn({
      db,
      agent: { id: "agent-scout", name: "Scout" },
      payload: { companyId: "co-1", source: "thread.participation", threadId: "thr-1" },
      env: { AOA_E2E_FAKE_CREW_LLM: "1" } as NodeJS.ProcessEnv,
      deps: {
        loadLatestHumanEntry: async () => ({
          id: "entry-2",
          rawContent: "@Scout please check this",
          seq: 2,
        }),
        addEntry,
      },
    });

    expect(addEntry).toHaveBeenCalledWith(
      "co-1",
      "thr-1",
      expect.objectContaining({
        inputType: "agent",
        authorAgentId: "agent-scout",
        rawContent: expect.stringContaining("Scout:"),
      }),
      "agent-scout",
    );
  });

  it("updates summary instead of posting chat for fake Chronicler sweeps", async () => {
    const addEntry = vi.fn();
    const updateSummary = vi.fn().mockResolvedValue({});

    const result = await maybeExecuteFakeCrewTurn({
      db,
      agent: { id: "agent-chronicler", name: "Chronicler" },
      payload: { companyId: "co-1", source: "sweep.chronicler", threadId: "thr-1" },
      env: { AOA_E2E_FAKE_CREW_LLM: "1" } as NodeJS.ProcessEnv,
      deps: {
        loadLatestHumanEntry: async () => ({
          id: "entry-1",
          rawContent: "We need a scoped checkout handoff.",
          seq: 7,
        }),
        addEntry,
        updateSummary,
      } as any,
    });

    expect(result?.resultJson).toMatchObject({ fakeCrewLlm: true, action: "update_summary" });
    expect(addEntry).not.toHaveBeenCalled();
    expect(updateSummary).toHaveBeenCalledWith(
      "co-1",
      "thr-1",
      expect.objectContaining({
        text: expect.stringContaining("We need a scoped checkout handoff."),
      }),
      { userId: "agent-chronicler", role: "team_member", isHuman: false },
    );
  });

  it("routes Adjutant scope requests through proposeWork", async () => {
    const addEntry = vi.fn();
    const proposeWork = vi.fn().mockResolvedValue({ proposalId: "proposal-1" });
    const result = await maybeExecuteFakeCrewTurn({
      db,
      agent: { id: "agent-adj", name: "Adjutant" },
      payload: {
        companyId: "co-1",
        source: "thread.controller",
        threadId: "thr-1",
        effectiveAutonomy: 1,
      },
      env: { AOA_E2E_FAKE_CREW_LLM: "1" } as NodeJS.ProcessEnv,
      deps: {
        loadLatestHumanEntry: async () => ({
          id: "entry-3",
          rawContent: "Please scope this into tracked tasks.",
          seq: 3,
        }),
        addEntry,
        proposeWork,
      },
    });

    expect(result?.resultJson).toMatchObject({ fakeCrewLlm: true, action: "propose_work" });
    expect(addEntry).not.toHaveBeenCalled();
    expect(proposeWork).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "thr-1",
        companyId: "co-1",
        autonomy: 1,
        createdBy: { agentId: "agent-adj" },
        proposedTasks: expect.arrayContaining([
          expect.objectContaining({ assigneeRole: "planner" }),
          expect.objectContaining({ assigneeRole: "engineer" }),
        ]),
      }),
    );
  });
});
