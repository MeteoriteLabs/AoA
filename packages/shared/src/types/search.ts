import type {
  MemoryItemCategory,
  MemoryItemLayer,
  SearchEntityType,
} from "../constants.js";

export interface SearchResult {
  id: string;
  entityType: SearchEntityType;
  title: string;
  subtitle: string | null;
  score: number;
  identifier: string | null;
  status: string | null;
  role: string | null;
  layer: MemoryItemLayer | null;
  category: MemoryItemCategory | null;
  departmentId: string | null;
  departmentName: string | null;
  updatedAt: Date;
}

export interface SearchResultsGrouped {
  tasks: SearchResult[];
  goals: SearchResult[];
  agents: SearchResult[];
  memory: SearchResult[];
}
