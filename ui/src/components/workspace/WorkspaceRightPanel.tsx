import { useState, useCallback } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { ChevronRight, Brain } from "lucide-react";
import { cn } from "@/lib/utils";
import { ArtifactsSection } from "./sections/ArtifactsSection";
import { ProcessSection } from "./sections/ProcessSection";
import { NotesSection } from "./sections/NotesSection";
import { ChangesContextSection } from "./sections/ChangesContextSection";
import { LogsContextSection } from "./sections/LogsContextSection";
import { PreviewContextSection } from "./sections/PreviewContextSection";
import { GitPanel } from "./tools/GitPanel";
import { TerminalPanel } from "./tools/TerminalPanel";
import type { PreviewMode } from "./WorkspacePreviewPanel";
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
  previewMode: PreviewMode | null;
  selectedFile?: string | null;
  onSelectFile?: (path: string) => void;
  onPreviewArtifact?: (artifact: ArtifactWithVersions, version: ArtifactVersion) => void;
}

interface SectionDef {
  name: string;
  label: string;
  defaultOpen: boolean;
}

const PERMANENT_SECTIONS: SectionDef[] = [
  { name: "artifacts", label: "Artifacts", defaultOpen: true },
  { name: "process", label: "Process", defaultOpen: true },
  { name: "memory", label: "Memory", defaultOpen: true },
  { name: "git", label: "Git", defaultOpen: true },
  { name: "terminal", label: "Terminal", defaultOpen: false },
  { name: "notes", label: "Notes", defaultOpen: true },
];

export function WorkspaceRightPanel({
  issueId,
  companyId,
  companyPrefix,
  workspace,
  functionType,
  previewMode,
  selectedFile,
  onSelectFile,
  onPreviewArtifact,
}: WorkspaceRightPanelProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    // Contextual section
    initial["contextual"] = loadExpanded("contextual", true);
    // Permanent sections
    for (const s of PERMANENT_SECTIONS) {
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

  // Determine contextual section label based on previewMode
  const contextualLabel =
    previewMode === "changes" ? "Changes" :
    previewMode === "logs" ? "Runs" :
    previewMode === "preview" ? "Preview" :
    null;

  const showTerminal = functionType === "software_development";

  return (
    <ScrollArea className="h-full" data-testid="workspace-right-panel-scroll">
      <div className="py-2 space-y-1" data-testid="workspace-right-sections">
        {/* ── Contextual top section (based on previewMode) ── */}
        {contextualLabel && (
          <Collapsible
            open={expanded["contextual"]}
            onOpenChange={() => toggle("contextual")}
            data-testid="section-contextual"
          >
            <CollapsibleTrigger className="flex items-center gap-1.5 w-full px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
              <ChevronRight
                className={cn(
                  "h-3.5 w-3.5 transition-transform",
                  expanded["contextual"] && "rotate-90",
                )}
              />
              {contextualLabel}
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="pb-2">
                {previewMode === "changes" && (
                  <ChangesContextSection
                    issueId={issueId}
                    workspaceId={workspace.id}
                    selectedFile={selectedFile}
                    onSelectFile={onSelectFile}
                  />
                )}
                {previewMode === "logs" && (
                  <LogsContextSection issueId={issueId} workspace={workspace} />
                )}
                {previewMode === "preview" && (
                  <PreviewContextSection
                    issueId={issueId}
                    workspaceId={workspace.id}
                    functionType={functionType}
                    onPreviewArtifact={onPreviewArtifact}
                  />
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* ── Permanent sections ── */}
        {PERMANENT_SECTIONS.map((section) => {
          // Skip git + terminal for non-software departments
          if ((section.name === "terminal" || section.name === "git") && !showTerminal) return null;

          return (
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
                  {section.name === "process" && (
                    <ProcessSection issueId={issueId} companyId={companyId} companyPrefix={companyPrefix} />
                  )}
                  {section.name === "git" && (
                    <div className="px-3">
                      <GitPanel workspace={workspace} />
                    </div>
                  )}
                  {section.name === "terminal" && (
                    <div className="px-3">
                      <TerminalPanel issueId={issueId} companyId={companyId} />
                    </div>
                  )}
                  {section.name === "memory" && (
                    <div
                      className="mx-3 p-3 rounded-md border border-dashed border-muted-foreground/30 flex items-start gap-2"
                      data-testid="memory-placeholder"
                    >
                      <Brain className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                      <div className="text-xs text-muted-foreground">
                        Memory integration coming soon — agent memory will appear here once configured
                      </div>
                    </div>
                  )}
                  {section.name === "notes" && (
                    <NotesSection workspaceId={workspace.id} />
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </div>
    </ScrollArea>
  );
}
