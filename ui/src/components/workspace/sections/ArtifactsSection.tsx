import { useQuery } from "@tanstack/react-query";
import { artifactsApi } from "../../../api/artifacts";
import { outputDetectionApi } from "../../../api/output-detection";
import { queryKeys } from "../../../lib/queryKeys";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { FileCode, FileText, Image, File, Package } from "lucide-react";
import type { ArtifactWithVersions, ArtifactVersion, ArtifactType, DetectedOutputForUI } from "@armyofagents/shared";

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

function retentionLabel(output: { assetId: string | null; status?: string | null }) {
  if (output.status === "confirmed") return "artifact";
  if (output.assetId) return "captured";
  return "live";
}

interface ArtifactsSectionProps {
  issueId: string;
  onPreviewArtifact?: (artifact: ArtifactWithVersions, version: ArtifactVersion) => void;
  onPreviewOutput?: (output: DetectedOutputForUI) => void;
}

export function ArtifactsSection({ issueId, onPreviewArtifact, onPreviewOutput }: ArtifactsSectionProps) {
  const { data: artifact, isLoading } = useQuery({
    queryKey: queryKeys.artifacts.byIssue(issueId),
    queryFn: () => artifactsApi.getByIssueId(issueId),
    staleTime: 5000,
  });

  const { data: detectedOutputs, isLoading: outputsLoading } = useQuery({
    queryKey: queryKeys.detectedOutputs.byIssue(issueId),
    queryFn: () => outputDetectionApi.listForIssue(issueId),
    staleTime: 5000,
  });

  if (isLoading) {
    return (
      <div className="px-3 space-y-2" data-testid="artifacts-skeleton">
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  const candidates = (detectedOutputs ?? []).filter((output) => output.status === "pending");

  if (!artifact && !outputsLoading && candidates.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-muted-foreground" data-testid="artifacts-empty">
        No artifacts yet
      </div>
    );
  }

  const latestVersion = artifact?.versions.length ? artifact.versions[0] : null;
  const Icon = artifact ? typeIcon(artifact.type) : File;

  return (
    <div className="max-w-full min-w-0 space-y-1 overflow-hidden" data-testid="artifacts-list">
      {artifact && (
        <button
          type="button"
          className="flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-2 text-left transition-colors hover:bg-accent/50"
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
      )}
      {candidates.map((output) => {
        const canPreview = Boolean(output.assetId && onPreviewOutput);
        const RowTag = canPreview ? "button" : "div";
        return (
        <RowTag
          key={`${output.runId}:${output.outputIndex}`}
          type={canPreview ? "button" : undefined}
          className="flex min-w-0 max-w-full items-center gap-2 overflow-hidden rounded-md px-1 py-2 text-left transition-colors hover:bg-accent/50 disabled:hover:bg-transparent"
          onClick={canPreview ? () => onPreviewOutput?.(output) : undefined}
          data-testid="artifact-candidate-row"
        >
          <File className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1 overflow-hidden">
            <div className="truncate text-sm">{output.filename}</div>
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden">
              <Badge variant="outline" className="h-4 px-1 text-[10px]">
                candidate
              </Badge>
              <Badge variant="outline" className="h-4 px-1 text-[10px]">
                {retentionLabel(output)}
              </Badge>
              <span className="min-w-0 truncate text-[10px] text-muted-foreground">
                {output.contentType}
              </span>
            </div>
          </div>
        </RowTag>
      );
      })}
    </div>
  );
}
