import { Bot, CircleDot } from "lucide-react";
import { CompanyPatternIcon } from "./CompanyPatternIcon";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { CompanyStats } from "@/api/companies";
import type { Company } from "@paperclipai/shared";

interface LobbyCompanyCardProps {
  company: Company;
  stats?: CompanyStats[string];
  statsLoading?: boolean;
  onClick: () => void;
}

export function LobbyCompanyCard({ company, stats, statsLoading, onClick }: LobbyCompanyCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex flex-col items-start gap-4 rounded-lg border border-border bg-card p-5",
        "text-left transition-all duration-150",
        "hover:border-foreground/20 hover:shadow-md hover:shadow-black/5",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      )}
    >
      {/* Brand color top accent */}
      {company.brandColor && (
        <div
          className="absolute inset-x-0 top-0 h-0.5 rounded-t-lg"
          style={{ backgroundColor: company.brandColor }}
        />
      )}

      <div className="flex items-center gap-3 w-full">
        {company.logoAssetId ? (
          <img
            src={`/api/assets/${company.logoAssetId}/content`}
            alt={company.name}
            className="w-10 h-10 rounded-lg shrink-0 object-cover"
          />
        ) : (
          <CompanyPatternIcon
            companyName={company.name}
            brandColor={company.brandColor}
            className="rounded-lg shrink-0"
          />
        )}
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-foreground truncate">
            {company.name}
          </h3>
          {company.issuePrefix && (
            <p className="text-xs text-muted-foreground mt-0.5">{company.issuePrefix}</p>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        {statsLoading ? (
          <>
            <Skeleton className="h-3.5 w-16 animate-pulse" />
            <Skeleton className="h-3.5 w-16 animate-pulse" />
          </>
        ) : stats ? (
          <>
            <span className="flex items-center gap-1.5">
              <Bot className="h-3.5 w-3.5" />
              {stats.agentCount} {stats.agentCount === 1 ? "agent" : "agents"}
            </span>
            <span className="flex items-center gap-1.5">
              <CircleDot className="h-3.5 w-3.5" />
              {stats.issueCount} {stats.issueCount === 1 ? "task" : "tasks"}
            </span>
          </>
        ) : null}
      </div>
    </button>
  );
}
