import { useState } from "react";
import { GitBranch, Terminal, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ExecutionWorkspace } from "@paperclipai/shared";
import { GitPanel } from "../tools/GitPanel";
import { TerminalPanel } from "../tools/TerminalPanel";

interface ToolsSectionProps {
  functionType: string | null;
  workspace?: ExecutionWorkspace;
  issueId?: string;
  companyId?: string;
}

export function ToolsSection({ functionType, workspace, issueId, companyId }: ToolsSectionProps) {
  const [gitOpen, setGitOpen] = useState(true);
  const [terminalOpen, setTerminalOpen] = useState(true);

  if (functionType !== "software_development") {
    return (
      <div className="px-3 py-2 text-xs text-muted-foreground" data-testid="tools-empty">
        No tools configured for this department type
      </div>
    );
  }

  return (
    <div className="space-y-1 px-3" data-testid="tools-dev">
      {/* Git sub-section */}
      <div>
        <button
          onClick={() => setGitOpen(!gitOpen)}
          className="flex items-center gap-1.5 w-full py-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          data-testid="git-toggle"
        >
          <ChevronRight className={cn("h-3 w-3 transition-transform", gitOpen && "rotate-90")} />
          <GitBranch className="h-3.5 w-3.5" />
          Git
        </button>
        {gitOpen && workspace && (
          <div className="ml-5 pb-2">
            <GitPanel workspace={workspace} />
          </div>
        )}
      </div>

      {/* Terminal sub-section */}
      <div>
        <button
          onClick={() => setTerminalOpen(!terminalOpen)}
          className="flex items-center gap-1.5 w-full py-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          data-testid="terminal-toggle"
        >
          <ChevronRight className={cn("h-3 w-3 transition-transform", terminalOpen && "rotate-90")} />
          <Terminal className="h-3.5 w-3.5" />
          Terminal
        </button>
        {terminalOpen && issueId && companyId && (
          <div className="pb-2">
            <TerminalPanel issueId={issueId} companyId={companyId} />
          </div>
        )}
      </div>
    </div>
  );
}
