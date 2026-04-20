import type { CompanyStatus } from "../constants.js";

export interface Company {
  id: string;
  name: string;
  description: string | null;
  status: CompanyStatus;
  issuePrefix: string;
  issueCounter: number;
  budgetMonthlyCents: number;
  spentMonthlyCents: number;
  requireBoardApprovalForNewAgents: boolean;
  vision: string | null;
  mission: string | null;
  values: string | null;
  brandColor: string | null;
  logoAssetId: string | null;
  rootFolder: string | null;
  mcpEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}
