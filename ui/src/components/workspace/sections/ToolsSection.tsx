import { GitBranch, Terminal } from "lucide-react";

interface ToolsSectionProps {
  functionType: string | null;
}

export function ToolsSection({ functionType }: ToolsSectionProps) {
  if (functionType === "software_development") {
    return (
      <div className="space-y-2 px-3" data-testid="tools-dev">
        <ToolPlaceholder icon={GitBranch} label="Git" />
        <ToolPlaceholder icon={Terminal} label="Terminal" />
      </div>
    );
  }

  return (
    <div className="px-3 py-2 text-xs text-muted-foreground" data-testid="tools-empty">
      No tools configured for this department type
    </div>
  );
}

function ToolPlaceholder({ icon: Icon, label }: { icon: typeof GitBranch; label: string }) {
  return (
    <div
      className="flex items-center gap-2 p-2 rounded-md border border-dashed border-muted-foreground/30"
      data-testid={`tool-placeholder-${label.toLowerCase()}`}
    >
      <Icon className="h-4 w-4 text-muted-foreground" />
      <div>
        <div className="text-sm">{label}</div>
        <div className="text-xs text-muted-foreground">Coming in Phase 4</div>
      </div>
    </div>
  );
}
