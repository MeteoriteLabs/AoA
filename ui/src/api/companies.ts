import type {
  Company,
  CompanyPortabilityExportResult,
  CompanyPortabilityImportRequest,
  CompanyPortabilityImportResult,
  CompanyPortabilityPreviewRequest,
  CompanyPortabilityPreviewResult,
} from "@armyofagents/shared";
import { api } from "./client";

export type CompanyStats = Record<
  string,
  {
    agentCount: number;
    issueCount: number;
    pendingApprovalCount: number;
    unreadNotificationCount: number;
  }
>;

export const companiesApi = {
  list: () => api.get<Company[]>("/companies"),
  get: (companyId: string) => api.get<Company>(`/companies/${companyId}`),
  stats: () => api.get<CompanyStats>("/companies/stats"),
  // Phase 1 Phase E batch 2 (T20): OnboardingWizard now collects Commander +
  // Crew adapter picks at company-create time. Both are optional — when
  // omitted the server falls back to legacy defaults (empty objects).
  // Schema contracts: see CommanderAdapterConfigSchema / CrewAdapterConfigSchema
  // in packages/shared/src/api/threads-contract.ts.
  create: (data: {
    name: string;
    description?: string | null;
    budgetMonthlyCents?: number;
    commanderAdapterConfig?: { adapter: string; model: string };
    crewAdapterConfig?: {
      default?: { adapter: string; model: string };
      perAgent?: Record<string, { adapter: string; model: string }>;
    };
  }) => api.post<Company>("/companies", data),
  update: (
    companyId: string,
    data: Partial<
      Pick<
        Company,
        "name" | "description" | "status" | "budgetMonthlyCents" | "requireBoardApprovalForNewAgents" | "brandColor" | "vision" | "mission" | "values" | "mcpEnabled" | "rootFolder"
      >
    >,
  ) => api.patch<Company>(`/companies/${companyId}`, data),
  archive: (companyId: string) => api.post<Company>(`/companies/${companyId}/archive`, {}),
  remove: (companyId: string) => api.delete<{ ok: true }>(`/companies/${companyId}`),
  exportBundle: (companyId: string, data: { include?: { company?: boolean; agents?: boolean } }) =>
    api.post<CompanyPortabilityExportResult>(`/companies/${companyId}/export`, data),
  importPreview: (data: CompanyPortabilityPreviewRequest) =>
    api.post<CompanyPortabilityPreviewResult>("/companies/import/preview", data),
  importBundle: (data: CompanyPortabilityImportRequest) =>
    api.post<CompanyPortabilityImportResult>("/companies/import", data),
  uploadLogo: (companyId: string, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return api.postForm<{ logoAssetId: string; logoUrl: string }>(
      `/companies/${companyId}/logo`,
      formData,
    );
  },
  removeLogo: (companyId: string) =>
    api.delete<{ ok: true }>(`/companies/${companyId}/logo`),
};
