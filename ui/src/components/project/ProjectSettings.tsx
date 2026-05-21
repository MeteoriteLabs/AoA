import type React from "react";
import type { Project } from "@armyofagents/shared";
import { WorkspaceRuntimeSettings } from "./WorkspaceRuntimeSettings";

interface ProjectSettingsProps {
  project: Project;
  onUpdate?: (data: Record<string, unknown>) => void;
  environmentContent?: React.ReactNode;
}

export function ProjectSettings({ project, onUpdate, environmentContent }: ProjectSettingsProps) {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 pt-2" data-testid="project-settings">
      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-foreground">Workspace & Runtime</h2>
          <p className="text-sm text-muted-foreground">
            Defaults for new tasks and future agent runs. Existing workspaces are not moved by these settings.
          </p>
        </div>
        <WorkspaceRuntimeSettings project={project} onUpdate={onUpdate} />
      </section>
      {environmentContent && (
        <section className="space-y-4">
          {environmentContent}
        </section>
      )}
    </div>
  );
}
