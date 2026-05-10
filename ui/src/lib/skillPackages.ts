import type { CompanySkillListItem } from "@armyofagents/shared";

const SYNTHESIS_THRESHOLD = 2;

export interface SkillPackage {
  /** owner/repo for synthesized packages, or explicit packageId */
  id: string;
  /** Display name — the repo portion (last path segment of id) */
  name: string;
  /** GitHub URL for the source repo */
  sourceUrl: string;
  /** Ordered alphabetically by skill id */
  memberSkillIds: string[];
  count: number;
  /** True when derived from an explicit metadata.packageId, not from owner/repo synthesis */
  explicit: boolean;
}

export interface DerivedLibrary {
  packages: SkillPackage[];
  standalones: CompanySkillListItem[];
}

function readMetaString(metadata: unknown, key: string): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function packageableSourceType(sourceType: CompanySkillListItem["sourceType"]): boolean {
  // local_path / catalog (locally-edited) and url skills are never packaged.
  return sourceType === "github" || sourceType === "skills_sh";
}

/**
 * Groups installed company skills into packages (mirroring the marketplace
 * derivePackages() rules) and a standalones list.
 *
 * Rules:
 * - Explicit `metadata.packageId` override → always a package (threshold 1).
 * - github/skills_sh skills sharing the same owner/repo → package when ≥ 2.
 * - local_path / catalog / url skills are never packaged.
 * - Explicit packageId beats synthesis on collision.
 * - Packages sorted alphabetically by id; member ids sorted alphabetically within each package.
 */
export function derivePackagesForLibrary(
  skills: ReadonlyArray<CompanySkillListItem>,
): DerivedLibrary {
  const explicitGroups = new Map<string, CompanySkillListItem[]>();
  const synthesizedGroups = new Map<string, CompanySkillListItem[]>();

  for (const skill of skills) {
    const explicitId = readMetaString(skill.metadata, "packageId");
    if (explicitId) {
      const list = explicitGroups.get(explicitId) ?? [];
      list.push(skill);
      explicitGroups.set(explicitId, list);
      continue;
    }
    if (!packageableSourceType(skill.sourceType)) continue;
    const owner = readMetaString(skill.metadata, "owner");
    const repo = readMetaString(skill.metadata, "repo");
    if (!owner || !repo) continue;
    const key = `${owner}/${repo}`;
    const list = synthesizedGroups.get(key) ?? [];
    list.push(skill);
    synthesizedGroups.set(key, list);
  }

  // Explicit packageId wins on collision — remove synthesized group with same key.
  for (const id of explicitGroups.keys()) synthesizedGroups.delete(id);

  const packages: SkillPackage[] = [];

  for (const [id, members] of explicitGroups) {
    packages.push(buildPackage(id, members, /* explicit */ true));
  }
  for (const [id, members] of synthesizedGroups) {
    if (members.length < SYNTHESIS_THRESHOLD) continue;
    packages.push(buildPackage(id, members, /* explicit */ false));
  }

  packages.sort((a, b) => a.id.localeCompare(b.id));

  const memberIds = new Set<string>();
  for (const p of packages) for (const id of p.memberSkillIds) memberIds.add(id);
  const standalones = skills.filter((s) => !memberIds.has(s.id));

  return { packages, standalones };
}

function buildPackage(
  id: string,
  members: ReadonlyArray<CompanySkillListItem>,
  explicit: boolean,
): SkillPackage {
  const sortedIds = members.map((m) => m.id).sort((a, b) => a.localeCompare(b));
  const repoName = id.split("/")[1] ?? id;
  return {
    id,
    name: repoName,
    sourceUrl: `https://github.com/${id}`,
    memberSkillIds: sortedIds,
    count: sortedIds.length,
    explicit,
  };
}
