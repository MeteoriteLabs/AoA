import { useEffect, useState } from "react";
import { useSearchParams } from "@/lib/router";
import { Brain } from "lucide-react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { MemoryTree } from "../components/memory/MemoryTree";
import { MemoryFileList } from "../components/memory/MemoryFileList";
import { MemoryViewer } from "../components/memory/MemoryViewer";
import { MemoryUploadButton } from "../components/memory/MemoryUploadButton";
import { MemoryScopedSearch } from "../components/memory/MemoryScopedSearch";
import { MemoryHomeDashboard } from "../components/memory/MemoryHomeDashboard";
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
  const selectedItemId = searchParams.get("item");
  const selectedItemType = searchParams.get("type") as
    | "memory_item"
    | "asset"
    | null;

  // Phase 6.2a: synthetic Home selection — no folder, no dept, no layer, no item.
  const isHomeSelected =
    !folderPath && !departmentId && !layer && !selectedItemId;

  const [searchQuery, setSearchQuery] = useState("");

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
          className="border-r border-border"
        >
          <MemoryTree
            companyId={selectedCompanyId}
            selectedFolderPath={folderPath}
            selectedDepartmentId={departmentId}
          />
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
          minSize="20%"
        >
          {isHomeSelected ? (
            <div className="h-full flex items-center justify-center bg-muted/10 text-xs text-muted-foreground p-6 text-center">
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
