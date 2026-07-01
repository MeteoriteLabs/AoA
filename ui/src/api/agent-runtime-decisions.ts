import type { RuntimeDecisionAnswerInput, RuntimeDecisionDetail } from "@armyofagents/shared";
import { api } from "./client";

export const agentRuntimeDecisionsApi = {
  detail: (companyId: string, decisionId: string) =>
    api.get<RuntimeDecisionDetail>(
      `/companies/${companyId}/agent-runtime-decisions/${decisionId}`,
    ),
  answer: (companyId: string, decisionId: string, payload: RuntimeDecisionAnswerInput) =>
    api.post<RuntimeDecisionDetail>(
      `/companies/${companyId}/agent-runtime-decisions/${decisionId}/answer`,
      payload,
    ),
};
