import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Shared contract between the playwright config (which exports the control
 * path to the webServer env as AOA_E2E_FAKE_CLAUDE_CONTROL) and the specs
 * (which rewrite the control file before each Commander send).
 *
 * The fake CLI (tests/e2e/fixtures/fake-claude/fake-claude.mjs) reads this
 * file fresh on every spawn. Commander's claude_cli path is one process per
 * chat turn (`--print` exits after the turn and the session entry is reaped
 * on exit), so "write control file, then send" fully scripts the next reply.
 *
 * Deterministic tmpdir path — identical computation in the runner process
 * (specs), the config process, and the fake CLI's fallback, so no plumbing
 * beyond the env var is needed.
 */
export const FAKE_CLAUDE_CONTROL_PATH = path.join(
  os.tmpdir(),
  "aoa-e2e-fake-claude-control.json",
);

/**
 * Invocation record: the fake-claude shim appends one JSON line per spawn
 * describing HOW Commander actually invoked claude, so specs can PROVE the
 * real cli-mode contract (argv flags, prompt-over-stdin, cwd) rather than
 * trusting the shim's own defaulting. Mirrors fake-codex.ts FAKE_CODEX_INVOCATIONS_PATH.
 */
export const FAKE_CLAUDE_INVOCATIONS_PATH = path.join(
  os.tmpdir(),
  "aoa-e2e-fake-claude-invocations.jsonl",
);

export interface FakeClaudeInvocation {
  argv: string[];
  stdin: string;
  cwd: string;
  /**
   * An ALLOWLISTED slice of the shim's OWN inherited environment (CLAUDE_* /
   * ANTHROPIC_* plus PATH/HOME/USERPROFILE/AOA_AGENT_ID — never the whole env,
   * which would write the developer's shell and the per-run AOA_API_KEY in the
   * clear). Additive (existing specs destructure only argv/stdin/cwd): it is
   * the only way to prove what a spawn actually received, which a unit test of
   * the env builder cannot show. Used by crew-config-isolation.spec.ts to
   * assert the D9 ambient-config strip is wired, not merely correct.
   *
   * Optional: the JSONL persists across branches, so lines recorded before this
   * field existed are still readable.
   */
  env?: Record<string, string>;
}

/**
 * POISONED ambient Claude config, exported to the webServer env by
 * playwright.config.ts and asserted by crew-config-isolation.spec.ts.
 *
 * These are the operator-machine leaks D9 exists to stop: a host `~/.claude`
 * (SessionStart hooks, third-party skills, plugins) and the server's own
 * Anthropic key. They are set on the SERVER process — the spec's whole point is
 * that a crew spawn must not inherit them, and only a real ambient value can
 * prove that. Values are obviously-fake; the fake CLI ignores all of them.
 *
 * `CLAUDE_CODE_E2E_OPERATOR_KNOB` is deliberately not enumerated in any strip
 * list — it proves the CLAUDE_ PREFIX class, not a known-key denylist.
 */
export const AMBIENT_CLAUDE_CONFIG_POISON = {
  ANTHROPIC_API_KEY: "sk-ant-e2e-ambient-operator-key",
  CLAUDE_CONFIG_DIR: path.join(os.tmpdir(), "aoa-e2e-ambient-claude-config"),
  CLAUDE_CODE_E2E_OPERATOR_KNOB: "operator-hooks-and-plugins",
} as const;

/** Read all recorded invocations (oldest first). Empty if none yet. */
export function readFakeClaudeInvocations(): FakeClaudeInvocation[] {
  try {
    return fs
      .readFileSync(FAKE_CLAUDE_INVOCATIONS_PATH, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as FakeClaudeInvocation);
  } catch {
    return [];
  }
}

/** Clear the invocation log — call before a send to scope assertions to it. */
export function clearFakeClaudeInvocations(): void {
  try {
    fs.rmSync(FAKE_CLAUDE_INVOCATIONS_PATH, { force: true });
  } catch {
    /* nothing to clear */
  }
}

/**
 * Structural mirror of CommanderOutputRef (packages/shared/src/
 * commander-output-refs.ts). Re-declared locally so the e2e tree doesn't
 * depend on workspace package resolution.
 */
export interface FakeOutputRef {
  v: 1;
  kind: "artifact";
  id: string;
  versionId?: string | null;
  versionNumber?: number | null;
  title?: string | null;
  action: "created" | "referenced";
  toolCallId?: string | null;
  mimeType?: string | null;
}

/**
 * Mirror of the MCP bridge's executeAndFormat envelope
 * (server/src/services/internal-agent/mcp-bridge.ts): the tool_result
 * `content` string is JSON.stringify of this object. parse-stream-json.ts
 * lifts `outputRefs` from it when the tool name starts with "mcp__".
 */
