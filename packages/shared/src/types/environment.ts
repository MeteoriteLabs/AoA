export interface Environment {
  id: string;
  companyId: string;
  name: string;
  envVars: Record<string, unknown>;
  connectionTarget: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}
