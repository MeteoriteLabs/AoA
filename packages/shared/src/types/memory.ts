import type { MemoryItemCategory, MemoryItemSource, MemoryItemStatus } from "../constants.js";

export interface MemoryItem {
  id: string;
  companyId: string;
  title: string;
  content: string;
  category: MemoryItemCategory;
  source: MemoryItemSource;
  status: MemoryItemStatus;
  tags: string[] | null;
  departmentId: string | null;
  projectId: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}
