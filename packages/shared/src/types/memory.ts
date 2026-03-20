import type {
  MemoryItemCategory,
  MemoryItemSource,
  MemoryItemStatus,
  MemoryItemLayer,
  MemoryItemVisibility,
} from "../constants.js";

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
  // V2 fields
  layer: MemoryItemLayer | null;
  priority: number;
  visibility: MemoryItemVisibility;
  expiresAt: Date | null;
  goalId: string | null;
  taskId: string | null;
  sourceArtifactId: string | null;
  sourceContext: string | null;
  accessedAt: Date | null;
  currentVersionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
