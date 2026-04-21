import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import { stableStringify } from "./feedback-redaction.js";

const gzipAsync = promisify(gzip);

// AoA's home-dir convention is `~/.paperclip/` (see cli/src/config/home.ts's
// `resolvePaperclipHomeDir` + docs/deploy/*). F.3 initially used `~/.aoa/`; F.4
// migrates this to `~/.paperclip/feedback-exports/` for convention parity so
// operators don't have to know a second home dir for a sibling subsystem.
export const FEEDBACK_LOCAL_EXPORT_DIR_NAME = path.join(".paperclip", "feedback-exports");

// Minimal shape the share client actually touches. Keeping this a structural
// type (not imported from the bundles service) avoids a cycle and lets the
// future HTTP transmission client reuse the same signature.
export interface ShareableBundle {
  id: string;
  createdAt?: Date | string | null;
  [key: string]: unknown;
}

export interface WriteBundleResult {
  path: string;
  size: number;
}

function resolveCreatedAtStamp(createdAt: Date | string | null | undefined): string {
  let iso: string;
  if (createdAt instanceof Date) iso = createdAt.toISOString();
  else if (typeof createdAt === "string" && createdAt.length > 0) iso = createdAt;
  else iso = new Date().toISOString();
  // Windows NTFS filenames can't contain `:` — `10:30:00` in an ISO stamp
  // would reject at write time. Colons → hyphens; trailing Z preserved.
  return iso.replace(/:/g, "-");
}

// F.3 stub. Writes the bundle as gzipped stableStringified JSON under
// ~/.paperclip/feedback-exports/. Filename = <bundle.id>-<createdAt stamp>.json.gz.
// stableStringify ensures byte-identical output across runs (deterministic
// field ordering — lets ops diff historical bundles + lets future dedupe logic
// hash contents without re-serializing).
//
// TODO(phase-I / F.D1): swap for HTTP POST once transmission endpoint is
// decided. Signature stays `(bundle) => {path, size}` so F.4's post-vote hook
// doesn't need to change when we flip implementations.
export async function writeBundleLocally(bundle: ShareableBundle): Promise<WriteBundleResult> {
  const dir = path.join(os.homedir(), FEEDBACK_LOCAL_EXPORT_DIR_NAME);
  await mkdir(dir, { recursive: true });

  const stamp = resolveCreatedAtStamp(bundle.createdAt);
  const filename = `${bundle.id}-${stamp}.json.gz`;
  const filePath = path.join(dir, filename);

  const payload = stableStringify(bundle);
  const gzipped = await gzipAsync(Buffer.from(payload, "utf8"));

  await writeFile(filePath, gzipped);
  return { path: filePath, size: gzipped.length };
}
