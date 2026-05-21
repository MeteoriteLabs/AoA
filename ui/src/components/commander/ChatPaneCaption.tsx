import { PanelLeft } from "lucide-react";
import { timeAgo } from "../../lib/timeAgo";

interface ChatPaneCaptionProps {
  title: string;
  messageCount: number;
  updatedAt?: string;
  onOpenSessions?: () => void;
}

export function ChatPaneCaption({
  title,
  messageCount,
  updatedAt,
  onOpenSessions,
}: ChatPaneCaptionProps) {
  const relTime = updatedAt ? timeAgo(updatedAt) : null;

  return (
    <div className="h-11 flex items-center gap-2 px-5 border-b border-border-soft bg-bg shrink-0">
      {/* Mobile: Sessions button (drawer wired in Task 11) */}
      <button
        type="button"
        onClick={onOpenSessions}
        className="md:hidden p-1 rounded text-dim hover:bg-hd hover:text-text transition-colors shrink-0"
        aria-label="Open sessions"
      >
        <PanelLeft className="h-4 w-4" />
      </button>

      {/* Title + meta */}
      <div className="flex flex-col justify-center min-w-0 flex-1">
        <span className="text-[0.95rem] font-semibold leading-tight truncate text-text">
          {title}
        </span>
        <span className="text-[0.7rem] text-dim leading-tight">
          {relTime && (
            <>
              <span>{relTime}</span>
              <span className="mx-1 text-very-dim">·</span>
            </>
          )}
          <span className="font-mono">{messageCount}</span>
          <span> msgs</span>
        </span>
      </div>
    </div>
  );
}
