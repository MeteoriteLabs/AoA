import { useQuery } from "@tanstack/react-query";
import { artifactsApi } from "../../../api/artifacts";
import { queryKeys } from "../../../lib/queryKeys";
import { Badge } from "@/components/ui/badge";
import { FileCode, FileText, Image, File, Package } from "lucide-react";
import type { ArtifactWithVersions, ArtifactVersion, ArtifactType } from "@paperclipai/shared";

function typeIcon(type: ArtifactType) {
  switch (type) {
    case "code":
      return FileCode;
    case "document":
    case "report":
      return FileText;
    case "design":
      return Image;
    case "presentation":
      return Package;
    default:
      return File;
  }
}

interface ArtifactsSectionProps {
  issueId: string;
  onPreviewArtifact?: (artifact: ArtifactWithVersions, version: ArtifactVersion) => void;
}

export function ArtifactsSection({ issueId, onPreviewArtifact }: ArtifactsSectionProps) {
  const { data: artifact, isLoading } = useQuery({
    queryKey: queryKeys.artifacts.byIssue(issueId),
    queryFn: () => artifactsApi.getByIssueId(issueId),
  });

  if (isLoading) {
    return <div className="px-3 py-2 text-xs text-muted-foreground">Loading...</div>;
  }

  if (!artifact) {
    return (
      <div className="px-3 py-2 text-xs text-muted-foreground" data-testid="artifacts-empty">
        No artifacts linked
      </div>
    );
  }

  const latestVersion = artifact.versions.length > 0 ? artifact.versions[0] : null;
  const Icon = typeIcon(artifact.type);

  return (
    <div className="space-y-1" data-testid="artifacts-list">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2 rounded-md hover:bg-accent/50 text-left transition-colors"
        onClick={() => {
          if (latestVersion && onPreviewArtifact) {
            onPreviewArtifact(artifact, latestVersion);
          }
        }}
        data-testid="artifact-row"
      >
        <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm truncate">{artifact.title}</div>
          <div className="flex items-center gap-1.5 mt-0.5">
            {latestVersion && (
              <>
                <span className="text-xs text-muted-foreground">v{latestVersion.versionNumber}</span>
                <Badge variant="outline" className="text-[10px] h-4 px-1">
                  {latestVersion.source}
                </Badge>
              </>
            )}
          </div>
        </div>
      </button>
    </div>
  );
}
