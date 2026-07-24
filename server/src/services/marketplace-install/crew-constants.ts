/**
 * @fileoverview Constants shared between crew repair (T2.3b) and the install
 * machinery it has to stay consistent with.
 *
 * This module exists to break an import cycle, not to be a grab-bag: `resolver`
 * needs to recognise an adopted row, and `crew-repair` needs `resolver`'s
 * neighbours, so the value cannot live in either. Keep it to values that more
 * than one side genuinely reads.
 */

/**
 * The `templateVersion` a crew row carries after T2.3b adoption re-points it at
 * its catalog template.
 *
 * It must be non-null (`crew-updater` skips rows without one) and must never
 * equal a published catalog version (or the updater would think the row is
 * synced when it still holds pre-catalog content). A `0.0.0` prerelease
 * satisfies both and is honest about what the row actually contains. Do NOT
 * replace it with the current catalog version — that would claim the row is up
 * to date with content it has never seen.
 *
 * ⚠️ Agent rows only. It must never be written to `teams.templateVersion`:
 * `TeamManifestSchema` validates `^\d+\.\d+\.\d+$` and `team-export.ts` feeds
 * that field straight in, so a prerelease string would throw on company export.
 */
export const ADOPTED_TEMPLATE_VERSION = "0.0.0-legacy";
