/**
 * InlineArtifactCard — renders an entry's attachments inline.
 *
 * Each attachment is a small clickable card showing artifact type + title.
 * Used by EntryRow when an entry has attachments[]. Click → onOpen(artifactId).
 * Attachments without an artifactId (asset-only uploads) render with a generic
 * "File" label and a non-clickable presentation (the asset is still surfaced
 * elsewhere by the asset viewer).
 */
import { FileText, FileCode2, Image as ImageIcon, FileBox, FileQuestion } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DiscussionEntryAttachment } from "../../api/discussions";

interface InlineArtifactCardProps {
  attachments: DiscussionEntryAttachment[];
  onOpen?: (attachment: DiscussionEntryAttachment) => void;
}

const TYPE_LABEL: Record<string, string> = {
  document: "Document",
  presentation: "Presentation",
  code: "Code",
  design: "Design",
  report: "Report",
  other: "Artifact",
};

function iconFor(type: string | null) {
  switch (type) {
    case "code":
      return FileCode2;
    case "design":
      return ImageIcon;
    case "document":
    case "report":
      return FileText;
    case "presentation":
      return FileBox;
    default:
      return FileQuestion;
  }
}

export function InlineArtifactCard({ attachments, onOpen }: InlineArtifactCardProps) {
  if (attachments.length === 0) return null;
  return (
    <div
      className="flex flex-col gap-1.5"
      data-testid="inline-artifact-card"
    >
      {attachments.map((a) => {
        const Icon = iconFor(a.artifactType);
        const label = a.artifactType ? TYPE_LABEL[a.artifactType] ?? a.artifactType : "File";
        const title = a.artifactTitle ?? a.assetOriginalFilename ?? (a.assetId ? "Attached file" : "Artifact");
        const clickable = (!!a.artifactId || !!a.assetId) && !!onOpen;
        const className = cn(
          "flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-left",
          clickable && "hover:bg-muted/50 transition-colors cursor-pointer",
        );
        const inner = (
          <>
            <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="flex-1 min-w-0 truncate text-sm text-foreground">{title}</span>
            <span className="shrink-0 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground/70">
              {label}
            </span>
          </>
        );
        if (clickable) {
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => onOpen!(a)}
              className={className}
              data-testid={`inline-artifact-card-${a.id}`}
            >
              {inner}
            </button>
          );
        }
        return (
          <div
            key={a.id}
            className={className}
            data-testid={`inline-artifact-card-${a.id}`}
          >
            {inner}
          </div>
        );
      })}
    </div>
  );
}
