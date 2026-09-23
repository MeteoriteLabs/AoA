/**
 * CLI-012 — Unit F link 3, the PRODUCER: enumerate the output root → `ArtifactExportRequest[]`.
 *
 * The first and only caller of `SupervisorDeps.resolveExportArtifacts` (DAT-009-3c), and the
 * first production producer of export requests at all. Design: the E7 implementation plan's
 * `### CLI-012` task; ruling **F7** (`docs/replatform/epics/E7-coding-e2b/decisions.md`,
 * `E7-D11`), which fixed the mechanism as a CONVENTIONAL OUTPUT ROOT, `/home/user/aoa-output`.
 *
 * ★★★ METADATA ONLY — NEVER BYTES, AND THIS IS A HARD CONSTRAINT.
 * This module enumerates through the port's `enumerateOutputs`, which returns
 * `{path, sizeBytes, symlink}` and no content. It must NEVER be composed with
 * `captureSandboxEntries` (`readFile` then `sha256(bytes)`): that helper is a local/desktop-lane
 * tool, and on the E2B and networked lanes it would route every tenant file's bytes through a
 * daemon that is dependency-pinned (E4-D01) precisely so it does not handle them — against the
 * sequencer's own `GRANTS OUT, NEVER BYTES` contract. `digestArtifact` supplies the digest and
 * size the frozen grant schema needs; `exportArtifact` moves the bytes provider → object store.
 *
 * ★★★ AND IT IS NOT "PATHS ONLY" EITHER — that was the wrong axis (`E7-D11`).
 * The rule is *no bytes*. Per-entry metadata is REQUIRED: without the link marker a symlink is
 * indistinguishable from a file, and the P-011 probe measured on a live sandbox (run
 * `35833717162`, arm `S-P5`) that `files.read` FOLLOWS one — so `R/l1 → .aoa-run-prompt.md`
 * would export the run's own staged input, and `R/l1 → /proc/self/environ` its environment, as
 * "output". That is the `A-O2-4` refusal, and it is implemented here.
 *
 * Runtime imports: relative modules only — the E4-D01 boundary.
 */

import type { ArtifactExportRequest } from "./artifact-export.js";
import type { SandboxOutputEntry } from "../supervisor/provider.js";

/**
 * ★ THE RULED OUTPUT ROOT (`E7-D11` §1, option 2). A run's deliverable is a regular file the
 * agent writes under this path; the caller-side directive (SD-1b, `CLI-017-A`) is what tells the
 * agent about it.
 *
 * ★ TENANT-NEUTRAL BY CONSTRUCTION (founder ruling F10). It is a path INSIDE a sandbox, and the
 * sandbox is per-run and single-tenant — every supervisor op mints a fresh idempotency key, so
 * `E2bSandboxProvider.create` never reuses one across attempts (review `A-O2-12`). Nothing about
 * this constant, or anything derived from it, is keyed by Organization; the tenant binding lives
 * where it belongs, in the handoff the sequencer derives the object key and artifact id from.
 */
export const DEFAULT_OUTPUT_ROOT = "/home/user/aoa-output";

/**
 * The `SD-6` admission bounds, applied from LISTING METADATA before any read.
 *
 * ★ THESE ARE NOT THE GRANT. `artifact-export.ts` mints `maxBytes: described.sizeBytes` — the
 * EXACT digested size — and says why: a cap-sized grant would let a file that grew after digest
 * be read and retained up to the cap before the hash mismatch rejected it. These are the
 * independent admission checks, and the review's SD-6 grant clause is superseded by that shipped
 * behaviour (`E7-D11`, *What this ruling does NOT decide*).
 *
 * ★ AND THE CHECK HERE IS ONLY THE CHEAP ARM. The listing size is a SNAPSHOT: a background
 * writer the agent left running can leave a file inside the cap at enumeration and grow it
 * before `digestArtifact`. `E5-F009` is discharged by the provider's BOUNDED READ, which stops
 * and refuses at the cap; this check is what avoids the read at all in the common case.
 */
