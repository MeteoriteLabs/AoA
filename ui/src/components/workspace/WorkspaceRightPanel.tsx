import { useState, useCallback } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { ArtifactsSection } from "./sections/ArtifactsSection";
import { ContextSection } from "./sections/ContextSection";
import { ProcessSection } from "./sections/ProcessSection";
import { ToolsSection } from "./sections/ToolsSection";
import { NotesSection } from "./sections/NotesSection";
import type { ArtifactWithVersions, ArtifactVersion, ExecutionWorkspace } from "@paperclipai/shared";

function sectionKey(name: string) {
  return `aoa:workspace:section:${name}`;
}

function loadExpanded(name: string, defaultOpen = true): boolean {
  try {
    const stored = localStorage.getItem(sectionKey(name));
    return stored !== null ? stored === "true" : defaultOpen;
  } catch {
    return defaultOpen;
  }
}

function saveExpanded(name: string, open: boolean) {
  try {
    localStorage.setItem(sectionKey(name), String(open));
  } catch {
    // ignore
  }
}

interface WorkspaceRightPanelProps {
  issueId: string;
  companyId: string;
  companyPrefix: string;
  workspace: ExecutionWorkspace;
  functionType: string | null;
  onPreviewArtifact?: (artifact: ArtifactWithVersions, version: ArtifactVersion) => void;
}

interface SectionDef {
  name: string;
  label: string;
  defaultOpen: boolean;
}

const SECTIONS: SectionDef[] = [
  { name: "artifacts", label: "Artifacts", defaultOpen: true },
  { name: "context", label: "Context", defaultOpen: true },
  { name: "process", label: "Process", defaultOpen: true },
  { name: "tools", label: "Tools", defaultOpen: false },
  { name: "notes", label: "Notes", defaultOpen: true },
];

export function WorkspaceRightPanel({
  issueId,
  companyId,
  companyPrefix,
  workspace,
  functionType,
  onPreviewArtifact,
}: WorkspaceRightPanelProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const s of SECTIONS) {
      initial[s.name] = loadExpanded(s.name, s.defaultOpen);
    }
    return initial;
  });

  const toggle = useCallback((name: string) => {
    setExpanded((prev) => {
      const next = !prev[name];
      saveExpanded(name, next);
      return { ...prev, [name]: next };
    });
  }, []);

  return (
    <ScrollArea className="h-full" data-testid="workspace-right-panel-scroll">
      <div className="py-2 space-y-1" data-testid="workspace-right-sections">
        {SECTIONS.map((section) => (
          <Collapsible
            key={section.name}
            open={expanded[section.name]}
            onOpenChange={() => toggle(section.name)}
            data-testid={`section-${section.name}`}
          >
            <CollapsibleTrigger className="flex items-center gap-1.5 w-full px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
              <ChevronRight
                className={cn(
                  "h-3.5 w-3.5 transition-transform",
                  expanded[section.name] && "rotate-90",
                )}
              />
              {section.label}
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="pb-2">
                {section.name === "artifacts" && (
                  <ArtifactsSection issueId={issueId} onPreviewArtifact={onPreviewArtifact} />
                )}
                {section.name === "context" && (
                  <ContextSection issueId={issueId} companyId={companyId} />
                )}
                {section.name === "process" && (
                  <ProcessSection issueId={issueId} companyId={companyId} companyPrefix={companyPrefix} />
                )}
                {section.name === "tools" && (
                  <ToolsSection
                    functionType={functionType}
                    workspace={workspace}
                    issueId={issueId}
                    companyId={companyId}
                  />
                )}
                {section.name === "notes" && (
                  <NotesSection workspaceId={workspace.id} />
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        ))}
      </div>
    </ScrollArea>
  );
}
