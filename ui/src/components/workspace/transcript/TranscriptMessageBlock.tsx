// ui/src/components/workspace/transcript/TranscriptMessageBlock.tsx

import { useState } from "react";
import { cn } from "@/lib/utils";
import { MarkdownBody } from "../../MarkdownBody";

interface TranscriptMessageBlockProps {
  role: "assistant" | "user";
  text: string;
  streaming: boolean;
  ts?: string;
  className?: string;
}

const MAX_COLLAPSED_LENGTH = 500;

export function TranscriptMessageBlock({
  role,
  text,
  streaming,
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
    <div className={cn("px-3 py-2", className)}>
      {ts && (
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] text-muted-foreground ml-auto">{new Date(ts).toLocaleTimeString()}</span>
          {streaming && <span className="text-xs text-blue-500 animate-pulse">typing...</span>}
        </div>
      )}
      {!ts && streaming && (
        <div className="mb-1">
          <span className="text-xs text-blue-500 animate-pulse">typing...</span>
        </div>
      )}
      <div className="text-sm">
        <MarkdownBody>{displayText}</MarkdownBody>
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
