/**
 * InlineArtifactCard — renders an entry's attachments inline.
 *
 * Each attachment is a small clickable card showing artifact type + title.
 * Used by EntryRow when an entry has attachments[]. Click → onOpen(artifactId).
 * Attachments without an artifactId (asset-only uploads) render with a generic
 * "File" label and a non-clickable presentation (the asset is still surfaced
 * elsewhere by the asset viewer).
 */
import { ExternalLink, FileText, FileCode2, Image as ImageIcon, FileBox, FileQuestion, Unlink } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DiscussionEntryAttachment } from "../../api/discussions";

interface InlineArtifactCardProps {
  attachments: DiscussionEntryAttachment[];
  onOpen?: (artifactId: string) => void;
  onOpenAsset?: (attachment: DiscussionEntryAttachment) => void;
  onRemove?: (attachment: DiscussionEntryAttachment) => void;
  isRemoving?: (attachmentId: string) => boolean;
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

function displayName(attachment: DiscussionEntryAttachment): string {
  return (
    attachment.artifactFilename ??
    attachment.assetFilename ??
    attachment.artifactTitle ??
    (attachment.assetId ? "Attached file" : "Artifact")
  );
}

function displayType(attachment: DiscussionEntryAttachment): string {
  return (
    attachment.artifactContentType ??
    attachment.assetContentType ??
    attachment.artifactType ??
    "file"
  );
}

export function InlineArtifactCard({
  attachments,
  onOpen,
  onOpenAsset,
  onRemove,
  isRemoving,
}: InlineArtifactCardProps) {
  if (attachments.length === 0) return null;
  return (
    <div
      className="flex flex-col gap-1.5"
      data-testid="inline-artifact-card"
    >
      {attachments.map((a) => {
        const Icon = iconFor(a.artifactType);
        const label = a.artifactType ? TYPE_LABEL[a.artifactType] ?? a.artifactType : "File";
        const title = displayName(a);
        const detail = displayType(a);
        const clickable = (!!a.artifactId && !!onOpen) || (!!a.assetId && !!onOpenAsset);
        const removing = isRemoving?.(a.id) ?? false;
        const className = cn(
          "flex min-w-0 items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-left",
          clickable && "hover:bg-muted/50 transition-colors cursor-pointer",
        );
        const inner = (
          <>
            <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm text-foreground">{title}</span>
              <span className="truncate text-[10px] text-muted-foreground/70">{detail}</span>
            </span>
            {a.artifactVersionNumber && (
              <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                v{a.artifactVersionNumber}
              </span>
            )}
            <span className="shrink-0 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground/70">
              {label}
            </span>
          </>
        );
        return (
          <div
            key={a.id}
            className="flex min-w-0 items-stretch gap-1"
            data-testid={`inline-artifact-card-${a.id}`}
          >
            {clickable ? (
              <button
                type="button"
                onClick={() => {
                  if (a.artifactId) onOpen?.(a.artifactId);
                  else if (a.assetId) onOpenAsset?.(a);
                }}
                className={cn(className, "flex-1")}
              >
                {inner}
              </button>
            ) : (
              <div className={cn(className, "flex-1")}>{inner}</div>
            )}
            {clickable && (
              <button
                type="button"
                onClick={() => {
                  if (a.artifactId) onOpen?.(a.artifactId);
                  else if (a.assetId) onOpenAsset?.(a);
                }}
                className="inline-flex w-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted/20 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                aria-label={`Open ${title}`}
                title="Open"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            )}
            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(a)}
                disabled={removing}
                className="inline-flex w-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted/20 text-muted-foreground hover:bg-muted/50 hover:text-foreground disabled:opacity-50"
                aria-label={`Remove ${title} from thread`}
                title="Remove from thread"
              >
                <Unlink className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
