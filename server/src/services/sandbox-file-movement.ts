/**
 * U6.2 — sandbox file-movement seam.
 *
 * Org stage-in: the host clones the company repo elsewhere (PAT host-side,
 * reusing existing worktree/`resolveGitHubAuth` infra — not this file's
 * concern), then this module uploads that host clone's working tree
 * (**including `.git`**, so `git diff HEAD` works inside the VM) into the
 * sandbox's `remoteCwd` via the provider file-write seam added in this wave
 * (`SandboxRuntimeProvider.writeFiles`, `sandbox-provider-runtime.ts`).
 *
 * All host-side archiving of the clone runs through the U6.1
 * `assertHostOrchestrationGitAllowed` guard — this is AoA's own code
 * operating on a host clone, never a tenant CLI shell, so it is permitted on
 * cloud_auth (spec §9 blast-radius reframe) while the tenant-command guard
 * stays refused.
 */
import { execFile } from "node:child_process";
import { shellQuote } from "@armyofagents/adapter-utils";
import { assertHostOrchestrationGitAllowed } from "./local-workspace-command-guard.js";

/** Generous ceiling for a repo working tree tarball (incl. `.git`). */
const TAR_MAX_BUFFER = 200 * 1024 * 1024;

const REMOTE_TAR_PATH = "/tmp/aoa-repo.tar";

export interface SandboxExecuteResult {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

export interface SandboxExecuteInput {
  command: string;
  args?: string[];
  cwd?: string | null;
  env?: Record<string, string>;
  stdin?: string | null;
  timeoutSec?: number;
}

/**
 * The minimal runner surface this module needs. A strict superset of this
 * shape is produced by `environment-run-orchestrator.ts`'s `buildProviderRunner`
 * (`SandboxFileMovementProviderRunner`) — kept as a separate, decoupled
 * interface here so this module doesn't import orchestrator internals, and
 * so a hand-built test double (over the fake `SandboxRuntimeProvider`) only
 * needs to satisfy this shape, not the full adapter-execution-target type.
 */
export interface SandboxFileMovementRunner {
  execute(input: SandboxExecuteInput): Promise<SandboxExecuteResult>;
  writeFiles(files: Array<{ path: string; content: Buffer }>): Promise<void>;
  readFiles?(input: { paths: string[] }): Promise<Array<{ path: string; content: Buffer }>>;
  resolveHost?(input: { port: number }): Promise<string>;
}

/**
 * Host-side: tar the host clone's working tree (incl. `.git`) into an
 * in-memory buffer. `--format=ustar` is a deliberate implementation choice —
 * a portable, minimal archive (no GNU long-name/PAX extensions) that keeps
 * the archive trivially parseable by a minimal reader (the fake sandbox
 * provider's `execute()` used in CI, mirroring the AOA_E2E_FAKE_EMBEDDER
 * seam, spec §10). A real E2B VM extracts with a real `tar` binary and is
 * unaffected by this host-side creation choice.
 *
 * Wrapped in the U6.1 host-orchestration guard: this archives a HOST clone
 * that AoA's own orchestration code produced, never a tenant CLI shell, so
 * it is permitted on cloud_auth while the tenant-workspace-command guard
 * stays refused there.
 */
async function tarHostClone(hostClonePath: string): Promise<Buffer> {
  assertHostOrchestrationGitAllowed("org stage-in tar");
  return await new Promise<Buffer>((resolve, reject) => {
    execFile(
      "tar",
      ["--format=ustar", "-cf", "-", "-C", hostClonePath, "."],
      { maxBuffer: TAR_MAX_BUFFER, encoding: "buffer" },
      (error, stdout) => {
        if (error) {
          reject(new Error(`org stage-in: tar failed for "${hostClonePath}": ${error.message}`));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

/**
 * Uploads the host clone at `hostClonePath` (working tree + `.git`) into the
 * sandbox at `remoteCwd`: tar on the host -> `runner.writeFiles` the archive
 * into the VM -> `tar -xf` it into place in-VM -> clean up the staged
 * archive. `remoteCwd` is shell-quoted (path-injection-safe); the archive's
 * own remote path is a fixed constant, not caller-controlled.
 */
export async function stageRepoIntoSandbox(input: {
  runner: SandboxFileMovementRunner;
  hostClonePath: string;
  remoteCwd: string;
}): Promise<void> {
  const tarBuffer = await tarHostClone(input.hostClonePath);

  await input.runner.writeFiles([{ path: REMOTE_TAR_PATH, content: tarBuffer }]);

  const script = [
    `mkdir -p ${shellQuote(input.remoteCwd)}`,
    `tar -xf ${REMOTE_TAR_PATH} -C ${shellQuote(input.remoteCwd)}`,
    `rm -f ${REMOTE_TAR_PATH}`,
  ].join(" && ");

  const result = await input.runner.execute({
    command: "sh",
    args: ["-c", script],
    cwd: null,
    env: {},
    stdin: null,
    timeoutSec: 120,
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `org stage-in: failed to extract repo into sandbox remoteCwd "${input.remoteCwd}" ` +
        `(exit ${result.exitCode ?? "null"}): ${result.stderr || result.stdout}`,
    );
  }
}
