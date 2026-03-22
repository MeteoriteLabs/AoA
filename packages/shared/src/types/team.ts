import type { PermissionKey, UserRole } from "../constants.js";

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
  permissions: TeamPermissionSummary;
}

export interface TeamMemberSummary {
  userId: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  role: UserRole;
  departmentId: string | null;
  departmentName: string | null;
  permissions: PermissionKey[];
  isCurrentUser: boolean;
}

export interface TeamInviteSummary {
  id: string;
  email: string | null;
  role: UserRole;
  departmentId: string | null;
  departmentName: string | null;
  expiresAt: Date;
  inviteUrl: string;
}

export interface TeamSummary {
  currentUser: TeamCurrentUserSummary;
  members: TeamMemberSummary[];
  pendingInvites: TeamInviteSummary[];
}
