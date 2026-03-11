import type { BriefStatus, BriefItemType, BriefItemStatus } from "../constants.js";

export interface Brief {
  id: string;
  companyId: string;
  debriefId: string;
  status: BriefStatus;
  departmentId: string | null;
  projectId: string | null;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BriefItem {
  id: string;
  briefId: string;
  type: BriefItemType;
  title: string;
  description: string | null;
  suggestedAssigneeId: string | null;
  suggestedPriority: string | null;
  suggestedDepartmentId: string | null;
  suggestedProjectId: string | null;
  status: BriefItemStatus;
  resultTaskId: string | null;
  resultMemoryId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
