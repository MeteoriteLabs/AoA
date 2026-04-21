import type {
  CompanyPortabilityExportPreviewResult,
  CompanyPortabilityExportResult,
  CompanyPortabilityInclude,
} from "@paperclipai/shared";
import { api } from "./client";

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
};
