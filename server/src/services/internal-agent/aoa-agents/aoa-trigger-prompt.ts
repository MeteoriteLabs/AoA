// T1.2 — role-aware trigger prompt rendering. Pure exported function;
// exhaustively unit-tested in aoa-trigger-prompt.test.ts.
//
// Why this exists (codex F1):
//   Before T1.2, the LLM received a 14-word generic placeholder via the
//   adapter's default promptTemplate ("You are agent <uuid> (<Name>).
//   Continue your AoA work.") — no mention of the trigger source, thread,
//   inviting entry, or what the agent was actually woken to DO. The LLM
//   read the system-prompt bundle (SOUL/TOOLS/AGENTS/HEARTBEAT) which
//   describes HOW it works in general, then exited without calling any
//   tool because the user prompt gave it nothing concrete to act on.
//
// What this returns:
//   A concrete trigger prompt assembled from:
//     1. The agent's full assembled instruction bundle (SOUL+TOOLS+AGENTS
//        +HEARTBEAT, resolved before this call in runner.ts)
//     2. The trigger context (source, thread, inviting entry, mention,
//        routed role) so the LLM knows what's happening
//     3. A role-specific action directive (Scribe→submit_extracted_items,
//        Maker→post_entry, Adjutant→advance_phase, etc.) — this is the
//        forcing function that makes the LLM actually call a tool
//
// Why role-aware (eng-review D2):
//   A naive prompt with "post_entry exactly one reply" would BREAK Scribe
//   (Scribe uses submit_extracted_items, not post_entry). Each crew role
//   has its own primary action; the prompt directive must match.
//
// Why agentRoleKey (codex F7):
//   The role lookup keys off the seed role identifier (commander, adjutant,
//   maker, scribe, memory_keeper, router, planner, dispatcher) — NOT
//   agent.name. Marketplace install (team-installer.ts:225-229) can rename
//   agents on conflict, so display name is fragile.

import type { AoaTriggerPayload } from "./runner.js";

