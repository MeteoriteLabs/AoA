export type SearchEntityType =
  | "task"
  | "goal"
  | "agent"
  | "brief"
  | "memory"
  | "artifact"
  | "suggestion";

export interface GlobalSearchResult {
  id: string;
  type: SearchEntityType;
  title: string;
  subtitle: string | null;
  href: string;
  score: number;
  identifier?: string | null;
  status?: string | null;
  role?: string | null;
  departmentName?: string | null;
  category?: string | null;
  layer?: string | null;
  visibility?: string | null;
  artifactType?: string | null;
  currentVersionNumber?: number | null;
  suggestionCategory?: string | null;
}

export interface GlobalSearchGroup {
  type: SearchEntityType;
  label: string;
  count: number;
  items: GlobalSearchResult[];
}

export interface GlobalSearchResponse {
  query: string;
  tookMs: number;
  totalCount: number;
  groups: GlobalSearchGroup[];
}
