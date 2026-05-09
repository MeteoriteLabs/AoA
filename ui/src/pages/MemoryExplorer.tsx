import { useEffect, useMemo, useRef, useState } from "react";
import { NewMemoryItemDialog } from "../components/memory/NewMemoryItemDialog";
import { useSearchParams, useNavigate } from "@/lib/router";
import { Brain } from "lucide-react";
import { Group, Panel, Separator } from "react-resizable-panels";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { MemoryTree } from "../components/memory/MemoryTree";
import { MemoryFileList } from "../components/memory/MemoryFileList";
import { MemoryViewer } from "../components/memory/MemoryViewer";
import { MemoryCollapsedTabStrip } from "../components/memory/MemoryCollapsedTabStrip";
import { MemoryFolderRail } from "../components/memory/MemoryFolderRail";
import { MemoryHomeDashboard } from "../components/memory/MemoryHomeDashboard";
import { MemoryToolbar } from "../components/memory/MemoryToolbar";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { EmptyState } from "../components/EmptyState";
import { canUploadInScope } from "../lib/memoryUploadScope";
import { useMemoryTabs } from "../hooks/useMemoryTabs";
import { useQuery } from "@tanstack/react-query";
import { memoryApi } from "../api/memory";
import { queryKeys } from "../lib/queryKeys";
import { deriveMemoryCounts, activeRailKindFromUrl, railKindToParams } from "../lib/memoryRail";