// Map crew role key → expected primary action. The "what tool MUST be
// called" directive. Lowercase keys; lookup is case-insensitive.
//
// Adding a new crew role: add an entry here + provide a SOUL/TOOLS/AGENTS/
// HEARTBEAT bundle in onboarding-assets/<role>/ + register in ensure-*.ts.
const ROLE_ACTION_DIRECTIVE: Record<string, string> = {
  scribe:         "call `submit_extracted_items` exactly once with the extracted items from this entry",
  maker:          "call `post_entry` exactly once with parentEntryId set to the inviting entry, attaching your artifact",
  engineer:       "If you were brought into a thread to weigh in (a discussion, no task assigned to you), `post_entry` exactly once with your engineering perspective — feasibility, approach, risks — building on what others said, parentEntryId set to the inviting entry. Only when there is a concrete deliverable to produce, call `create_artifact` (or `create_artifact_version` for an iteration) first, then `post_entry` linking it.",
  scout:          "investigate the thread context via your internal-only retrieval tools, then `post_entry` exactly once with a synthesis of what you found (link related threads via `thread.createLink` if a precedent applies)",
  reviewer:       "Critique the artifact, plan, or perspective under discussion in this thread: name its strengths, the concrete gaps and risks, and specific fixes. Then call `post_entry` exactly once with your review, parentEntryId set to the inviting entry, as a normal conversational reply (do NOT set `sourceInfo.systemNotice`). You ADVISE only — do NOT approve, create tasks, change task status, or mutate any artifact; the founder is the final approver.",
  adjutant:       "Read the recent conversation, focusing on the founder's MOST RECENT message. A follow-up question after an earlier answer is STILL unanswered — never treat the thread as handled just because an agent replied earlier in it. If the founder's latest message asks a question, raises a problem, or invites the team's input and it has not yet been answered by a later reply, you MUST respond: call `post_entry` exactly once with a brief, helpful reply — answer it yourself from the thread context when you can. When the founder wants the team's input, or the topic needs more than one perspective, CONVENE the relevant crew to weigh in HERE in the thread via `agent.dispatch` (Scout to research, Engineer to draft, Planner to structure, Navigator for cross-thread) and synthesize what comes back — bring them in together for independent takes, or run a short moderated sequence where each builds on the last. An unanswered founder message is not 'nothing to do'. Post replies as a normal conversational reply — do NOT set `sourceInfo.systemNotice` (that renders as a muted system divider, not chat). Do NOT jump to scoping: collaborating in the thread needs no approval, but turning the discussion into tracked tasks is the founder's decision, not your reflex. When the conversation has converged on concrete, trackable work, SUGGEST it ('want me to turn this into tracked tasks?') and call `propose_crew_work` ONLY when the founder explicitly asks. To turn an approved scope into tasks: at Drive you may `advance_phase` to assign and the system auto-approves; at Manual or Assist do NOT advance the phase — the founder approves the inline scope card, so point them to its Approve control and never claim you advanced the phase yourself. Only when the founder's latest message needs no reply (a simple acknowledgement, or you already answered it) — return without posting; silence is correct then.",
  router:         "decide whether to `attach_to_thread` (promote to an existing thread) or `spin_off_thread` (create a new thread for orphaned material); if nothing fits, take no action and let the founder triage via the Inbox",
  navigator:      "decide whether to `attach_to_thread` (promote to an existing thread) or `spin_off_thread` (create a new thread for orphaned material); if nothing fits, take no action and let the founder triage via the Inbox",
  planner:        "If you were brought into a thread to weigh in (a discussion, no task assigned to you), `post_entry` exactly once with your planning perspective — how you would structure the work, sequencing, milestones, dependencies — building on what others said. Post it as a normal conversational reply; do NOT use a system-notice (that renders as a muted divider, not chat). Only when there is a concrete plan to formalize, call `create_artifact` with the plan markdown first, then `post_entry` linking it.",
  dispatcher:     "call `create_task` (one per scope item), then `assign_task` + `add_task_dependency` as needed",
  memory_keeper:  "call `suggest_memory` for each candidate pattern (propose-only — the founder approves)",
  chronicler:     "call `get_thread_summary` then `thread.listEntries` for the thread in this wakeup, then call `thread.updateSummary` exactly once with an updated factual summary + routingTerms. Never post_entry.",
  commander:      "call `post_entry` exactly once with your synthesis or answer",
  librarian:      "read the braindump content below and call `write_memory` once per distinct, durable fact worth keeping — always with layer=\"domain\" and the departmentId given below. Do not invent facts that are not in the braindump. If there is nothing worth keeping, call no tool and return.",
};

const GENERIC_DIRECTIVE =
  "use the tools in your allowlist appropriate to this trigger, then return";

const TOOL_VISIBILITY_DIRECTIVE =
  "When a directive names an AoA tool like `foo`, call the MCP tool named `mcp__aoa__foo`. " +
  "Final text/stdout is internal and is not shown in the thread; any visible reply, update, artifact, task, or memory proposal must be made through the appropriate MCP tool.";

// Spec B Task 5 — task-execution directive. Fires when the dispatcher wakes a
// crew agent with a `payload.issueId` (a TASK assignment, not a thread). Steers
// the agent to the task tool surface and explicitly away from thread/post_entry
// tooling. The set_task_status call is dial-gated server-side (A4 guard), so the
// directive only asks the agent to "move the task forward" — the system decides
// how far it may take it.
const TASK_EXECUTION_DIRECTIVE =
  "You have been assigned a task. Call `get_task` with the task id below to read its full context. " +
  "Do the work the task describes. Post your result with `post_task_comment`, and if you produced a deliverable, attach it with `attach_task_artifact`. " +
  "When the work is complete, call `set_task_status` to move the task forward (the system enforces how far you may take it based on the autonomy dial). " +
  "Do NOT call post_entry / thread tools — this is a task, not a thread.";

