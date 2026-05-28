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
  adjutant:       "call `advance_phase` if the thread is ready to move forward, OR `notify_owner` if it needs the human first",
  router:         "call `post_entry` exactly once as a system-notice with your department recommendation",
  navigator:      "decide whether to `attach_to_thread` (promote to an existing thread), `spin_off_thread` (orphan material into a new thread), or post a routing recommendation via `post_entry`",
  planner:        "call `create_artifact` (or `create_artifact_version` for an iteration) with the plan markdown as the document body, then `post_entry` exactly once as a system-notice linking the new artifact so the Dispatcher can pick it up",
  dispatcher:     "call `create_task` (one per scope item), then `assign_task` + `add_task_dependency` as needed",
  memory_keeper:  "call `suggest_memory` for each candidate pattern (propose-only — the founder approves)",
  commander:      "call `post_entry` exactly once with your synthesis or answer",
};

const GENERIC_DIRECTIVE =
  "use the tools in your allowlist appropriate to this trigger, then return";

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

  const directive = ROLE_ACTION_DIRECTIVE[agentRoleKey.toLowerCase()] ?? GENERIC_DIRECTIVE;

  return [
    instruction,
    "",
    "## This wakeup",
    ctxLines.join("\n"),
    "",
    `You are ${agentName}. ${directive}. Return when done. Returning without taking the directed action is a bug — if you cannot take it for any reason (missing data, ambiguity), use whatever tool in your allowlist surfaces feedback to the human (a thread post, a notification, or your own report) rather than returning silently.`,
  ].join("\n");
}
