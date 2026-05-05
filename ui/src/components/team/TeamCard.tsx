import { Star, MoreHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ClickableDiv } from "@/components/ui/clickable-div";
import { cn } from "@/lib/utils";

export interface TeamCardData {
  id: string;
  name: string;
  slug: string;
  parentProjectName: string;
  status: "active" | "archived";
  memberCount: number;
  leadName: string;
  iconColor?: string;
}

interface Props {
  team: TeamCardData;
  onClick: () => void;
  onMenuClick?: () => void;
}

export function TeamCard({ team, onClick, onMenuClick }: Props) {
  const colorClass = team.iconColor ?? "border-l-indigo-500";
  return (
    <ClickableDiv
      onClick={onClick}
      className={cn(
        "group relative flex items-start gap-3 rounded-lg border border-border bg-card p-4 text-left transition-all duration-200 hover:shadow-sm",
        "border-l-[3px]",
        colorClass,
      )}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent text-base font-bold">
        {team.name.charAt(0).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-sm font-semibold">{team.name}</h3>
          <Badge variant="outline" className="shrink-0 text-[10px] uppercase tracking-wide">
            {team.parentProjectName}
          </Badge>
        </div>
        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <Star className="h-3 w-3 text-amber-500" />
          <span>{team.leadName}</span>
          <span className="opacity-50">·</span>
          <span>{team.memberCount} agents</span>
          <span className="opacity-50">·</span>
          <span className="capitalize">{team.status}</span>
        </p>
      </div>
      {onMenuClick && (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={(e) => {
            e.stopPropagation();
            onMenuClick();
          }}
          className="opacity-0 transition-opacity group-hover:opacity-100"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </Button>
      )}
    </ClickableDiv>
  );
}
