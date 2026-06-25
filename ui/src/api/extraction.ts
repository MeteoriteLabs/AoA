import type { ExtractionEngineStatusResponse } from "@armyofagents/shared";
import { api } from "./client";

export const extractionApi = {
  /**
   * Probe which extraction engine is active for this company.
   * GET /api/companies/:companyId/extraction/engine-status
   */
  engineStatus: (companyId: string) =>
    api.get<ExtractionEngineStatusResponse>(
      `/companies/${companyId}/extraction/engine-status`,
    ),
};
