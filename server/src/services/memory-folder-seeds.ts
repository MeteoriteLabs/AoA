/**
 * Phase 6: maps a department's functionType to a default set of folders that
 * get seeded into memory_folders on creation. This is a static lookup — no DB
 * access — so it can be used both in the service layer and (eventually) in
 * the UI for empty-state previews.
 *
 * Virtual folders (Pending Review, Active Goals, Pinned, Working) are NOT in
 * this list — they're computed at query time, not stored.
 */

export interface FolderSeed {
  path: string;          // path segment relative to dept root (e.g. "Decisions")
  displayName: string;
  seedKey: string;       // stable identifier for idempotent creation
  icon?: string;
}

const ENGINEERING_SEEDS: FolderSeed[] = [
  { path: "Decisions",    displayName: "Decisions",    seedKey: "software_development.decisions" },
  { path: "Playbooks",    displayName: "Playbooks",    seedKey: "software_development.playbooks" },
  { path: "References",   displayName: "References",   seedKey: "software_development.references" },
  { path: "Architecture", displayName: "Architecture", seedKey: "software_development.architecture" },
  { path: "Files",        displayName: "Files",        seedKey: "software_development.files", icon: "📁" },
];

const MARKETING_SEEDS: FolderSeed[] = [
  { path: "Decisions",  displayName: "Decisions",  seedKey: "marketing.decisions" },
  { path: "Brand",      displayName: "Brand",      seedKey: "marketing.brand" },
  { path: "Campaigns",  displayName: "Campaigns",  seedKey: "marketing.campaigns" },
  { path: "References", displayName: "References", seedKey: "marketing.references" },
  { path: "Files",      displayName: "Files",      seedKey: "marketing.files", icon: "📁" },
];

const SUPPORT_SEEDS: FolderSeed[] = [
  { path: "Playbooks",  displayName: "Playbooks",  seedKey: "customer_support.playbooks" },
  { path: "Macros",     displayName: "Macros",     seedKey: "customer_support.macros" },
  { path: "References", displayName: "References", seedKey: "customer_support.references" },
  { path: "Files",      displayName: "Files",      seedKey: "customer_support.files", icon: "📁" },
];

const GENERIC_SEEDS: FolderSeed[] = [
  { path: "Decisions",  displayName: "Decisions",  seedKey: "generic.decisions" },
  { path: "Policies",   displayName: "Policies",   seedKey: "generic.policies" },
  { path: "References", displayName: "References", seedKey: "generic.references" },
  { path: "Files",      displayName: "Files",      seedKey: "generic.files", icon: "📁" },
];

const SEEDS_BY_FUNCTION_TYPE: Record<string, FolderSeed[]> = {
  software_development: ENGINEERING_SEEDS,
  marketing: MARKETING_SEEDS,
  customer_support: SUPPORT_SEEDS,
};

export function getSeedFoldersForFunctionType(
  functionType: string | null | undefined,
): FolderSeed[] {
  if (!functionType) return GENERIC_SEEDS;
  return SEEDS_BY_FUNCTION_TYPE[functionType] ?? GENERIC_SEEDS;
}

export const COMPANY_SEED_FOLDERS: FolderSeed[] = [
  { path: "Company", displayName: "Company", seedKey: "company.root", icon: "🏛️" },
];
