import type {
  CompanyPortabilityExportPreviewResult,
  CompanyPortabilityExportResult,
  CompanyPortabilityImportRequest,
  CompanyPortabilityImportResult,
  CompanyPortabilityInclude,
  CompanyPortabilityPreviewRequest,
  CompanyPortabilityPreviewResult,
} from "@armyofagents/shared";
import { api } from "./client";

export function companyImportPath(
  request: CompanyPortabilityPreviewRequest,
  preview: boolean,
): string {
  const suffix = preview ? "/preview" : "";
  return request.target.mode === "new_company"
    ? `/companies/import/new${suffix}`
    : `/companies/${encodeURIComponent(request.target.companyId)}/import${suffix}`;
}

export const companyPortabilityApi = {
  previewExport: (companyId: string, include: CompanyPortabilityInclude) =>
    api.post<CompanyPortabilityExportPreviewResult>(
      `/companies/${companyId}/export/preview`,
      { include },
    ),
  exportBundle: (companyId: string, include: CompanyPortabilityInclude) =>
    api.post<CompanyPortabilityExportResult>(
      `/companies/${companyId}/export`,
      { include },
    ),
  previewImport: (request: CompanyPortabilityPreviewRequest) =>
    api.post<CompanyPortabilityPreviewResult>(
      companyImportPath(request, true),
      request,
    ),
  importBundle: (request: CompanyPortabilityImportRequest) =>
    api.post<CompanyPortabilityImportResult>(
      companyImportPath(request, false),
      request,
    ),
};
