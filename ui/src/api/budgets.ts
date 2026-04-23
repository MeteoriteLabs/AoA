import type { BudgetOverview, UpsertBudgetPolicyInput, ResolveBudgetIncidentInput } from "@armyofagents/shared";
import { api } from "./client";

export const budgetsApi = {
  overview: (companyId: string) =>
    api.get<BudgetOverview>(`/companies/${companyId}/budgets/overview`),

  upsertPolicy: (companyId: string, input: UpsertBudgetPolicyInput) =>
    api.post<{ id: string }>(`/companies/${companyId}/budgets/policies`, input),

  resolveIncident: (companyId: string, incidentId: string, input: ResolveBudgetIncidentInput) =>
    api.post<{ ok: boolean }>(`/companies/${companyId}/budget-incidents/${incidentId}/resolve`, input),
};