export function MemoryExplorer() {
  const { selectedCompanyId, selectedCompany } = useCompany();
  const { setBreadcrumbs, setEntityColor, setSubtitle } = useBreadcrumbs();
  const [searchParams] = useSearchParams();

  const folderPath = searchParams.get("folder") ?? "";
  const departmentId = searchParams.get("dept") ?? null;
  const layer = searchParams.get("layer");
  const goalId = searchParams.get("goal");

  // Legacy URL params: ?item=X&type=Y deep-link support.
  const selectedItemId = searchParams.get("item");
  const selectedItemType = searchParams.get("type") as
    | "memory_item"
    | "asset"
    | null;

  // Tab state — owned here, passed down to viewer + list.
  const { tabs, activeKey, openOrActivate, close, setActive } = useMemoryTabs();

  // Rail counts — derived from the flat items list (same query key as MemoryTree; cache hit).
  const { data: allItems } = useQuery({
    queryKey: queryKeys.memory.list(selectedCompanyId ?? ""),
    queryFn: () => memoryApi.list(selectedCompanyId!, {}),
    enabled: Boolean(selectedCompanyId),
  });
  const railCounts = useMemo(() => deriveMemoryCounts(allItems ?? []), [allItems]);
  const activeRailKind = activeRailKindFromUrl({ folderPath, departmentId, layer: layer ?? null });

  const navigate = useNavigate();
  const companyPrefix = selectedCompany?.issuePrefix ?? "";

  // One-shot legacy migration: if URL has ?item=X&type=Y but no tabs yet, open it.
  useEffect(() => {
    if (selectedItemId && selectedItemType && tabs.length === 0) {
      openOrActivate({
        id: selectedItemId,
        kind: selectedItemType,
        title: selectedItemId, // fallback title; replaced once the viewer loads
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItemId, selectedItemType]);

  // Phase 6.2a: synthetic Home selection — no folder, no dept, no layer, no item.
  const isHomeSelected =
    !folderPath && !departmentId && !layer && !selectedItemId;

  // Codex P1 round 2: only show the upload button in scopes where the
  // resulting asset is reachable from the central pane. Layer-only views and
  // virtual shortcuts (Pinned/Pending/Recent/Archived) suppress assets, so
  // an upload there would be invisible afterwards.
  const canUpload = canUploadInScope({
    folderPath,
    departmentId,
    layer,
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [newItemOpen, setNewItemOpen] = useState(false);

  const treePanelRef = useRef<PanelImperativeHandle>(null);
  const viewerPanelRef = useRef<PanelImperativeHandle>(null);
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const [viewerCollapsed, setViewerCollapsed] = useState(false);

  useEffect(() => {
    setBreadcrumbs([{ label: "Memory" }, { label: "Explorer" }]);
    setEntityColor("var(--entity-memory)");
    return () => {
      setSubtitle(null);
      setEntityColor(null);
    };
  }, [setBreadcrumbs, setEntityColor, setSubtitle]);

  if (!selectedCompanyId) {
    return <EmptyState icon={Brain} message="Select a company to view memory." />;
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 pt-4 pb-2">
        <h1 className="text-[1.6rem] font-bold tracking-tight">
          Memory Explorer<span className="text-brand">.</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Browse memory by department and folder structure.
        </p>
      </div>
      <MemoryToolbar
        companyId={selectedCompanyId}
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        onNewItem={() => setNewItemOpen(true)}
        uploadContext={canUpload ? { departmentId, folderPath } : undefined}
        searchEnabled={!isHomeSelected}
      />
      <Group
        orientation="horizontal"
        id="memory-explorer-panes"
        className="flex-1"
      >
        <Panel
          id="memory-explorer-tree"
          defaultSize={20}
          minSize="12%"
          maxSize="35%"
          collapsible
          collapsedSize="3%"
          panelRef={treePanelRef}
          onResize={(size) => setTreeCollapsed(size.asPercentage <= 4)}
          className="border-r border-border"
        >
          {treeCollapsed ? (
            <MemoryFolderRail
              counts={railCounts}
              activeKind={activeRailKind}
              onSelect={(kind) => {
                const params = railKindToParams(kind);
                navigate(`/${companyPrefix}/memory/explore${params}`);
                treePanelRef.current?.expand();
              }}
              onExpand={() => treePanelRef.current?.expand()}
            />
          ) : (
            <MemoryTree
              companyId={selectedCompanyId}
              selectedFolderPath={folderPath}
              selectedDepartmentId={departmentId}
              selectedLayer={layer ?? null}
              selectedGoalId={goalId ?? null}
              onCollapseRequest={() => treePanelRef.current?.collapse()}
            />
          )}
        </Panel>
        <Separator
          id="memory-explorer-sep-1"
          className="w-1 bg-transparent hover:bg-border/80 transition-colors cursor-col-resize"
        />
        <Panel
          id="memory-explorer-list"
          defaultSize={isHomeSelected ? 55 : 28}
          minSize="20%"
          maxSize={isHomeSelected ? "70%" : "45%"}
          className="border-r border-border"
        >
          {isHomeSelected ? (
            <MemoryHomeDashboard companyId={selectedCompanyId} />
          ) : (
            <MemoryFileList
              companyId={selectedCompanyId}
              folderPath={folderPath}
              departmentId={departmentId}
              layer={layer ?? null}
              selectedItemId={activeKey?.id ?? null}
              selectedItemType={activeKey?.kind ?? null}
              searchQuery={searchQuery}
              onSelectRow={(id, kind, title) => openOrActivate({ id, kind, title })}
            />
          )}
        </Panel>
        <Separator
          id="memory-explorer-sep-2"
          className="w-1 bg-transparent hover:bg-border/80 transition-colors cursor-col-resize"
        />
        <Panel
          id="memory-explorer-viewer"
          defaultSize={isHomeSelected ? 25 : 52}
          minSize="15%"
          collapsible
          collapsedSize="3%"
          panelRef={viewerPanelRef}
          onResize={(size) => setViewerCollapsed(size.asPercentage <= 4)}
        >
          {viewerCollapsed ? (
            <MemoryCollapsedTabStrip
              tabs={tabs}
              activeKey={activeKey}
              onActivate={(id, kind) => {
                setActive(id, kind);
                viewerPanelRef.current?.expand();
              }}
              onExpand={() => viewerPanelRef.current?.expand()}
            />
          ) : isHomeSelected ? (
            // Home state: empty right pane until Phase 2 lands (graph + tabs).
            // The legacy "📊 graph view coming soon" placeholder was removed —
            // it shipped a loud empty-state on every Memory landing without
            // earning the screen real estate. Founders can collapse the pane.
            <div className="relative h-full" />
          ) : (
            <MemoryViewer
              companyId={selectedCompanyId}
              tabs={tabs}
              activeKey={activeKey}
              onActivate={setActive}
              onClose={close}
              onCollapse={() => viewerPanelRef.current?.collapse()}
              folderPath={folderPath}
            />
          )}
        </Panel>
      </Group>

      <NewMemoryItemDialog
        open={newItemOpen}
        onOpenChange={setNewItemOpen}
        companyId={selectedCompanyId}
        defaultDepartmentId={departmentId}
        defaultFolderPath={folderPath || undefined}
      />
    </div>
  );
}
