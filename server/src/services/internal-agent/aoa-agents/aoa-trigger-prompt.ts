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
  engineer:       "call `create_artifact` (or `create_artifact_version` for an iteration), then `post_entry` exactly once with parentEntryId set to the inviting entry linking the new artifact",
  scout:          "investigate the thread context via your internal-only retrieval tools, then `post_entry` exactly once with a synthesis of what you found (link related threads via `thread.createLink` if a precedent applies)",
  adjutant:       "If the conversation has converged on work to do, call `propose_crew_work` with the proposed tasks. You may still call `advance_phase` for phase transitions. If the thread is not ready or you have nothing to add, return without posting — silence is correct.",
  router:         "decide whether to `attach_to_thread` (promote to an existing thread) or `spin_off_thread` (create a new thread for orphaned material); if nothing fits, take no action and let the founder triage via the Inbox",
  navigator:      "decide whether to `attach_to_thread` (promote to an existing thread) or `spin_off_thread` (create a new thread for orphaned material); if nothing fits, take no action and let the founder triage via the Inbox",
  planner:        "call `create_artifact` (or `create_artifact_version` for an iteration) with the plan markdown as the document body, then `post_entry` exactly once as a system-notice linking the new artifact",
  dispatcher:     "call `create_task` (one per scope item), then `assign_task` + `add_task_dependency` as needed",
  memory_keeper:  "call `suggest_memory` for each candidate pattern (propose-only — the founder approves)",
  commander:      "call `post_entry` exactly once with your synthesis or answer",
};

const GENERIC_DIRECTIVE =
  "use the tools in your allowlist appropriate to this trigger, then return";

// Dedicated directive for inbox.routing_ambiguous wakeups (Task 1.7).
// The Navigator receives an inboxItemId + candidate threads + distances so it
// can make a concrete routing decision rather than relying on generic guidance.
const INBOX_ROUTING_DIRECTIVE =
  "An inbound item needs routing. Review the candidate threads below. Decide: if one is a clear home, call `attach_to_thread` to attach this inbox item's content as a new entry there; if the material deserves its own thread, call `spin_off_thread`; if nothing fits, take no action — the item stays in the Inbox for the founder to triage. The routing dial decides whether your decision auto-acts or is surfaced to the founder as a suggestion — act on your best judgment either way.";

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
}

/**
 * Build the user-prompt string passed to the LLM via config.promptTemplate.
 * Pure function — no side effects, exhaustively unit-tested.
 */
export function buildTriggerPrompt(args: BuildTriggerPromptArgs): string {
  const { instruction, payload, agentName, agentRoleKey } = args;

  // Trigger context block. Filter out empty fields so the LLM doesn't see
  // "Inviting entry: undefined" lines (which would confuse it).
  const ctxLines = [
    `Trigger source: ${payload.source}`,
    payload.threadId ? `Thread: ${payload.threadId}` : null,
    payload.entryId ? `Inviting entry: ${payload.entryId}` : null,
    typeof payload.mention === "string" ? `Mention: ${payload.mention}` : null,
    typeof payload.role === "string" ? `Routed role: ${payload.role}` : null,
  ].filter((line): line is string => line !== null);

  // Task 1.7 — inbox-routing wakeup branch.
  // When the Navigator is woken for inbox routing, append the inbox item +
  // candidate threads + ambiguity gap so it has concrete material to act on.
  // All field reads are defensive (unknown payload fields); a malformed payload
  // never throws — it simply omits the field that wasn't valid.
  let directive: string;
  if (payload.source === "inbox.routing_ambiguous") {
    directive = INBOX_ROUTING_DIRECTIVE;

    // Inbox item ID (non-empty string guard)
    const inboxItemId = payload.inboxItemId;
    if (typeof inboxItemId === "string" && inboxItemId.length > 0) {
      ctxLines.push(`Inbox item: ${inboxItemId}`);
    }

    // Candidate threads (non-empty array guard). Zip with distances by index.
    const candidates = payload.candidateThreadIds;
    const distances = payload.distances;
    if (Array.isArray(candidates) && candidates.length > 0) {
      const parts = candidates.map((id, i) => {
        const d = Array.isArray(distances) ? distances[i] : undefined;
        const dist = typeof d === "number" && Number.isFinite(d)
          ? `${(d as number).toFixed(3)}`
          : null;
        return dist !== null ? `${id} (${dist})` : `${id}`;
      });
      ctxLines.push(`Candidate threads: ${parts.join(", ")}`);
    }

    // Ambiguity gap (finite number guard)
    const gap = payload.gap;
    if (typeof gap === "number" && Number.isFinite(gap)) {
      ctxLines.push(`Ambiguity gap: ${(gap as number).toFixed(3)}`);
    }
  } else {
    directive = ROLE_ACTION_DIRECTIVE[agentRoleKey.toLowerCase()] ?? GENERIC_DIRECTIVE;
  }

  return [
    instruction,
    "",
    "## This wakeup",
    ctxLines.join("\n"),
    "",
    `You are ${agentName}. ${directive}. Return when done. If you cannot act for any reason (missing data, ambiguity), use whatever tool in your allowlist surfaces feedback to the human (a thread post, a notification, or your own report) rather than returning silently. Silence is acceptable when there is genuinely nothing to do.`,
  ].join("\n");
}
