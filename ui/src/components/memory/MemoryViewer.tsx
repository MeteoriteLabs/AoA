import { MarkdownItemViewer } from "./viewers/MarkdownItemViewer";
import { MemoryFolderSummary } from "./MemoryFolderSummary";
import { MemoryEmptyViewer } from "./MemoryEmptyViewer";

interface MemoryViewerProps {
  companyId: string;
  selectedItemId: string | null;
  selectedItemType: "memory_item" | "asset" | null;
  folderPath: string;
}

export function MemoryViewer({
  companyId,
  selectedItemId,
  selectedItemType,
  folderPath,
}: MemoryViewerProps) {
  if (selectedItemId && selectedItemType === "memory_item") {
    return <MarkdownItemViewer companyId={companyId} itemId={selectedItemId} />;
  }

  if (selectedItemId && selectedItemType === "asset") {
    return (
      <div className="h-full flex items-center justify-center text-xs text-muted-foreground p-6 text-center">
        File preview (PDF / image / video / PPTX) ships in a later slice. The
        backend already serves this asset&apos;s content at{" "}
        <code className="ml-1">/api/companies/&lt;cid&gt;/memory/assets/{selectedItemId}/content</code>.
      </div>
    );
  }

  if (folderPath) {
    return (
      <MemoryFolderSummary
        companyId={companyId}
        folderPath={folderPath}
        departmentId={null}
      />
    );
  }

  return <MemoryEmptyViewer />;
}
