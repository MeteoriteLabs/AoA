import { useEffect } from "react";
import { useSearchParams } from "@/lib/router";
import { Brain } from "lucide-react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { MemoryTree } from "../components/memory/MemoryTree";
import { MemoryFileList } from "../components/memory/MemoryFileList";
import { MemoryViewer } from "../components/memory/MemoryViewer";
import { MemoryUploadButton } from "../components/memory/MemoryUploadButton";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { EmptyState } from "../components/EmptyState";

export function MemoryExplorer() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs, setEntityColor, setSubtitle } = useBreadcrumbs();
  const [searchParams] = useSearchParams();

  const folderPath = searchParams.get("folder") ?? "";
  const departmentId = searchParams.get("dept") ?? null;
  const selectedItemId = searchParams.get("item");
  const selectedItemType = searchParams.get("type") as
    | "memory_item"
    | "asset"
    | null;

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
      <div className="flex items-center justify-end gap-2 px-3 py-2 border-b border-border bg-card/30">
        <MemoryUploadButton
          companyId={selectedCompanyId}
          departmentId={departmentId}
          folderPath={folderPath}
        />
      </div>
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
          defaultSize={28}
          minSize="20%"
          maxSize="45%"
          className="border-r border-border"
        >
          <MemoryFileList
            companyId={selectedCompanyId}
            folderPath={folderPath}
            departmentId={departmentId}
            selectedItemId={selectedItemId}
            selectedItemType={selectedItemType}
          />
        </Panel>
        <Separator
          id="memory-explorer-sep-2"
          className="w-1 bg-transparent hover:bg-border/80 transition-colors cursor-col-resize"
        />
        <Panel
          id="memory-explorer-viewer"
          defaultSize={52}
          minSize="30%"
        >
          <MemoryViewer
            companyId={selectedCompanyId}
            selectedItemId={selectedItemId}
            selectedItemType={selectedItemType}
            folderPath={folderPath}
          />
        </Panel>
      </Group>
    </div>
  );
}