export interface FakeToolEnvelope {
  success: boolean;
  data: unknown;
  summary: string;
  error?: string;
  outputRefs?: FakeOutputRef[];
}

export interface FakeToolCall {
  /** MUST start with "mcp__" for refs to be lifted (parser gate). */
  name: string;
  input?: unknown;
  envelope: FakeToolEnvelope;
  isError?: boolean;
}

export interface FakeClaudeTurn {
  toolCalls?: FakeToolCall[];
  /** Final assistant reply (markdown), streamed as text_delta events. */
  text: string;
  /**
   * Optional: hold the stream open this many ms after the tool_result(s) and
   * before the reply text. Lets a test observe the transient, un-persisted tool
   * indicator (the spinner fix settles it on tool_result, before the turn's
   * `done`). Omit for an instant turn (the default).
   */
  holdMs?: number;
  /**
   * Optional: set to false to suppress the thinking_delta block that fake-claude
   * emits by default (so the spec can assert absence of a reasoning block if needed).
   * Defaults to true (emit the thinking_delta).
   */
  reasoning?: boolean;
}

/** Write the scripted turn the NEXT fake-claude spawn will emit. */
export function writeFakeClaudeControl(turn: FakeClaudeTurn): void {
  fs.writeFileSync(FAKE_CLAUDE_CONTROL_PATH, JSON.stringify(turn, null, 2));
}

/**
 * Control shape for the EXTRACTION mode of the fake-claude shim.
 *
 * Extraction mode is active when claude is spawned with `--output-format text`
 * (i.e. NOT `--output-format stream-json`). The extraction-cli.ts one-shot
 * extractor uses this path.
 *
 * Fields:
 *   extractionText — the plain text the shim writes to stdout. Should be a
 *                    JSON array string that parseExtractedItems() can consume.
 *                    Pass an intentionally invalid string to exercise the
 *                    "unparseable" failure branch. Defaults to "[]" if absent.
 *   fail           — "exit" → shim exits with code 1 (exercises the
 *                    "nonzero_exit" CliExtractionError branch and marks the
 *                    discussion entry as "failed").
 */
export interface FakeClaudeExtractionControl {
  extractionText?: string;
  fail?: "exit";
}

/**
 * Write a control file for the NEXT extraction-mode fake-claude invocation.
 * Uses the same control file path as the chat-mode control so only ONE control
 * file write is needed before an extraction-triggering action.
 */
export function writeFakeClaudeExtractionControl(
  ctrl: FakeClaudeExtractionControl,
): void {
  fs.writeFileSync(FAKE_CLAUDE_CONTROL_PATH, JSON.stringify(ctrl, null, 2));
}

interface SeededArtifact {
  id: string;
  versionId: string | null;
  title: string;
}

/**
 * A create_artifact turn: envelope mirrors the bridge's buildOutputRefs
 * output for "create_artifact" (action: "created", versionNumber 1 when a
 * version exists) pointing at a REAL seeded artifact so the viewer panel can
 * load its content.
 */
export function createArtifactTurn(
  artifact: SeededArtifact,
  text: string,
): FakeClaudeTurn {
  return {
    toolCalls: [
      {
        name: "mcp__aoa__create_artifact",
        input: { title: artifact.title, type: "document" },
        envelope: {
          success: true,
          data: { artifactId: artifact.id, versionId: artifact.versionId },
          summary: `Created artifact "${artifact.title}"`,
          outputRefs: [
            {
              v: 1,
              kind: "artifact",
              id: artifact.id,
              versionId: artifact.versionId,
              versionNumber: artifact.versionId ? 1 : null,
              title: artifact.title,
              action: "created",
              toolCallId: null,
              mimeType: null,
            },
          ],
        },
      },
    ],
    text,
  };
}

/**
 * A query_company_artifacts turn: refs carry action "referenced" (mirrors
 * buildOutputRefs' refsFromRows). Referenced refs must render a chip but
 * never auto-open the panel and never badge the mobile pill.
 */
export function queryArtifactsTurn(
  artifacts: SeededArtifact[],
  text: string,
): FakeClaudeTurn {
  return {
    toolCalls: [
      {
        name: "mcp__aoa__query_company_artifacts",
        input: {},
        envelope: {
          success: true,
          data: artifacts.map((a) => ({
            artifactId: a.id,
            currentVersionId: a.versionId,
            title: a.title,
          })),
          summary: `Found ${artifacts.length} artifact(s)`,
          outputRefs: artifacts.map(
            (a): FakeOutputRef => ({
              v: 1,
              kind: "artifact",
              id: a.id,
              versionId: a.versionId,
              versionNumber: null,
              title: a.title,
              action: "referenced",
              toolCallId: null,
              mimeType: null,
            }),
          ),
        },
      },
    ],
    text,
  };
}
