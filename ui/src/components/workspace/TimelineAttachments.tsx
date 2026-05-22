import { FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import type { IssueAttachment } from "@armyofagents/shared";

interface TimelineAttachmentsProps {
  attachments: IssueAttachment[];
  testId: string;
  className?: string;
}

export function TimelineAttachments({ attachments, testId, className }: TimelineAttachmentsProps) {
  if (attachments.length === 0) return null;

  return (
    <div className={cn("mt-2 flex flex-col gap-2 not-prose", className)} data-testid={testId}>
      {attachments.map((attachment) => {
        const label = attachment.originalFilename ?? "Attachment";
        const href = attachment.contentPath ?? "#";
        const isImage = attachment.contentType?.startsWith("image/");

        return (
          <a
            key={attachment.id}
            href={href}
            target="_blank"
            rel="noreferrer"
            className={cn(
              "group flex min-w-0 items-center gap-2 rounded-lg border border-border/70 bg-background/60 p-1.5 text-xs text-foreground no-underline transition-colors hover:bg-accent/20",
              isImage ? "max-w-72" : "max-w-full",
            )}
          >
            {isImage ? (
              <img
                src={href}
                alt={label}
                className="h-12 w-12 shrink-0 rounded-md border border-border object-cover"
              />
            ) : (
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
                <FileText className="h-3.5 w-3.5" />
                <span className="sr-only">file</span>
              </span>
            )}
            <span className="min-w-0 truncate">{label}</span>
          </a>
        );
      })}
    </div>
  );
}
