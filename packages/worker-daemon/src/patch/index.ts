/**
 * @armyofagents/worker-daemon — DAT-003 workspace-patch producer barrel.
 *
 * A deterministic, pure, self-validating base→result manifest set-diff producer
 * (no git / DB / storage). Emits a frozen `WorkspacePatchManifestV1` plus the two
 * manifest digests it chains on.
 */

export { buildWorkspacePatch } from "./build-patch.js";
export type { BuildWorkspacePatchInput, BuildWorkspacePatchResult } from "./build-patch.js";
export { WorkspacePatchError } from "./errors.js";
