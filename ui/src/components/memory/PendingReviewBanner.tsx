import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { memoryApi } from "../../api/memory";
import { queryKeys } from "../../lib/queryKeys";
import { useCompany } from "../../context/CompanyContext";
import type { MemoryItem } from "@armyofagents/shared";

interface PendingReviewBannerProps {
  companyId: string;
}

/**
 * Top banner on MemoryHome. Self-hides when zero pending across all
 * departments — no naggy empty state.
 *
 * Shows aggregate count + per-dept breakdown + a "Review" button that jumps
 * to the explorer scoped to whichever dept has the most pending.
 */
export function PendingReviewBanner({ companyId }: PendingReviewBannerProps) {
  const navigate = useNavigate();
  const { selectedCompany } = useCompany();
  const companyPrefix = (selectedCompany as { issuePrefix?: string } | null)?.issuePrefix ?? "";

  const { data: items } = useQuery({
    queryKey: queryKeys.memory.list(companyId),
    queryFn: () => memoryApi.list(companyId, {}),
  });

  const pending = (items ?? []).filter((it: MemoryItem) => it.status === "pending");
  if (pending.length === 0) return null;

  // Group by departmentId so we can show breakdown like "Eng 14 · Mkt 2 · Support 1"
  const byDept = new Map<string | null, number>();
  for (const it of pending) {
    const k = (it as MemoryItem & { departmentId?: string | null }).departmentId ?? null;
    byDept.set(k, (byDept.get(k) ?? 0) + 1);
  }

  // Pick dept with most pending for the "Review" jump target
  let topDept: string | null = null;
  let topCount = 0;
  for (const [k, v] of byDept.entries()) {
    if (v > topCount) {
      topCount = v;
      topDept = k;
    }
  }

  function jumpToReview() {
    const params = new URLSearchParams();
    if (topDept) params.set("dept", topDept);
    // The explorer's pending review folder will surface in a future polish slice;
    // for now scope to the dept with most pending and the founder can scan.
    navigate(`/${companyPrefix}/memory/explore?${params.toString()}`);
  }

  return (
    <div className="px-4 py-3 bg-amber-100 dark:bg-amber-900/40 border border-amber-200 dark:border-amber-900 rounded-md flex items-center gap-3">
      <Clock className="h-5 w-5 text-amber-700 dark:text-amber-300 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-amber-900 dark:text-amber-200">
          {pending.length} {pending.length === 1 ? "item" : "items"} waiting for your review
        </div>
        <div className="text-[11px] text-amber-700 dark:text-amber-300 mt-0.5 truncate">
          across {byDept.size} {byDept.size === 1 ? "scope" : "scopes"}
        </div>
      </div>
      <Button
        size="sm"
        onClick={jumpToReview}
        className="bg-amber-700 hover:bg-amber-800 text-white text-xs"
      >
        Review
      </Button>
    </div>
  );
}
