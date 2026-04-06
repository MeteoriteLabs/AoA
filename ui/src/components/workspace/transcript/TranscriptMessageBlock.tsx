// ui/src/components/workspace/transcript/TranscriptMessageBlock.tsx

import { useState } from "react";
import { cn } from "@/lib/utils";
import { MarkdownBody } from "../../MarkdownBody";
import { Identity } from "../../Identity";

interface TranscriptMessageBlockProps {
  role: "assistant" | "user";
  text: string;
  streaming: boolean;
  agentName?: string;
  ts?: string;
  className?: string;
}

const MAX_COLLAPSED_LENGTH = 500;

export function TranscriptMessageBlock({
  role,
  text,
  streaming,
  agentName = "Agent",
  ts,
  className,
}: TranscriptMessageBlockProps) {
  const [showFull, setShowFull] = useState(false);
  const truncated = !showFull && text.length > MAX_COLLAPSED_LENGTH;
  const displayText = truncated ? text.slice(0, MAX_COLLAPSED_LENGTH) + "..." : text;

  if (role === "user") {
    return null; // User messages handled by TimelineUserMessage
  }

  return (
    <div className={cn("rounded-2xl rounded-tl-sm bg-card border border-border p-3", className)}>
      <div className="flex items-center gap-2 mb-2">
        <Identity name={agentName} size="xs" />
        <span className="text-xs text-muted-foreground">{agentName}</span>
        {ts && <span className="text-xs text-muted-foreground">·</span>}
        {ts && <span className="text-xs text-muted-foreground">{new Date(ts).toLocaleTimeString()}</span>}
        {streaming && <span className="text-xs text-blue-500 animate-pulse">typing...</span>}
      </div>
      <div className="text-sm">
        <MarkdownBody content={displayText} />
      </div>
      {truncated && (
        <button
          type="button"
          onClick={() => setShowFull(true)}
          className="text-xs text-primary hover:underline mt-1"
        >
          Show more
        </button>
      )}
    </div>
  );
}