export const MAX_OUTPUT_FILE_BYTES = 25 * 1024 * 1024;
/**
 * ★ THE SAME CEILING AS the sequencer's `MAX_ATTEMPT_EXPORT_BYTES`, deliberately — and kept in
 * step by a TEST, not by an import.
 * *Added 2026-09-23 (Codex P1, PR #576).* This module's dependency surface is asserted to be
 * TYPE-ONLY (`export-request-producer.test.ts`, *"its only runtime import is relative"*, which
 * also refuses any non-`type` import): that assertion is this ticket's data-plane guard — the
 * test *"that FAILS if the crossing returns"* its task section owes — so importing a value out
 * of `artifact-export.ts`, even a number, would trade that guard for a convenience. Instead the
 * literal is declared here and `producer and sequencer agree on the attempt ceiling` pins the
 * two against each other, so a drift reds.
 *
 * The check HERE is the cheap arm, applied from a listing SNAPSHOT; the sequencer re-applies
 * the ceiling on the DIGESTED size, which is what actually holds the bound when files grow
 * after enumeration.
 */
export const MAX_OUTPUT_TOTAL_BYTES = 100 * 1024 * 1024;
export const MAX_OUTPUT_FILES = 64;
export const MAX_OUTPUT_DEPTH = 8;

/**
 * Why one enumerated entry was NOT turned into an export request.
 *
 * ★ PATH-FREE BY CONSTRUCTION. Every value is a fixed snake_case token: the paths are
 * tenant-authored, and the supervisor logs classifications, never paths (the same rule
 * `ArtifactExportFailedError.reason` follows). A caller may safely put these in a log line or a
 * metric label.
 */
export type OutputRefusalReason =
  /** The entry is a symbolic link. `A-O2-4` — refused, NEVER digested. */
  | "output_symlink_refused"
  /** The entry is larger than {@link MAX_OUTPUT_FILE_BYTES}. */
  | "output_too_large"
  /** The per-attempt file count, byte total, or depth bound was reached. */
  | "output_limit_exceeded"
  /** The entry's path is not an absolute path strictly under the root. */
  | "output_path_escaped";

/** ONE refusal. Path-free. */
export interface OutputRefusal {
  readonly reason: OutputRefusalReason;
}

export interface CreateExportRequestProducerDeps {
  /**
   * The per-run sandbox view the SUPERVISOR supplies (E5-D07): bound to THIS run's sandbox and
   * THIS run's `EffectAuthority`, so the producer cannot name a sandbox and cannot become a
   * second, unguarded door onto one.
   */
  readonly enumerate: (root: string) => Promise<readonly SandboxOutputEntry[]>;
  /** Defaults to {@link DEFAULT_OUTPUT_ROOT}. */
  readonly outputRoot?: string;
  /**
   * The declared artifact `kind` — `E7-D08`, and it is this ticket's decision.
   *
   * ★ IT IS NOT DEFAULTED SILENTLY ANYWHERE DOWNSTREAM: `artifact-export.ts` records that the
   * caller's declaration is never substituted, precisely because `countProducedOutputs` arm 1
   * filters `kind = 'workspace_patch'` and a default picked in the sequencer would decide
   * someone else's gate.
   */
  readonly kind: string;
  /** A frozen `ARTIFACT_RETENTION_CLASSES` member. Control-plane-owned; sent honestly. */
  readonly retention: string;
  /** Derive the `type/subtype` token from a path. Defaults to {@link contentTypeForPath}. */
  readonly contentTypeFor?: (path: string) => string;
  /** Best-effort, PATH-FREE observation of each refusal. Never throws into the producer. */
  readonly onRefused?: (refusal: OutputRefusal) => void;
}

const CONTENT_TYPES: ReadonlyMap<string, string> = new Map([
  ["md", "text/markdown"],
  ["txt", "text/plain"],
  ["json", "application/json"],
  ["csv", "text/csv"],
  ["html", "text/html"],
  ["xml", "application/xml"],
  ["yaml", "application/yaml"],
  ["yml", "application/yaml"],
  ["patch", "text/x-patch"],
  ["diff", "text/x-patch"],
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["svg", "image/svg+xml"],
  ["pdf", "application/pdf"],
  ["zip", "application/zip"],
]);

