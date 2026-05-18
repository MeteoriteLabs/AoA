import { spawn } from "node:child_process";
import { platform } from "node:os";

interface SummarizeArgs {
  cliTool: string;
  cheapModel?: string | null;
  transcript: string;
}

const PROMPT_PREFIX =
  "Summarize this conversation history concisely, preserving key decisions, action items, and context. Output ONLY the summary:\n\n";

/**
 * Summarize a transcript via the SAME CLI the chat uses, with NO MCP bridge
 * / tool surface (a summary must never trigger tool calls). One-shot, plain
 * prompt, cheap model. Throws on non-zero exit / empty output (caller treats
 * any failure as "skip compaction this turn").
 */
export async function summarizeViaCli(args: SummarizeArgs): Promise<string> {
  const isWin = platform() === "win32";
  const prompt = PROMPT_PREFIX + args.transcript;
  let bin: string;
  let argv: string[];
  let useStdin = false;

  if (args.cliTool === "codex") {
    bin = "codex";
    argv = ["exec", "--json", "-"];
    useStdin = true;
  } else {
    bin = "claude";
    argv = [
      "-p",
      isWin
        ? `"${prompt.replace(/"/g, '""').replace(/%/g, "%%").replace(/\^/g, "^^")}"`
        : prompt,
      "--output-format",
      "text",
    ];
  }

  if (args.cheapModel) argv = [...argv, "--model", args.cheapModel];

  return await new Promise<string>((resolve, reject) => {
    const child = spawn(bin, argv, {
      stdio: ["pipe", "pipe", "pipe"],
      shell: isWin,
    });

    let out = "";

    child.stdout.on("data", (d: Buffer) => {
      out += d.toString();
    });

    child.on("close", (code: number) => {
      if (code === 0 && out.trim().length > 0) {
        resolve(out.trim());
      } else {
        reject(new Error(`summarizer exit ${code}`));
      }
    });

    child.on("error", reject);

    if (useStdin) {
      child.stdin.write(prompt);
      child.stdin.end();
    }
  });
}
