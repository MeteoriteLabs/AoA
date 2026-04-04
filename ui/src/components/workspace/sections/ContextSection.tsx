import { useQuery } from "@tanstack/react-query";
import { dependenciesApi } from "../../../api/dependencies";
import { artifactsApi } from "../../../api/artifacts";
import { queryKeys } from "../../../lib/queryKeys";
import { Skeleton } from "@/components/ui/skeleton";
import { Brain, ArrowDown } from "lucide-react";
import type { ArtifactWithVersions } from "@paperclipai/shared";

interface ContextSectionProps {
  issueId: string;
  companyId: string;
}

export function ContextSection({ issueId, companyId }: ContextSectionProps) {
  const { data: deps, isLoading } = useQuery({
    queryKey: queryKeys.issues.dependencies(issueId),
    queryFn: () => dependenciesApi.list(companyId, issueId),
  });

  if (isLoading) {
    return (
      <div className="px-3 space-y-2" data-testid="context-skeleton">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  const completedUpstream = (deps?.upstream ?? []).filter(
    (d) => d.status === "done" || d.status === "completed",
  );

  return (
    <div className="space-y-3" data-testid="context-section">
      {/* Dependency outputs */}
      {completedUpstream.length > 0 && (
        <div className="space-y-1">
          <div className="px-3 text-xs font-medium text-muted-foreground">Dependency Outputs</div>
          {completedUpstream.map((dep) => (
            <UpstreamArtifact
              key={dep.dependencyIssueId ?? dep.id}
              issueId={dep.dependencyIssueId ?? dep.id}
              title={dep.title}
            />
          ))}
        </div>
      )}

      {completedUpstream.length === 0 && (
        <div className="px-3 py-1 text-xs text-muted-foreground" data-testid="context-no-deps">
          No completed upstream dependencies
        </div>
      )}

      {/* Memory placeholder */}
      <div
        className="mx-3 p-3 rounded-md border border-dashed border-muted-foreground/30 flex items-start gap-2"
        data-testid="memory-placeholder"
      >
        <Brain className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        <div className="text-xs text-muted-foreground">
          Memory integration coming soon — agent memory will appear here once configured
        </div>
      </div>
    </div>
  );
}

function UpstreamArtifact({ issueId, title }: { issueId: string; title: string }) {
  const { data: artifact } = useQuery({
    queryKey: queryKeys.artifacts.byIssue(issueId),
    queryFn: () => artifactsApi.getByIssueId(issueId),
  });

  return (
    <div className="px-3 py-1.5 flex items-center gap-2 text-xs" data-testid="upstream-dep">
      <ArrowDown className="h-3 w-3 text-muted-foreground shrink-0" />
      <span className="truncate">{title}</span>
      {artifact && (
        <span className="text-muted-foreground shrink-0">
          ({artifact.title} v{artifact.versions[0]?.versionNumber ?? 0})
        </span>
      )}
    </div>
  );
}
