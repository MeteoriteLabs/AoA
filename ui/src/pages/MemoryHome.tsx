import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Brain, Pin, Building2, Search, type LucideIcon } from "lucide-react";
import { memoryApi } from "../api/memory";
import { projectsApi } from "../api/projects";
import { queryKeys } from "../lib/queryKeys";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { EmptyState } from "../components/EmptyState";
import { PendingReviewBanner } from "../components/memory/PendingReviewBanner";
import { DepartmentTile } from "../components/memory/DepartmentTile";
import { MemoryRecentsStrip } from "../components/memory/MemoryRecentsStrip";
import type { MemoryItem, Project } from "@armyofagents/shared";

export function MemoryHome() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs, setEntityColor, setSubtitle } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Memory" }]);
    setEntityColor("var(--entity-memory)");
    return () => {
      setSubtitle(null);
      setEntityColor(null);
    };
  }, [setBreadcrumbs, setEntityColor, setSubtitle]);

  const itemsQuery = useQuery({
    queryKey: queryKeys.memory.list(selectedCompanyId ?? ""),
    queryFn: () => memoryApi.list(selectedCompanyId!, {}),
    enabled: Boolean(selectedCompanyId),
  });
  const projectsQuery = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId ?? ""),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  const departments = useMemo(
    () =>
      (projectsQuery.data ?? []).filter(
        (p: Project) => p.type === "department" && !p.archivedAt,
      ),
    [projectsQuery.data],
  );

  const tilesData = useMemo(() => {
    const items = (itemsQuery.data ?? []) as Array<MemoryItem & { founderPinnedToTop?: boolean; departmentId?: string | null; layer?: string | null }>;

    // Pinned + Company virtual tiles
    const pinnedCount = items.filter((it) => it.founderPinnedToTop).length;
    const companyCount = items.filter((it) => it.departmentId === null && it.layer === "identity").length;

    const tiles: Array<{ key: string; label: string; icon?: LucideIcon | string; itemCount: number; pendingCount: number; to: string }> = [
      {
        key: "pinned",
        label: "Pinned",
        icon: Pin,
        itemCount: pinnedCount,
        pendingCount: 0,
        to: "/memory/explore?folder=__pinned",
      },
      {
        key: "company",
        label: "Company",
        icon: Building2,
        itemCount: companyCount,
        pendingCount: items.filter((it) => it.departmentId === null && it.layer === "identity" && it.status === "pending").length,
        to: "/memory/explore?folder=Company",
      },
    ];

    for (const dept of departments) {
      const deptItems = items.filter((it) => it.departmentId === dept.id);
      tiles.push({
        key: `dept-${dept.id}`,
        label: dept.name,
        icon: "📁",
        itemCount: deptItems.length,
        pendingCount: deptItems.filter((it) => it.status === "pending").length,
        to: `/memory/explore?dept=${encodeURIComponent(dept.id)}`,
      });
    }

    return tiles;
  }, [itemsQuery.data, departments]);

  if (!selectedCompanyId) {
    return <EmptyState icon={Brain} message="Select a company to view memory." />;
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
      {/* Pending review banner — self-hides when zero */}
      <PendingReviewBanner companyId={selectedCompanyId} />

      {/* Search trigger — styled as an input but rendered as a button for a11y */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent("memory:open-quick-switcher"))}
          aria-haspopup="dialog"
          className="w-full flex items-center gap-2 pl-9 pr-3 h-10 rounded-md border border-input bg-background text-sm text-muted-foreground text-left hover:bg-accent/30 transition-colors"
        >
          Search across all memory… (or press ⌘K)
        </button>
      </div>

      {/* Department tiles */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-3">Departments</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {tilesData.map((t) => (
            <DepartmentTile
              key={t.key}
              label={t.label}
              icon={t.icon}
              itemCount={t.itemCount}
              pendingCount={t.pendingCount}
              to={t.to}
            />
          ))}
        </div>
      </div>

      {/* Recents */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-3">Recent</div>
        <MemoryRecentsStrip companyId={selectedCompanyId} />
      </div>
    </div>
  );
}
