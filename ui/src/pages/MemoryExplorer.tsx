import { useEffect, useMemo, useRef, useState } from "react";
import { NewMemoryItemDialog } from "../components/memory/NewMemoryItemDialog";
import { useSearchParams, useNavigate } from "@/lib/router";
import { Brain, Plus, Search, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import { Group, Panel, Separator } from "react-resizable-panels";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { Button } from "@/components/ui/button";
import { MemoryTree } from "../components/memory/MemoryTree";
import { MemoryFileList } from "../components/memory/MemoryFileList";
import { MemoryViewer } from "../components/memory/MemoryViewer";
import { MemoryCollapsedTabStrip } from "../components/memory/MemoryCollapsedTabStrip";
import { MemoryFolderRail } from "../components/memory/MemoryFolderRail";
import { MemoryHomeDashboard } from "../components/memory/MemoryHomeDashboard";
import { MemoryUploadButton } from "../components/memory/MemoryUploadButton";
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
  // Tracks whether the tree was auto-collapsed when the viewer opened, so we
  // can restore it automatically when all tabs are closed (Option B interaction).
  const treeAutoCollapsedRef = useRef(false);

  // Collapse viewer when all tabs are closed; restore tree if we auto-collapsed it.
  const prevTabsLengthRef = useRef(tabs.length);
  useEffect(() => {
    const prev = prevTabsLengthRef.current;
    prevTabsLengthRef.current = tabs.length;
    if (tabs.length === 0 && prev > 0) {
      setViewerCollapsed(true);
      viewerPanelRef.current?.collapse();
      if (treeAutoCollapsedRef.current) {
        treeAutoCollapsedRef.current = false;
        setTreeCollapsed(false);
        treePanelRef.current?.expand();
      }
    }
  }, [tabs.length]);

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
      <Group
        orientation="horizontal"
        id="memory-explorer-panes"
        className="flex-1"
      >
        <Panel
          id="memory-explorer-tree"
          defaultSize="20%"
          minSize="12%"
          maxSize="35%"
          collapsible
          collapsedSize="3%"
          panelRef={treePanelRef}
          onResize={(size) => setTreeCollapsed(size.asPercentage <= 4)}
          className="border-r border-border"
        >
          <div className="h-full">
            {treeCollapsed ? (
              <MemoryFolderRail
                counts={railCounts}
                activeKind={activeRailKind}
                onSelect={(kind) => {
                  const params = railKindToParams(kind);
                  navigate(`/${companyPrefix}/memory/explore${params}`);
                  setTreeCollapsed(false);
                  treePanelRef.current?.expand();
                }}
              />
            ) : (
              <MemoryTree
                companyId={selectedCompanyId}
                selectedFolderPath={folderPath}
                selectedDepartmentId={departmentId}
                selectedLayer={layer ?? null}
                selectedGoalId={goalId ?? null}
              />
            )}
          </div>
        </Panel>
        <Separator
          id="memory-explorer-sep-1"
          className="relative w-1 bg-transparent hover:bg-border/80 transition-colors cursor-col-resize"
        >
          <button
            type="button"
            title={treeCollapsed ? "Expand folders" : "Collapse folders"}
            aria-label={treeCollapsed ? "Expand folders" : "Collapse folders"}
            onClick={() => {
              if (treeCollapsed) {
                setTreeCollapsed(false);
                treePanelRef.current?.expand();
                treeAutoCollapsedRef.current = false;
              } else {
                setTreeCollapsed(true);
                treePanelRef.current?.collapse();
                treeAutoCollapsedRef.current = false;
              }
            }}
            className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 z-30 hidden md:inline-flex size-[26px] items-center justify-center rounded-md border border-border-strong bg-card-2 text-very-dim shadow-[0_2px_6px_rgba(0,0,0,0.4)] transition-[background,color,border-color,transform] duration-[120ms] hover:scale-105 hover:border-brand hover:bg-card hover:text-text focus-visible:outline-none focus-visible:border-brand focus-visible:ring-[3px] focus-visible:ring-brand-focus-ring"
          >
            {treeCollapsed
              ? <PanelLeftOpen className="size-3.5" aria-hidden />
              : <PanelLeftClose className="size-3.5" aria-hidden />}
          </button>
        </Separator>
        <Panel
          id="memory-explorer-list"
          defaultSize={isHomeSelected ? "55%" : "28%"}
          minSize="20%"
          className="border-r border-border"
        >
          <div className="h-full">
            {isHomeSelected ? (
              <div className="h-full flex flex-col bg-card/30">
                <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-card px-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">Memory</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {(allItems ?? []).length} {(allItems ?? []).length === 1 ? "item" : "items"} · 4 layers
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    title="Quick-jump to a memory item or file"
                    aria-label="Quick-jump to a memory item or file"
                    onClick={() =>
                      window.dispatchEvent(new CustomEvent("memory:open-quick-switcher"))
                    }
                    className="h-7 w-7 p-0"
                  >
                    <Search className="size-3.5" aria-hidden />
                  </Button>
                  <MemoryUploadButton
                    companyId={selectedCompanyId}
                    departmentId={null}
                    folderPath=""
                    iconOnly
                  />
                  <Button
                    type="button"
                    size="sm"
                    title="New item"
                    aria-label="New item"
                    onClick={() => setNewItemOpen(true)}
                    className="h-7 w-7 p-0"
                  >
                    <Plus className="size-3.5" aria-hidden />
                  </Button>
                </div>
                <MemoryHomeDashboard companyId={selectedCompanyId} showQuickJump={false} />
              </div>
            ) : (
              <MemoryFileList
                companyId={selectedCompanyId}
                folderPath={folderPath}
                departmentId={departmentId}
                layer={layer ?? null}
                selectedItemId={activeKey?.id ?? null}
                selectedItemType={activeKey?.kind ?? null}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                onNewItem={() => setNewItemOpen(true)}
                uploadContext={canUpload ? { departmentId, folderPath } : undefined}
                onSelectRow={(id, kind, title) => {
                  openOrActivate({ id, kind, title });
                  // Option B: if viewer was closed, this is the "browse → view" transition.
                  // Collapse the tree to give the viewer maximum width.
                  if (viewerCollapsed) {
                    setTreeCollapsed(true);
                    treePanelRef.current?.collapse();
                    treeAutoCollapsedRef.current = true;
                  }
                  setViewerCollapsed(false);
                  viewerPanelRef.current?.expand();
                }}
              />
            )}
          </div>
        </Panel>
        <Separator
          id="memory-explorer-sep-2"
          className="relative w-1 bg-transparent hover:bg-border/80 transition-colors cursor-col-resize"
        >
          <button
            type="button"
            title={viewerCollapsed ? "Open viewer" : "Close viewer"}
            aria-label={viewerCollapsed ? "Open viewer" : "Close viewer"}
            onClick={() => {
              if (viewerCollapsed) {
                setViewerCollapsed(false);
                viewerPanelRef.current?.expand();
              } else {
                setViewerCollapsed(true);
                viewerPanelRef.current?.collapse();
              }
            }}
            className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 z-30 hidden md:inline-flex size-[26px] items-center justify-center rounded-md border border-border-strong bg-card-2 text-very-dim shadow-[0_2px_6px_rgba(0,0,0,0.4)] transition-[background,color,border-color,transform] duration-[120ms] hover:scale-105 hover:border-brand hover:bg-card hover:text-text focus-visible:outline-none focus-visible:border-brand focus-visible:ring-[3px] focus-visible:ring-brand-focus-ring"
          >
            {viewerCollapsed
              ? <PanelRightOpen className="size-3.5" aria-hidden />
              : <PanelRightClose className="size-3.5" aria-hidden />}
          </button>
        </Separator>
        <Panel
          id="memory-explorer-viewer"
          defaultSize={isHomeSelected ? "25%" : "52%"}
          minSize="15%"
          collapsible
          collapsedSize="3%"
          panelRef={viewerPanelRef}
          onResize={(size) => setViewerCollapsed(size.asPercentage <= 4)}
        >
          <div className="h-full">
            {viewerCollapsed ? (
              <MemoryCollapsedTabStrip
                tabs={tabs}
                activeKey={activeKey}
                onActivate={(id, kind) => {
                  setActive(id, kind);
                  setViewerCollapsed(false);
                  viewerPanelRef.current?.expand();
                }}
              />
            ) : isHomeSelected ? (
              <div className="h-full" />
            ) : (
              <MemoryViewer
                companyId={selectedCompanyId}
                tabs={tabs}
                activeKey={activeKey}
                onActivate={setActive}
                onClose={close}
                folderPath={folderPath}
              />
            )}
          </div>
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
