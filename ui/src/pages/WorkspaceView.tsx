import { useEffect, useState } from "react";
import { useParams, useNavigate } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { executionWorkspacesApi } from "../api/execution-workspaces";
import { issuesApi } from "../api/issues";
import { projectsApi } from "../api/projects";
import { queryKeys } from "../lib/queryKeys";
import { WorkspaceLayout } from "../components/workspace/WorkspaceLayout";
import { PageSkeleton } from "../components/PageSkeleton";

export function WorkspaceView() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const { selectedCompanyId, selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const navigate = useNavigate();
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);

  const { data: workspace, isLoading: wsLoading } = useQuery({
    queryKey: queryKeys.executionWorkspaces.detail(workspaceId!),
    queryFn: () => executionWorkspacesApi.get(workspaceId!),
    enabled: !!workspaceId,
  });

  const { data: issue } = useQuery({
    queryKey: queryKeys.issues.detail(workspace?.sourceIssueId ?? ""),
    queryFn: () => issuesApi.get(workspace!.sourceIssueId!),
    enabled: !!workspace?.sourceIssueId,
  });

  const { data: project } = useQuery({
    queryKey: queryKeys.projects.detail(workspace?.projectId ?? ""),
    queryFn: () => projectsApi.get(workspace!.projectId),
    enabled: !!workspace?.projectId,
  });

  // Set the active issue to the workspace's source issue on load
  useEffect(() => {
    if (workspace?.sourceIssueId && !selectedIssueId) {
      setSelectedIssueId(workspace.sourceIssueId);
    }
  }, [workspace?.sourceIssueId, selectedIssueId]);

  useEffect(() => {
    if (workspace && project) {
      setBreadcrumbs([
        { label: project.name, href: `/${selectedCompany?.issuePrefix}/projects/${project.id}` },
        { label: issue?.identifier ?? workspace.name, href: "" },
        { label: "Workspace" },
      ]);
    } else {
      setBreadcrumbs([{ label: "Workspace" }]);
    }
  }, [workspace, project, issue, selectedCompany?.issuePrefix, setBreadcrumbs]);

  if (wsLoading) {
    return <PageSkeleton />;
  }

  if (!workspace) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Workspace not found
      </div>
    );
  }

  return (
    <WorkspaceLayout
      workspace={workspace}
      project={project ?? null}
      selectedIssueId={selectedIssueId}
      onSelectIssue={setSelectedIssueId}
      companyId={selectedCompanyId!}
      companyPrefix={selectedCompany?.issuePrefix ?? ""}
      onBack={() => {
        if (project) {
          navigate(`/${selectedCompany?.issuePrefix}/projects/${project.id}/workspaces`);
        } else {
          navigate(-1);
        }
      }}
    />
  );
}
