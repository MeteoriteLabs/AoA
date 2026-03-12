import { useEffect, useMemo, useState } from "react";
import { Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { briefsApi } from "../api/briefs";
import { queryKeys } from "../lib/queryKeys";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileText } from "lucide-react";
import { cn } from "../lib/utils";

const STATUS_BADGES: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  ready: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  reviewed: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  approved: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  partially_approved: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
};

export function Briefs() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    setBreadcrumbs([{ label: "Briefs" }]);
  }, [setBreadcrumbs]);

  const filters = useMemo(() => {
    const f: Record<string, string> = {};
    if (statusFilter !== "all") f.status = statusFilter;
    return f;
  }, [statusFilter]);

  const { data: briefs, isLoading } = useQuery({
    queryKey: [...queryKeys.briefs.list(selectedCompanyId!), filters],
    queryFn: () => briefsApi.list(selectedCompanyId!, filters),
    enabled: !!selectedCompanyId,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Briefs</h1>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="flex h-8 rounded-md border border-input bg-background px-2 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="all">All statuses</option>
          <option value="ready">Ready for review</option>
          <option value="draft">Draft</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="partially_approved">Partially approved</option>
        </select>
      </div>

      {!briefs || briefs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <FileText className="h-10 w-10 mb-3 opacity-40" />
          <p className="text-sm">No briefs yet</p>
          <p className="text-xs mt-1">Submit a debrief to generate your first brief</p>
        </div>
      ) : (
        <div className="space-y-2">
          {briefs.map((brief) => (
            <Link
              key={brief.id}
              to={`/briefs/${brief.id}`}
              className="flex items-center justify-between rounded-lg border border-border bg-card p-4 hover:bg-accent/50 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    Brief — {new Date(brief.createdAt).toLocaleDateString()}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {new Date(brief.createdAt).toLocaleTimeString()}
                  </p>
                </div>
              </div>
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-medium shrink-0",
                  STATUS_BADGES[brief.status] ?? "bg-muted text-muted-foreground",
                )}
              >
                {brief.status.replace("_", " ")}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
