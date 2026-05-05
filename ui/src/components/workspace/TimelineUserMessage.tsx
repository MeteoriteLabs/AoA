import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Identity } from "../Identity";
import { cn, relativeTime } from "@/lib/utils";
import type { IssueComment } from "@armyofagents/shared";

interface TimelineUserMessageProps {
  comment: IssueComment;
  authorName: string;
  isAgent?: boolean;
}

export function TimelineUserMessage({ comment, authorName, isAgent = false }: TimelineUserMessageProps) {
  return (
    <div
      className={cn("max-w-[80%]", isAgent ? "mr-auto" : "ml-auto")}
      data-testid={`timeline-comment-${comment.id}`}
    >
      <div
        className={cn(
          "rounded-2xl px-3 py-2 text-sm prose prose-sm dark:prose-invert max-w-none overflow-x-auto prose-p:my-1 prose-headings:my-2 prose-pre:my-1",
          isAgent ? "bg-muted/20" : "bg-primary/10",
        )}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{comment.body}</ReactMarkdown>
        <div className={cn("flex items-center gap-1.5 mt-1 not-prose", isAgent ? "justify-start" : "justify-end")}>
          <Identity name={authorName} size="xs" />
          <span className="text-[10px] text-muted-foreground">{authorName}</span>
          <span className="text-[10px] text-muted-foreground">·</span>
          <span className="text-[10px] text-muted-foreground">{relativeTime(comment.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}
