import type { PermissionKey, UserRole } from "../constants.js";

export type HumanSocialLinkType =
  | "linkedin"
  | "github"
  | "x"
  | "instagram"
  | "facebook"
  | "substack"
  | "website"
  | "portfolio"
  | "youtube"
  | "medium"
  | "other";

export interface HumanSocialLink {
  type: HumanSocialLinkType;
  label: string | null;
  url: string;
}

export interface CompanyUserProfile {
  id: string;
  companyId: string;
  userId: string;
  displayName: string | null;
  title: string | null;
  bio: string | null;
  location: string | null;
  timezone: string | null;
  socialLinks: HumanSocialLink[];
  avatarAssetId: string | null;
  createdAt: Date;
  updatedAt: Date;
  updatedByUserId: string | null;
}

export interface TeamPermissionSummary {
  canAssignTasks: boolean;
  canInviteUsers: boolean;
  canManageRoles: boolean;
  canEditIdentityMemory: boolean;
}

export interface TeamCurrentUserSummary {
  userId: string | null;
  role: UserRole | null;
  departmentId: string | null;
  isSystemAdmin: boolean;
  permissions: TeamPermissionSummary;
}

export interface TeamMemberSummary {
  userId: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  title: string | null;
  bio: string | null;
  location: string | null;
  timezone: string | null;
  socialLinks: HumanSocialLink[];
  avatarAssetId: string | null;
  role: UserRole;
  departmentId: string | null;
  departmentName: string | null;
  permissions: PermissionKey[];
  isCurrentUser: boolean;
  isSystemAdmin: boolean;
  parentType: "user" | null;
  parentId: string | null;
}

export interface TeamInviteSummary {
  id: string;
  email: string | null;
  role: UserRole;
  departmentId: string | null;
  departmentName: string | null;
  reportsToId: string | null;
  reportsToName: string | null;
  expiresAt: Date;
  inviteUrl: string;
}

export interface TeamSummary {
  currentUser: TeamCurrentUserSummary;
  members: TeamMemberSummary[];
  pendingInvites: TeamInviteSummary[];
}

export interface AddMemberInput {
  name: string;
  email: string;
  role: UserRole;
  projectId?: string | null;
  parentType?: "user" | null;
  parentId?: string | null;
}

export interface TransferAdminInput {
  toUserId: string;
  confirmation: string;
}

export interface MemberDependencies {
  teamMembers: Array<{ userId: string; displayName: string | null; email: string | null; role: UserRole }>;
  agentTrees: Array<{ rootAgentId: string; rootAgentName: string; subAgentCount: number; agentIds: string[] }>;
  assignedTaskCount: number;
  createdTaskCount: number;
}

export interface ReassignAndRemoveInput {
  humanReassignments: Array<{ userId: string; newParentId: string | null }>;
  agentReassignments: Array<{ agentId: string; newParentId: string; newParentType: "user" }>;
}

/** A node in the unified org tree that can represent either an agent or a human. */
export interface UnifiedOrgNode {
  id: string;
  name: string;
  role: string;
  status: string;
  nodeType: "agent" | "user";

  // Agent-specific (undefined for users)
  adapterType?: string;
  trustScore?: number;
  icon?: string;
  pendingApproval?: boolean;

  // User-specific (undefined for agents)
  email?: string;
  userRole?: "founder" | "team_lead" | "team_member";
  departmentName?: string;
  avatarUrl?: string;

  // Hierarchy. `parentType` is included on agent nodes so the org-tree UI
  // can compute the apex CXO (= Chief of Staff) without an extra fetch:
  //   apexCxo = role === "cxo" && (parentType === "user" || parentType === null).
  parentType?: "agent" | "user" | null;
  children: UnifiedOrgNode[];
}
