import { Plus, Search, MessageSquare } from "lucide-react";
import { cn } from "../../lib/utils";
import type { ConversationRow } from "../../api/internal-agent";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "../ui/tooltip";

// Note: "desktop only" gating (responsive breakpoint) is handled in Task 11.
// For now this component is unconditionally the collapsed view.

export interface CollapsedSessionStripProps {
  conversations: ConversationRow[];
  activeConversationId: string | null;
  onSelect: (conversationId: string) => void;
  onExpand: () => void;
  onNewConversation: () => void;
}

export function CollapsedSessionStrip({
  conversations,
  activeConversationId,
  onSelect,
  onExpand,
  onNewConversation,
}: CollapsedSessionStripProps) {
  return (
    <TooltipProvider>
      <div className="flex flex-col items-center w-10 shrink-0 border-r border-border bg-secondary-sidebar py-2 gap-1.5">
        {/* + New chat — brand primary button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onNewConversation}
              className="w-7 h-7 flex items-center justify-center rounded-md bg-brand text-white hover:bg-brand-hover transition-colors shrink-0"
              aria-label="New chat"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={6}>
            New chat
          </TooltipContent>
        </Tooltip>

        {/* Search — ghost icon button; expands the sidebar to access search */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onExpand}
              className="w-7 h-7 flex items-center justify-center rounded-md border border-border text-very-dim hover:bg-hd hover:text-dim transition-colors shrink-0"
              aria-label="Search sessions"
            >
              <Search className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={6}>
            Search sessions
          </TooltipContent>
        </Tooltip>

        {/* Divider */}
        <div className="w-5 h-px bg-border shrink-0 my-0.5" />

        {/* Session icons — scrollable vertical stack */}
        <div className="flex-1 flex flex-col items-center gap-1.5 overflow-y-auto overflow-x-hidden min-h-0 w-full px-1.5">
          {conversations.map((conv) => {
            const isActive = conv.id === activeConversationId;
            return (
              <Tooltip key={conv.id}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => onSelect(conv.id)}
                    aria-label={conv.title ?? "Session"}
                    className={cn(
                      "relative w-7 h-7 flex items-center justify-center rounded-md transition-colors shrink-0",
                      isActive
                        ? "bg-brand/10 text-brand"
                        : "text-very-dim hover:bg-hd hover:text-dim",
                    )}
                  >
                    {/* Active session indicator bar on the left */}
                    {isActive && (
                      <span className="absolute left-[-6px] top-[6px] bottom-[6px] w-0.5 rounded-r bg-brand" />
                    )}
                    <MessageSquare className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={6}>
                  {conv.title ?? "Untitled session"}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        {/* Session count — mono, dimmed */}
        <div className="text-[0.65rem] font-mono text-very-dim shrink-0 pb-0.5">
          {conversations.length}
        </div>
      </div>
    </TooltipProvider>
  );
}