/**
 * A `type/subtype` token for `path`.
 *
 * ★ THE FALLBACK IS `application/octet-stream`, NOT A GUESS. The frozen manifest requires a
 * content type, and claiming `text/plain` for bytes nobody parsed would be a fabricated fact
 * about tenant content. The extension is lowercased and matched against a closed table; anything
 * else — including an extension the tenant invented — is the octet-stream fallback.
 */
export function contentTypeForPath(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "application/octet-stream";
  return CONTENT_TYPES.get(base.slice(dot + 1).toLowerCase()) ?? "application/octet-stream";
}

/** Depth of `path` below `root`: a direct child is 1. */
function depthUnder(root: string, path: string): number {
  return path.slice(root.length + 1).split("/").length;
}

/**
 * Build the producer the supervisor hands to `resolveExportArtifacts`.
 *
 * ★ RETURN SHAPE: exactly `SupervisorDeps.resolveExportArtifacts` — `(input) => Promise<readonly
 * ArtifactExportRequest[]>`. It takes the per-run `sandbox` view off its input, so ONE producer
 * built at the composition root serves every run without ever holding a sandbox id of its own.
 *
 * ★ PER-FILE, NEVER ALL-OR-NOTHING (`E5-D07`). A refused file is classified and SKIPPED; the
 * remaining valid outputs are still produced. One symlink or one oversized file must not cost a
 * run every other deliverable it wrote — and an agent can make a refused file sort first.
 *
 * ★ AN EMPTY ROOT PRODUCES `[]`, which the sequencer answers with no session fetch, no mint and
 * no durable row (its anti-vacuity property). A MISSING root is the same thing: a run that wrote
 * nothing is not a failure of the export window.
 */
export function createExportRequestProducer(deps: CreateExportRequestProducerDeps) {
  const outputRoot = (deps.outputRoot ?? DEFAULT_OUTPUT_ROOT).replace(/\/+$/, "");
  const contentTypeFor = deps.contentTypeFor ?? contentTypeForPath;
  const refuse = (reason: OutputRefusalReason): void => {
    try {
      deps.onRefused?.({ reason });
    } catch {
      // Observation is best-effort and must never turn a produced list into a thrown window.
    }
  };

  return async (input: { enumerate?: (root: string) => Promise<readonly SandboxOutputEntry[]> }): Promise<
    readonly ArtifactExportRequest[]
  > => {
    const enumerate = input.enumerate ?? deps.enumerate;
    const entries = await enumerate(outputRoot);

    const requests: ArtifactExportRequest[] = [];
    let totalBytes = 0;
    const prefix = `${outputRoot}/`;
    for (const entry of entries) {
      // ★ FAIL-CLOSED ON A PATH THAT IS NOT UNDER THE ROOT. The transport's contract already
      // guarantees it, so this can only fire on a compromised or re-implemented driver — which
      // is exactly when a capture that trusted the list would export something else entirely.
      if (!entry.path.startsWith(prefix) || entry.path.length === prefix.length || entry.path.includes("/../")) {
        refuse("output_path_escaped");
        continue;
      }
      // ★ `A-O2-4`. The marker is an enumeration-time SNAPSHOT, so this is the FIRST of two
      // refusals: the provider rechecks with a no-follow stat at the read boundary, because a
      // file swapped for a symlink afterwards would otherwise be hashed and exported through its
      // stable target and the sequencer's re-hash check would PASS (`E7-F039`).
      if (entry.symlink) {
        refuse("output_symlink_refused");
        continue;
      }
      if (entry.sizeBytes > MAX_OUTPUT_FILE_BYTES) {
        refuse("output_too_large");
        continue;
      }
      if (
        requests.length >= MAX_OUTPUT_FILES ||
        totalBytes + entry.sizeBytes > MAX_OUTPUT_TOTAL_BYTES ||
        depthUnder(outputRoot, entry.path) > MAX_OUTPUT_DEPTH
      ) {
        refuse("output_limit_exceeded");
        continue;
      }
      totalBytes += entry.sizeBytes;
      requests.push({
        path: entry.path,
        kind: deps.kind,
        contentType: contentTypeFor(entry.path),
        retention: deps.retention,
      });
    }
    return requests;
  };
}
