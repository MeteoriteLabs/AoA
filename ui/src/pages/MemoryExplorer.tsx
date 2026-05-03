import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "@/lib/router";
import { Brain, PanelRightClose } from "lucide-react";
import { Group, Panel, Separator } from "react-resizable-panels";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { MemoryTree } from "../components/memory/MemoryTree";
import { MemoryFileList } from "../components/memory/MemoryFileList";
import { MemoryViewer } from "../components/memory/MemoryViewer";
import { MemoryUploadButton } from "../components/memory/MemoryUploadButton";
import { MemoryScopedSearch } from "../components/memory/MemoryScopedSearch";
import { MemoryHomeDashboard } from "../components/memory/MemoryHomeDashboard";
import { CollapsedRail } from "../components/memory/CollapsedRail";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { EmptyState } from "../components/EmptyState";

export function MemoryExplorer() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs, setEntityColor, setSubtitle } = useBreadcrumbs();
  const [searchParams] = useSearchParams();

  const folderPath = searchParams.get("folder") ?? "";
  const departmentId = searchParams.get("dept") ?? null;
  const layer = searchParams.get("layer");
  const goalId = searchParams.get("goal");
  const selectedItemId = searchParams.get("item");
  const selectedItemType = searchParams.get("type") as
    | "memory_item"
    | "asset"
    | null;

  // Phase 6.2a: synthetic Home selection — no folder, no dept, no layer, no item.
  const isHomeSelected =
    !folderPath && !departmentId && !layer && !selectedItemId;

  const [searchQuery, setSearchQuery] = useState("");

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
      {!isHomeSelected && (
        <div className="flex items-center justify-end gap-2 px-3 py-2 border-b border-border bg-card/30">
          <MemoryScopedSearch value={searchQuery} onChange={setSearchQuery} />
          <span className="flex-1" />
          <MemoryUploadButton
            companyId={selectedCompanyId}
            departmentId={departmentId}
            folderPath={folderPath}
          />
        </div>
      )}
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
            <CollapsedRail
              onExpand={() => treePanelRef.current?.expand()}
              direction="right"
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
              selectedItemId={selectedItemId}
              selectedItemType={selectedItemType}
              searchQuery={searchQuery}
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
            <CollapsedRail
              onExpand={() => viewerPanelRef.current?.expand()}
              direction="left"
            />
          ) : isHomeSelected ? (
            <div className="relative h-full flex items-center justify-center bg-muted/10 text-xs text-muted-foreground p-6 text-center">
              <button
                type="button"
                onClick={() => viewerPanelRef.current?.collapse()}
                className="absolute top-2 right-2 p-1 rounded hover:bg-accent/50"
                aria-label="Collapse viewer"
              >
                <PanelRightClose className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
              <div>
                <div className="text-2xl mb-2">📊</div>
                <div className="font-medium mb-1">Memory graph view</div>
                <div className="opacity-70">Coming soon</div>
              </div>
            </div>
          ) : (
            <MemoryViewer
              companyId={selectedCompanyId}
              selectedItemId={selectedItemId}
              selectedItemType={selectedItemType}
              folderPath={folderPath}
            />
          )}
        </Panel>
      </Group>
    </div>
  );
}
