// ui/src/components/skills/SkillsHomeEmpty.tsx
import { Link } from "@/lib/router";
import { Boxes, LayoutGrid } from "lucide-react";
import type { CompanySkillListItem } from "@armyofagents/shared";
import { Button } from "@/components/ui/button";
import { SkillSourceIcon } from "./SkillSourceIcon";
import type { RecentSkill } from "@/hooks/useRecentSkills";

interface Props {
  skills: CompanySkillListItem[];
  recent: RecentSkill[];
  onAddSkill: () => void;
}

function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}

export function SkillsHomeEmpty({ skills, recent, onAddSkill }: Props) {
  const skillById = new Map(skills.map((s) => [s.id, s]));
  const resolvedRecent = recent
    .map((r) => ({ entry: r, skill: skillById.get(r.skillId) }))
    .filter((r): r is { entry: RecentSkill; skill: CompanySkillListItem } => Boolean(r.skill));

  return (
    <div className="flex flex-1 flex-col items-center px-6 py-10">
      <div className="flex flex-col items-center text-center">
        <div className="mb-3 flex size-12 items-center justify-center rounded-lg bg-white/[0.04]">
          <Boxes className="size-6 text-muted-foreground/60" />
        </div>
        <h2 className="text-[15px] font-semibold">Pick a skill from the library</h2>
        <p className="mt-1.5 max-w-[44ch] text-[12.5px] text-muted-foreground">
          Browse a package, open a standalone skill, or add a new one from a github URL or
          skills.sh source.
        </p>
        <div className="mt-4 flex items-center gap-2">
          <Button type="button" size="sm" onClick={onAddSkill} className="h-8 px-3.5">
            + Add skill
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            asChild
            className="h-8 gap-1.5 px-3"
          >
            <Link to="/marketplace/skill" className="no-underline">
              <LayoutGrid className="size-3.5" />
              Browse marketplace
            </Link>
          </Button>
        </div>
      </div>

      {resolvedRecent.length > 0 && (
        <div className="mt-10 w-full max-w-[640px]">
          <div className="mb-2 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
            Recently opened
          </div>
          <div className="rounded-lg border border-border">
            {resolvedRecent.map((r, i) => (
              <Link
                key={r.skill.id}
                to={`/skills/${r.skill.id}`}
                className={`flex items-center gap-3 px-4 py-2.5 no-underline ${
                  i < resolvedRecent.length - 1 ? "border-b border-border" : ""
                }`}
              >
                <SkillSourceIcon badge={r.skill.sourceBadge} sourceLabel={r.skill.sourceLabel} />
                <span className="text-[12.5px] text-foreground">{r.skill.name}</span>
                <div className="flex-1" />
                <span className="text-[10.5px] text-muted-foreground">
                  {formatRelativeTime(r.entry.openedAt)}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
