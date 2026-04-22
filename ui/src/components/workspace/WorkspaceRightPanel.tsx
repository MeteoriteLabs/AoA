import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import {
  Brain,
  ChevronRight,
  FileBox,
  GitBranch,
  PanelRight,
  PanelRightClose,
  Server,
  StickyNote,
  Terminal as TerminalIcon,
  Workflow,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ArtifactsSection } from "./sections/ArtifactsSection";
import { ProcessSection } from "./sections/ProcessSection";
import { ServicesSection } from "./sections/ServicesSection";
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
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onExpandAndShowSection?: (sectionName: string) => void;
  openSection?: { section: string; nonce: number } | null;
}

interface SectionDef {
  name: string;
  label: string;
  defaultOpen: boolean;
  icon: LucideIcon;
  requiresFunctionType?: string;
}

const PERMANENT_SECTIONS: SectionDef[] = [
  { name: "artifacts", label: "Artifacts", defaultOpen: true, icon: FileBox },
  { name: "process", label: "Process", defaultOpen: true, icon: Workflow },
  { name: "services", label: "Services", defaultOpen: false, icon: Server, requiresFunctionType: "software_development" },
  { name: "memory", label: "Memory", defaultOpen: true, icon: Brain },
  { name: "git", label: "Git", defaultOpen: true, icon: GitBranch, requiresFunctionType: "software_development" },
  { name: "terminal", label: "Terminal", defaultOpen: false, icon: TerminalIcon, requiresFunctionType: "software_development" },
  { name: "notes", label: "Notes", defaultOpen: true, icon: StickyNote },
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
  collapsed = false,
  onToggleCollapse,
  onExpandAndShowSection,
  openSection,
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

  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const toggle = useCallback((name: string) => {
    setExpanded((prev) => {
      const next = !prev[name];
      saveExpanded(name, next);
      return { ...prev, [name]: next };
    });
  }, []);

  // When parent requests opening a section (from collapsed-rail click), force-open + scroll
  useEffect(() => {
    if (!openSection || collapsed) return;
    const name = openSection.section;
    setExpanded((prev) => {
      if (prev[name]) return prev;
      saveExpanded(name, true);
      return { ...prev, [name]: true };
    });
    requestAnimationFrame(() => {
      const el = sectionRefs.current[name];
      if (el && typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }, [openSection, collapsed]);

  // Determine contextual section label based on previewMode
  const contextualLabel =
    previewMode === "changes" ? "Changes" :
    previewMode === "logs" ? "Runs" :
    previewMode === "preview" ? "Preview" :
    null;

  // ── Collapsed icon rail ──
  if (collapsed) {
    return (
      <div
        className="flex flex-col h-full items-end py-2 gap-1"
        data-testid="workspace-right-panel-collapsed"
      >
        <button
          type="button"
          onClick={onToggleCollapse}
          title="Expand context"
          className="flex items-center justify-center w-9 h-9 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          data-testid="workspace-right-panel-expand"
          aria-label="Expand context panel"
        >
          <PanelRight className="h-4 w-4" />
        </button>

        <div className="w-6 h-px bg-border my-1" />

        {PERMANENT_SECTIONS.map((section) => {
          if (section.requiresFunctionType && section.requiresFunctionType !== functionType) return null;
          const Icon = section.icon;
          return (
            <button
              key={section.name}
              type="button"
              onClick={() => onExpandAndShowSection?.(section.name)}
              title={section.label}
              className="flex items-center justify-center w-9 h-9 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              data-testid={`workspace-rail-section-${section.name}`}
              aria-label={section.label}
            >
              <Icon className="h-4 w-4" />
            </button>
          );
        })}
      </div>
    );
  }

  // ── Expanded panel ──
  return (
    <div className="flex flex-col h-full" data-testid="workspace-right-panel-expanded">
      {onToggleCollapse && (
        <div
          className="flex items-center justify-end px-2 py-1 border-b border-border shrink-0"
          data-testid="workspace-right-panel-header"
        >
          <button
            type="button"
            onClick={onToggleCollapse}
            title="Collapse context"
            className="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            data-testid="workspace-right-panel-collapse"
            aria-label="Collapse context panel"
          >
            <PanelRightClose className="h-4 w-4" />
          </button>
        </div>
      )}
      <ScrollArea className="flex-1 min-h-0" data-testid="workspace-right-panel-scroll">
        <div className="py-2" data-testid="workspace-right-sections">
          {/* ── Contextual top section (based on previewMode) — unchanged ── */}
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

          {/* ── Permanent sections (card style) ── */}
          <div className="px-2 space-y-2">
          {PERMANENT_SECTIONS.map((section) => {
            // Skip sections that require a specific functionType
            if (section.requiresFunctionType && section.requiresFunctionType !== functionType) return null;

            const SectionIcon = section.icon;
            const isOpen = expanded[section.name];

            return (
              <div
                key={section.name}
                ref={(el) => {
                  sectionRefs.current[section.name] = el;
                }}
                className="border border-border rounded-md overflow-hidden bg-background"
              >
                <Collapsible
                  open={isOpen}
                  onOpenChange={() => toggle(section.name)}
                  data-testid={`section-${section.name}`}
                >
                  <CollapsibleTrigger className="flex items-center gap-2 w-full px-3 py-2 text-xs font-medium text-foreground hover:bg-muted/50 transition-colors">
                    <SectionIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="flex-1 text-left">{section.label}</span>
                    <ChevronRight
                      className={cn(
                        "h-3.5 w-3.5 text-muted-foreground transition-transform",
                        isOpen && "rotate-90",
                      )}
                    />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="border-t border-border py-2">
                      {section.name === "artifacts" && (
                        <ArtifactsSection issueId={issueId} onPreviewArtifact={onPreviewArtifact} />
                      )}
                      {section.name === "process" && (
                        <ProcessSection issueId={issueId} companyId={companyId} companyPrefix={companyPrefix} />
                      )}
                      {section.name === "services" && (
                        <ServicesSection workspace={workspace} />
                      )}
                      {section.name === "git" && (
                        <div className="px-3">
                          <GitPanel workspace={workspace} issueId={issueId} />
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
              </div>
            );
          })}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
