import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  agentRuntimeDecisionService,
  RuntimeDecisionCancelledError,
} from "../../services/agent-runtime-decisions.js";
import { type ToolContext, type ToolHandler, type ToolResult, err, ok } from "./types.js";

/**
 * Bounded synchronous block for a founder answer. The hub row keeps its own 24h
 * TTL (WORK_QUESTION_DEFAULT_TTL_MS in agent-runtime-decisions.ts) reconciled by
 * the expiry sweep; THIS constant bounds only how long the tool call blocks the
 * agent's run before returning a graceful "parked". Parallels the permission-side
 * RUNTIME_HOOK_BLOCK_TIMEOUT_SEC (adapter-utils) but is its own value.
 */
const WORK_QUESTION_BLOCK_TIMEOUT_MS = 5 * 60 * 1000;

/** Cap the decision title so a long question does not blow the hub-item chrome. */
const TITLE_CAP = 120;

const askFounderSchema = z
  .object({
    question: z.string().trim().min(1),
    options: z
      .array(z.object({ label: z.string().min(1), value: z.string().min(1) }))
      .refine((opts) => new Set(opts.map((o) => o.value)).size === opts.length, {
        message: "option values must be unique",
      })
      .optional(),
    context: z.string().optional(),
  })
  .strict();

function capped(text: string): string {
  return text.length <= TITLE_CAP ? text : `${text.slice(0, TITLE_CAP - 1)}…`;
}

/**
 * ask_founder — an org/heartbeat task-execution agent asks the founder a
 * question and blocks (bounded) for the answer. Surfaces via the existing
 * runtime-decision machinery (kind:"work_question"), answered in the Inbox hub's
 * RuntimeDecisionPanel. Guard (locked decision): agent actor WITH an active
 * heartbeat run only; crew/internal-agent are out of scope. When the run goes
 * terminal, heartbeat's cancelActiveForRun cancels this open decision so the next
 * waitForAnswer poll (~1s) throws → we return "parked" (no 5-min wedge).
 */
export async function handleAskFounder(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  if (ctx.actor.source !== "agent" || !ctx.actor.agentId || !ctx.actor.runId) {
    return err(403, -32003, "ask_founder requires an active run");
  }
  const parsed = askFounderSchema.parse(args);

  const agent = await ctx.services.agentsSvc.getById(ctx.actor.agentId);
  if (!agent) {
    return err(404, -32004, "Agent not found");
  }

  const svc = agentRuntimeDecisionService(ctx.db);
  // createPrompt 409s on a terminal/missing run (zombie guard) — let it propagate.
  const { decision } = await svc.createPrompt({
    companyId: ctx.companyId,
    agentId: ctx.actor.agentId,
    runId: ctx.actor.runId,
    adapterType: agent.adapterType,
    kind: "work_question",
    nonce: randomUUID(),
    title: capped(parsed.question),
    promptText: parsed.question,
    summary: parsed.context ?? null,
    options: parsed.options ?? null,
    timeoutPolicy: "park_run",
  });

  try {
    const answered = await svc.waitForAnswer({
      companyId: ctx.companyId,
      decisionId: decision.id,
      timeoutMs: WORK_QUESTION_BLOCK_TIMEOUT_MS,
    });
    return ok({ answered: true, answer: answered.answerPayload });
  } catch (e) {
    // Every terminal NON-answer outcome parks gracefully so the model STOPS
    // (never retry-loops): a cancel (RuntimeDecisionCancelledError — e.g. the run
    // went terminal and cancelActiveForRun cancelled this decision), the bounded
    // block timing out ("Timed out…"), OR the decision reaching a terminal
    // non-answered status while we polled ("… no longer actionable" — a benign
    // relayed/expired race). "park_run" means there is no safe default answer, so
    // any of these is a "no answer, stop here" — not a hard error. Any OTHER error
    // (e.g. notFound, a DB fault) is a real failure — rethrow.
    const parked = ok({ answered: false, status: "parked", note: "parked for founder" });
    if (e instanceof RuntimeDecisionCancelledError) return parked;
    if (e instanceof Error && /timed out|no longer actionable/i.test(e.message)) return parked;
    throw e;
  }
}

export const askFounderToolHandlers: Record<string, ToolHandler> = {
  ask_founder: handleAskFounder,
};