// Dedicated directive for inbox.routing_ambiguous wakeups (Task 1.7).
// The Navigator receives an inboxItemId + the inbound content so it can make a
// concrete routing decision rather than relying on generic guidance. It fetches
// the current routing cards at runtime via list_thread_cards (Codex P1 #1) and
// MUST finalize via one of attach/promote/defer (Codex P1 #2).
const INBOX_ROUTING_DIRECTIVE =
  "An inbound item needs routing. Its content is shown below under 'Inbound content'. " +
  "Call list_thread_cards to fetch the current routing cards for active threads. " +
  "Then decide and ACT (do not return silently): " +
  "(a) if one thread is the clear home for this content, call attach_to_thread; " +
  "(b) if the content deserves its own new thread, call promote_inbox_to_thread (with a proposed title); " +
  "(c) if you are unsure or nothing fits, call defer_inbox_to_human — this leaves it in the Inbox for the founder. " +
  "You MUST call exactly one of these three tools. The routing dial decides whether (a)/(b) auto-act or surface as a suggestion — act on your best judgment either way. " +
  "Do NOT call spin_off_thread for inbox items — use promote_inbox_to_thread instead.";

// WS6 — dedicated directive for braindump.ingest wakeups. The Librarian
// receives the raw braindump text + departmentId directly in the prompt (it
// has no thread/entry to read from — this is a standalone, server-dispatched
// wakeup, never a mention/sweep). Mirrors the inbox-routing content-injection
// pattern above.
const BRAINDUMP_INGEST_DIRECTIVE =
  "A braindump has been submitted for the department named below. Its content is shown under " +
  "'Braindump content'. Identify distinct, durable pieces of knowledge worth keeping — facts, " +
  "conventions, glossary terms, standing preferences, domain context — and call write_memory " +
  "once per item with layer=\"domain\" and departmentId set to the department id given below. " +
  "Do not invent facts that are not in the braindump content. If there is nothing worth keeping, " +
  "call no tool and return — that is a correct, non-failing outcome.";

/** WS6 payload cap: braindump text injected into the trigger prompt is
 *  truncated beyond this length so a single wakeup can't blow the context
 *  budget. The braindump capture route enforces its own (larger) storage
 *  cap; this is the prompt-injection cap specifically. */
export const BRAINDUMP_CONTENT_PROMPT_CAP = 12000;

export interface BuildTriggerPromptArgs {
  /** Full assembled instruction bundle (SOUL+TOOLS+AGENTS+HEARTBEAT)
   *  resolved upstream in runner.ts. Becomes the top of the prompt so the
   *  LLM has context on the agent's persona + tools + protocol. */
  instruction: string;
  /** Trigger payload from the wakeup row — source, threadId, entryId, mention.
   *  Note: dispatcher.ts must pass the ORIGINAL wakeup.source through here
   *  (codex F6 — today it hardcodes "wakeup"; T1.2 dispatcher edit fixes that). */
  payload: AoaTriggerPayload;
  /** Display name from agents.name. Used in the "You are <Name>" prefix only.
   *  Not used for action directive lookup (see agentRoleKey). */
  agentName: string;
  /** Stable role key from runtimeConfig.aoa.role or seed role identifier.
   *  Used to look up the action directive. Case-insensitive. Fragile-by-name
   *  fallback is documented at codex F7. */
  agentRoleKey: string;
  /** Phase 4 (Task 4.3) — pre-assembled crew context bundle (thread history +
   *  Chronicler summary + relevant memory, and for tasks the task body +
   *  upstream artifact). Built best-effort by the runner via
   *  buildCrewContextBundle. Rendered as a `## Context` section between the
   *  persona/instruction and the `## This wakeup` block — ONLY when non-empty.
   *  Empty/whitespace/undefined ⇒ no Context section (back-compat: callers that
   *  don't pass it get the byte-identical pre-Phase-4 prompt). */
  contextBundle?: string;
}

/**
 * Build the user-prompt string passed to the LLM via config.promptTemplate.
 * Pure function — no side effects, exhaustively unit-tested.
 */
