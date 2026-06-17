import type { ArtifactWithVersions, ArtifactVersion, CreateArtifactVersion } from "@armyofagents/shared";
import { api } from "./client";

export const artifactsApi = {
  /** Get artifact linked to a task. Returns null (not 404) if none linked. */
  getByIssueId: (issueId: string) =>
    api.get<ArtifactWithVersions | null>(`/issues/${issueId}/artifacts`),

  /** Get artifact by ID with all versions (newest first). */
  get: (id: string) => api.get<ArtifactWithVersions>(`/artifacts/${id}`),

  /** Company-wide artifact list (newest first). Rows have no versions array. */
  listByCompany: (companyId: string) =>
    api.get<Array<{ id: string; title: string; type: string; status: string; currentVersionId: string | null; updatedAt: string }>>(
      `/companies/${companyId}/artifacts`,
    ),

  /** Add immutable version to artifact. */
  addVersion: (artifactId: string, data: CreateArtifactVersion) =>
    api.post<ArtifactVersion>(`/artifacts/${artifactId}/versions`, data),
};
