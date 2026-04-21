export interface CompanyPortabilityInclude {
  company: boolean;
  agents: boolean;
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

export interface CompanyPortabilityPreviewResult {
  include: CompanyPortabilityInclude;
  targetCompanyId: string | null;
  targetCompanyName: string | null;
  collisionStrategy: CompanyPortabilityCollisionStrategy;
  selectedAgentSlugs: string[];
  plan: {
    companyAction: "none" | "create" | "update";
    agentPlans: CompanyPortabilityPreviewAgentPlan[];
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
  requiredSecrets: CompanyPortabilitySecretRequirement[];
  warnings: ImportWarning[];
}

export interface CompanyPortabilityExportRequest {
  include?: Partial<CompanyPortabilityInclude>;
}