export function buildTriggerPrompt(args: BuildTriggerPromptArgs): string {
  const { instruction, payload, agentName, agentRoleKey, contextBundle } = args;
  const directiveRoleKey =
    typeof payload.role === "string" && payload.role.trim().length > 0
      ? payload.role.trim()
      : agentRoleKey;

  // Trigger context block. Filter out empty fields so the LLM doesn't see
  // "Inviting entry: undefined" lines (which would confuse it).
  const ctxLines = [
    `Trigger source: ${payload.source}`,
    payload.threadId ? `Thread: ${payload.threadId}` : null,
    payload.entryId ? `Inviting entry: ${payload.entryId}` : null,
    typeof payload.mention === "string" ? `Mention: ${payload.mention}` : null,
    typeof payload.role === "string" ? `Routed role: ${payload.role}` : null,
  ].filter((line): line is string => line !== null);

  // Task 1.7 / routing-card redesign — inbox-routing wakeup branch.
  // When the Navigator is woken for inbox routing, append the inbox item + the
  // raw inbound content so it has concrete material to act on. The candidate
  // routing cards are fetched by the Navigator at runtime via list_thread_cards
  // (not frozen in the payload). All field reads are defensive (unknown payload
  // fields); a malformed payload never throws — it simply omits the field that
  // wasn't valid.
  let directive: string;
  if (payload.source === "inbox.routing_ambiguous") {
    directive = INBOX_ROUTING_DIRECTIVE;

    const inboxItemId = payload.inboxItemId;
    if (typeof inboxItemId === "string" && inboxItemId.length > 0) {
      ctxLines.push(`Inbox item: ${inboxItemId}`);
    }

    // Inbound content (Codex P1 #1 — the Navigator decides over the actual text).
    const inboundContent = payload.inboundContent;
    if (typeof inboundContent === "string" && inboundContent.length > 0) {
      // Cap very long inbound text so the prompt stays bounded.
      const clipped = inboundContent.length > 4000
        ? `${inboundContent.slice(0, 4000)}…[truncated]`
        : inboundContent;
      ctxLines.push(`Inbound content:\n${clipped}`);
    }
  } else if (payload.source === "braindump.ingest") {
    // WS6 — direct server dispatch, no thread/entry/task involved.
    directive = BRAINDUMP_INGEST_DIRECTIVE;

    const departmentId = payload.departmentId;
    if (typeof departmentId === "string" && departmentId.length > 0) {
      ctxLines.push(`Department id: ${departmentId}`);
    }
    const departmentName = payload.departmentName;
    if (typeof departmentName === "string" && departmentName.length > 0) {
      ctxLines.push(`Department name: ${departmentName}`);
    }

    const braindumpContent = payload.braindumpContent;
    if (typeof braindumpContent === "string" && braindumpContent.length > 0) {
      const clipped = braindumpContent.length > BRAINDUMP_CONTENT_PROMPT_CAP
        ? `${braindumpContent.slice(0, BRAINDUMP_CONTENT_PROMPT_CAP)}…[truncated]`
        : braindumpContent;
      ctxLines.push(`Braindump content:\n${clipped}`);
    }
  } else if (typeof payload.issueId === "string" && payload.issueId.length > 0) {
    // Spec B Task 5 — a task assignment wakeup. The task directive overrides the
    // role-map directive (a Maker assigned a task must execute it, not post_entry).
    // Inbox routing still takes precedence (handled above).
    directive = TASK_EXECUTION_DIRECTIVE;
    ctxLines.push(`Task: ${payload.issueId}`);
  } else {
    directive = ROLE_ACTION_DIRECTIVE[directiveRoleKey.toLowerCase()] ?? GENERIC_DIRECTIVE;
  }

  // Phase 4 (Task 4.3): the crew context bundle. Rendered as a `## Context`
  // section BETWEEN the persona/instruction and the `## This wakeup` block so
  // the agent reads WHO/WHAT it's dealing with (the conversation, the summary,
  // relevant memory, the task body) before the action directive. Omitted
  // entirely when empty/whitespace — keeps the prompt byte-identical to the
  // pre-Phase-4 form for callers that don't supply a bundle (and for runs where
  // the bundle came back empty, e.g. a brand-new thread with no precedent).
  const contextSection =
    typeof contextBundle === "string" && contextBundle.trim().length > 0
      ? ["## Context", contextBundle.trim(), ""]
      : [];

  return [
    instruction,
    "",
    ...contextSection,
    "## This wakeup",
    ctxLines.join("\n"),
    "",
    TOOL_VISIBILITY_DIRECTIVE,
    "",
    `You are ${agentName}. ${directive}. Return when done. If you cannot act for any reason (missing data, ambiguity), use whatever tool in your allowlist surfaces feedback to the human rather than returning silently. Silence is acceptable when there is genuinely nothing to do.`,
  ].join("\n");
}
