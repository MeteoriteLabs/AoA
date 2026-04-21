export interface CompanyPortabilityInclude {
  company: boolean;
  agents: boolean;
  projects: boolean;
  issues: boolean;
}

export interface CompanyPortabilitySecretRequirement {
  key: string;
  description: string | null;
  agentSlug: string | null;
  providerHint: string | null;
}

export interface CompanyPortabilityCompanyManifestEntry {
  path: string;
  name: string;
  description: string | null;
  brandColor: string | null;
  requireBoardApprovalForNewAgents: boolean;
}

export interface CompanyPortabilityAgentManifestEntry {
  slug: string;
  name: string;
  path: string;
  role: string;
  title: string | null;
  icon: string | null;
  capabilities: string | null;
  reportsToSlug: string | null;
  parentType?: string | null;
  parentIdRef?: string | null;
  adapterType: string;
  adapterConfig: Record<string, unknown>;
  runtimeConfig: Record<string, unknown>;
  permissions: Record<string, unknown>;
  budgetMonthlyCents: number;
  metadata: Record<string, unknown> | null;
}

export type CompanyPortabilityProjectType = "department" | "project";

export interface CompanyPortabilityProjectManifestEntry {
  slug: string;
  name: string;
  type: CompanyPortabilityProjectType;
  description?: string | null;
  parentSlug?: string | null;
  status?: string | null;
  color?: string | null;
  targetDate?: string | null;
  leadAgentSlug?: string | null;
  functionType?: string | null;
  executionWorkspacePolicy?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

export interface CompanyPortabilityIssueManifestEntry {
  slug: string;
  title: string;
  description?: string | null;
  status?: string | null;
  priority?: string | null;
  projectSlug?: string | null;
  assigneeAgentSlug?: string | null;
  assigneeUserEmail?: string | null;
  labelNames?: string[];
  billingCode?: string | null;
  dueDate?: string | null;
  identifier?: string | null;
  recurring?: boolean | null;
  assigneeAdapterOverrides?: Record<string, unknown> | null;
  executionWorkspaceSettings?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

export interface CompanyPortabilityManifest {
  schemaVersion: number;
  generatedAt: string;
  source: {
    companyId: string;
    companyName: string;
  } | null;
  includes: CompanyPortabilityInclude;
  company: CompanyPortabilityCompanyManifestEntry | null;
  agents: CompanyPortabilityAgentManifestEntry[];
  projects?: CompanyPortabilityProjectManifestEntry[];
  issues?: CompanyPortabilityIssueManifestEntry[];
  requiredSecrets: CompanyPortabilitySecretRequirement[];
}

export interface CompanyPortabilityExportResult {
  manifest: CompanyPortabilityManifest;
  files: Record<string, string>;
  warnings: string[];
}

export type ImportWarningKind =
  | "unknown_section"
  | "unsupported_version"
  | "deprecated_field"
  | "missing_file"
  | "invalid_frontmatter"
  | "empty_selection"
  | "link_failed"
  | "skipped_update";

export interface ImportWarning {
  kind: ImportWarningKind;
  section?: string;
  message: string;
  count?: number;
}

export type CompanyPortabilitySource =
  | {
      type: "inline";
      manifest: CompanyPortabilityManifest;
      files: Record<string, string>;
    }
  | {
      type: "url";
      url: string;
    }
  | {
      type: "github";
      url: string;
    };

export type CompanyPortabilityImportTarget =
  | {
      mode: "new_company";
      newCompanyName?: string | null;
    }
  | {
      mode: "existing_company";
      companyId: string;
    };

export type CompanyPortabilityAgentSelection = "all" | string[];

export type CompanyPortabilityCollisionStrategy = "rename" | "skip" | "replace";

export interface CompanyPortabilityPreviewRequest {
  source: CompanyPortabilitySource;
  include?: Partial<CompanyPortabilityInclude>;
  target: CompanyPortabilityImportTarget;
  agents?: CompanyPortabilityAgentSelection;
  collisionStrategy?: CompanyPortabilityCollisionStrategy;
}

export interface CompanyPortabilityPreviewAgentPlan {
  slug: string;
  action: "create" | "update" | "skip";
  plannedName: string;
  existingAgentId: string | null;
  reason: string | null;
}

export interface CompanyPortabilityPreviewProjectPlan {
  slug: string;
  action: "create" | "update" | "skip";
  plannedName: string;
  existingProjectId: string | null;
  reason: string | null;
}

export interface CompanyPortabilityPreviewIssuePlan {
  slug: string;
  action: "create" | "skip";
  plannedTitle: string;
  reason: string | null;
}

export interface CompanyPortabilityPreviewResult {
  include: CompanyPortabilityInclude;
  targetCompanyId: string | null;
  targetCompanyName: string | null;
  collisionStrategy: CompanyPortabilityCollisionStrategy;
  selectedAgentSlugs: string[];
  plan: {
    companyAction: "none" | "create" | "update";
    agentPlans: CompanyPortabilityPreviewAgentPlan[];
    projectPlans: CompanyPortabilityPreviewProjectPlan[];
    issuePlans: CompanyPortabilityPreviewIssuePlan[];
  };
  requiredSecrets: CompanyPortabilitySecretRequirement[];
  warnings: ImportWarning[];
  errors: string[];
}

export interface CompanyPortabilityImportRequest extends CompanyPortabilityPreviewRequest {}

export interface CompanyPortabilityImportResult {
  company: {
    id: string;
    name: string;
    action: "created" | "updated" | "unchanged";
  };
  agents: {
    slug: string;
    id: string | null;
    action: "created" | "updated" | "skipped";
    name: string;
    reason: string | null;
  }[];
  projects: {
    slug: string;
    id: string | null;
    action: "created" | "updated" | "skipped";
    name: string;
    type: CompanyPortabilityProjectType;
    reason: string | null;
  }[];
  issues: {
    slug: string;
    id: string | null;
    action: "created" | "skipped";
    title: string;
    reason: string | null;
  }[];
  requiredSecrets: CompanyPortabilitySecretRequirement[];
  warnings: ImportWarning[];
}

export interface CompanyPortabilityExportRequest {
  include?: Partial<CompanyPortabilityInclude>;
}
