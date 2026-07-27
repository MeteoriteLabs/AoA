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

function importPath(
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
      importPath(request, true),
      request,
    ),
  importBundle: (request: CompanyPortabilityImportRequest) =>
    api.post<CompanyPortabilityImportResult>(
      importPath(request, false),
      request,
    ),
};
