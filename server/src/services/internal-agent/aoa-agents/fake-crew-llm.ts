import { and, desc, eq, isNull, ne } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { discussionEntries } from "@armyofagents/db";
import type { AdapterExecutionResult } from "../../../adapters/types.js";

export interface FakeCrewAgent {
  id: string;
  name: string;
}

export interface FakeCrewPayload {
  companyId: string;
  source: string;
  threadId?: unknown;
  effectiveAutonomy?: unknown;
  role?: unknown;
}

interface LatestHumanEntry {
  id: string;
  rawContent: string;
  seq: number;
}

export interface FakeCrewDeps {
  loadLatestHumanEntry?: (threadId: string) => Promise<LatestHumanEntry | null>;
  addEntry?: (
    companyId: string,
    threadId: string,
    data: {
      inputType: string;
      rawContent: string;
      authorAgentId: string | null;
      sourceInfo: Record<string, unknown> | null;
    },
    actorId: string,
  ) => Promise<unknown>;
  updateSummary?: (
    companyId: string,
    threadId: string,
    summary: { text: string; next: string | null },
    actor: { userId: string; role: "founder" | "team_lead" | "team_member"; isHuman: boolean },
  ) => Promise<unknown>;
  proposeWork?: (args: {
    threadId: string;
    companyId: string;
    autonomy: number | null;
    summary: string;
    proposedTasks: Array<{ title: string; assigneeRole?: string }>;
    createdBy: { agentId: string };
  }) => Promise<unknown>;
}

export function isFakeCrewLlmEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  // Defense-in-depth (review fix (minor)): the fake-crew harness is an E2E-only
  // escape hatch that fabricates crew replies without calling a real LLM. Gate it
  // on NODE_ENV in addition to the opt-in env var so it can NEVER activate in
  // production even if AOA_E2E_FAKE_CREW_LLM leaks into a prod environment.
  return env.AOA_E2E_FAKE_CREW_LLM === "1" && env.NODE_ENV !== "production";
}

function wantsScope(content: string): boolean {
  return /\b(scope|scoping|formalize|tracked tasks|turn.+tasks|create.+tasks)\b/i.test(content);
}

function buildFakeReply(agent: FakeCrewAgent, latest: LatestHumanEntry | null): string {
  const prompt = latest?.rawContent.trim() || "the thread";
  if (agent.name === "Adjutant") {
    return [
      "Adjutant:",
      "I can help move this forward.",
      "I would clarify the outcome, bring in the right crew, and only scope it once the handoff is concrete.",
    ].join(" ");
  }

  if (agent.name === "Scout") {
    return [
      "Scout:",
      "I checked the thread context.",
      "The useful next step is to validate the user need, constraints, and source evidence before this becomes tracked work.",
    ].join(" ");
  }

  return `${agent.name}: I reviewed the thread context and can contribute to this next step: ${prompt.slice(0, 160)}`;
}

function buildFakeSummary(latest: LatestHumanEntry | null): { text: string; next: string | null } {
  const prompt = latest?.rawContent.trim() || "No recent human message yet.";
  return {
    text: `Latest discussion focus: ${prompt.slice(0, 220)}`,
    next: "Keep the summary current until the thread is ready to scope.",
  };
}

async function defaultLoadLatestHumanEntry(db: Db, threadId: string): Promise<LatestHumanEntry | null> {
  const rows = await db
    .select({
      id: discussionEntries.id,
      rawContent: discussionEntries.rawContent,
      seq: discussionEntries.seq,
    })
    .from(discussionEntries)
    .where(
      and(
        eq(discussionEntries.discussionId, threadId),
        isNull(discussionEntries.authorAgentId),
        ne(discussionEntries.inputType, "agent"),
        ne(discussionEntries.inputType, "system"),
        ne(discussionEntries.inputType, "scope_proposal"),
      ),
    )
    .orderBy(desc(discussionEntries.seq))
    .limit(1);
  return rows[0] ?? null;
}

async function defaultAddEntry(
  db: Db,
  companyId: string,
  threadId: string,
  data: {
    inputType: string;
    rawContent: string;
    authorAgentId: string | null;
    sourceInfo: Record<string, unknown> | null;
  },
  actorId: string,
): Promise<unknown> {
  const { discussionService } = await import("../../discussions.js");
  return discussionService(db).addEntry(companyId, threadId, data, actorId);
}

async function defaultUpdateSummary(
  db: Db,
  companyId: string,
  threadId: string,
  summary: { text: string; next: string | null },
  actor: { userId: string; role: "founder" | "team_lead" | "team_member"; isHuman: boolean },
): Promise<unknown> {
  const { threadService } = await import("../../threads.js");
  return threadService(db).updateSummary(companyId, threadId, summary, actor);
}

async function defaultProposeWork(
  db: Db,
  args: {
    threadId: string;
    companyId: string;
    autonomy: number | null;
    summary: string;
    proposedTasks: Array<{ title: string; assigneeRole?: string }>;
    createdBy: { agentId: string };
  },
): Promise<unknown> {
  const { crewTaskService } = await import("../../crew-task-service.js");
  return crewTaskService(db).proposeWork(args);
}

export async function maybeExecuteFakeCrewTurn(args: {
  db: Db;
  agent: FakeCrewAgent;
  payload: FakeCrewPayload;
  env?: NodeJS.ProcessEnv;
  deps?: FakeCrewDeps;
}): Promise<AdapterExecutionResult | null> {
  const { db, agent, payload, deps } = args;
  if (!isFakeCrewLlmEnabled(args.env)) return null;
  if (typeof payload.threadId !== "string" || !payload.threadId) return null;

  const threadId = payload.threadId;
  const latest =
    (await (deps?.loadLatestHumanEntry ?? ((id: string) => defaultLoadLatestHumanEntry(db, id)))(threadId)) ??
    null;

  if (agent.name === "Adjutant" && latest && wantsScope(latest.rawContent)) {
    await (deps?.proposeWork ?? ((input) => defaultProposeWork(db, input)))({
      threadId,
      companyId: payload.companyId,
      autonomy: typeof payload.effectiveAutonomy === "number" ? payload.effectiveAutonomy : null,
      summary: `E2E fake scope from thread discussion: ${latest.rawContent.slice(0, 180)}`,
      proposedTasks: [
        { title: "Clarify the accepted scope handoff", assigneeRole: "planner" },
        { title: "Implement the scoped thread cycle", assigneeRole: "engineer" },
      ],
      createdBy: { agentId: agent.id },
    });
    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      resultJson: { fakeCrewLlm: true, action: "propose_work" },
    };
  }

  if (agent.name === "Chronicler") {
    await (deps?.updateSummary ?? ((companyId, id, summary, actor) => defaultUpdateSummary(db, companyId, id, summary, actor)))(
      payload.companyId,
      threadId,
      buildFakeSummary(latest),
      { userId: agent.id, role: "team_member", isHuman: false },
    );
    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      resultJson: { fakeCrewLlm: true, action: "update_summary" },
    };
  }

  await (deps?.addEntry ?? ((companyId, id, data, actorId) => defaultAddEntry(db, companyId, id, data, actorId)))(
    payload.companyId,
    threadId,
    {
      inputType: "agent",
      rawContent: buildFakeReply(agent, latest),
      authorAgentId: agent.id,
      sourceInfo: { e2eFakeCrewLlm: true },
    },
    agent.id,
  );

  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    resultJson: { fakeCrewLlm: true, action: "post_entry" },
  };
}
