#!/usr/bin/env node
// Deterministic fake `claude` CLI for the Commander viewer e2e
// (tests/e2e/commander-viewer.spec.ts).
//
// Commander's cli-mode (server/src/services/internal-agent/cli-mode.ts)
// resolves the literal binary name "claude" from PATH (`which`/`where`) and
// spawns it with `--print --output-format stream-json …` — one process per
// chat turn (the process exits after the turn; the session-store entry is
// reaped by the exit handler, so the next message spawns a fresh process).
// The e2e playwright config prepends this fixture directory to the
// webServer's PATH so the spawn resolves to the `claude` / `claude.cmd`
// shims next to this file.
//
// Behavior: read a scripted turn from the control file (path from
// AOA_E2E_FAKE_CLAUDE_CONTROL, falling back to the deterministic tmpdir path
// the spec helper uses), emit it as newline-delimited stream-json that
// parse-stream-json.ts actually accepts, then exit 0. All argv is ignored —
// the script is fully controlled by the control file, which the spec
// rewrites before each send.
//
// Event shapes (mirrors parse-stream-json.ts exactly):
//   tool_use     {"type":"assistant","message":{"content":[{"type":"tool_use","id","name","input"}]}}
//   tool_result  {"type":"user","message":{"content":[{"type":"tool_result","tool_use_id","content":"<envelope JSON string>","is_error"}]}}
//                — content mirrors mcp-bridge executeAndFormat: a stringified
//                  {success,data,summary,error?,outputRefs?} envelope. Refs are
//                  lifted ONLY when the tool name starts with "mcp__".
//   text         {"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text"}}}
//                — assistant-event text blocks are SKIPPED by the parser
//                  (text streams via stream_event deltas), so the final
//                  assistant message below is realism-only.
//   done         {"type":"result","subtype":"success",...}
//
// Control file shape (single turn — one process == one turn):
//   {
//     "toolCalls": [
//       { "name": "mcp__aoa__create_artifact", "input": {...},
//         "envelope": { "success": true, "data": {...}, "summary": "...", "outputRefs": [...] },
//         "isError": false }
//     ],
//     "text": "final assistant reply (markdown)"
//   }

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CONTROL_PATH =
  process.env.AOA_E2E_FAKE_CLAUDE_CONTROL ||
  path.join(os.tmpdir(), "aoa-e2e-fake-claude-control.json");

// If the parent closes our stdout mid-turn (Stop button kills the CLI
// session, or the server shuts down), exit quietly instead of crashing with
// an unhandled EPIPE 'error' event.
process.stdout.on("error", (err) => {
  if (err && err.code === "EPIPE") process.exit(0);
  process.stderr.write(`fake-claude stdout error: ${err?.stack ?? err}\n`);
  process.exit(1);
});

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readControl() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CONTROL_PATH, "utf8"));
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // missing/corrupt control file — fall through to the inert default so an
    // unexpected spawn (e.g. a background Commander run) never crashes.
  }
  return { toolCalls: [], text: "Fake claude: no control file found." };
}

async function main() {
  const control = readControl();
  const toolCalls = Array.isArray(control.toolCalls) ? control.toolCalls : [];
  const text =
    typeof control.text === "string" && control.text.length > 0
      ? control.text
      : "Done.";

  emit({
    type: "system",
    subtype: "init",
    session_id: "fake-claude-session",
    model: "fake-claude",
    cwd: process.cwd(),
    tools: [],
  });

  let i = 0;
  for (const tc of toolCalls) {
    i += 1;
    const id = `toolu_fake_${i}`;
    const name = typeof tc.name === "string" ? tc.name : "mcp__aoa__unknown";

    emit({
      type: "assistant",
      message: {
        id: `msg_fake_${i}`,
        type: "message",
        role: "assistant",
        model: "fake-claude",
        content: [{ type: "tool_use", id, name, input: tc.input ?? {} }],
      },
    });
    await sleep(15);

    const envelope = tc.envelope ?? { success: true, data: null, summary: "ok" };
    emit({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: id,
            content:
              typeof envelope === "string" ? envelope : JSON.stringify(envelope),
            is_error: tc.isError === true,
          },
        ],
      },
    });
    await sleep(15);
  }

  // Optional: hold the stream open after the tool_result(s) and before the
  // reply text. Tool-call indicators live only in local streaming state (the
  // assistant message persists content + outputRefs, never toolCalls), so they
  // vanish on the post-turn server sync. The spinner fix (tool_result settles
  // running→done BEFORE the turn's `done`) is therefore a during-stream
  // behavior; holdMs gives a test a window to observe the settled indicator.
  if (typeof control.holdMs === "number" && control.holdMs > 0) {
    await sleep(control.holdMs);
  }

  // Stream the reply word-by-word via content_block_delta/text_delta — the
  // exact shape handleStreamEvent() consumes.
  const words = text.match(/\S+\s*/g) ?? [text];
  for (const word of words) {
    emit({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: word },
      },
    });
    await sleep(5);
  }

  // Full-text assistant event — parse-stream-json.ts skips text blocks in
  // assistant events (text already streamed above); kept for shape realism.
  emit({
    type: "assistant",
    message: {
      id: "msg_fake_final",
      type: "message",
      role: "assistant",
      model: "fake-claude",
      content: [{ type: "text", text }],
    },
  });

  emit({
    type: "result",
    subtype: "success",
    is_error: false,
    duration_ms: 60,
    duration_api_ms: 50,
    num_turns: 1,
    result: text,
    session_id: "fake-claude-session",
    total_cost_usd: 0,
    usage: { input_tokens: 1, output_tokens: 1 },
  });
}

main().then(
  () => process.exit(0),
  (err) => {
    process.stderr.write(`fake-claude failed: ${err?.stack ?? err}\n`);
    process.exit(1);
  },
);
