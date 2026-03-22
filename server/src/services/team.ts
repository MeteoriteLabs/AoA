import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  authUsers,
  companyMemberships,
  instanceUserRoles,
  invites,
  principalPermissionGrants,
  projects,
  userRoles,
} from "@paperclipai/db";
import type {
  PermissionKey,
  TeamSummary,
  UpdateTeamMemberRole,
  UserRole,
} from "@paperclipai/shared";
import { PERMISSION_KEYS } from "@paperclipai/shared";
import { conflict, notFound } from "../errors.js";
import { accessService } from "./access.js";
import { orgHierarchyService } from "./org-hierarchy.js";

const TEAM_INVITE_KEY = "teamInvite";
const TEAM_PERMISSION_KEYS = {
  founder: [...PERMISSION_KEYS],
  team_lead: ["tasks:assign", "tasks:assign_scope"],
  team_member: [],
} as const satisfies Record<UserRole, PermissionKey[]>;

function parseInviteRoleMetadata(defaultsPayload: Record<string, unknown> | null | undefined) {
  if (!defaultsPayload) return null;
  const raw = defaultsPayload[TEAM_INVITE_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const role = record.role;
  const email = record.email;
  const projectId = record.projectId;
  if (role !== "team_lead" && role !== "team_member" && role !== "founder") return null;
  return {
    email: typeof email === "string" ? email : null,
    role: role as UserRole,
    projectId: typeof projectId === "string" ? projectId : null,
  };
}

function derivePermissions(role: UserRole) {
  return {
    canAssignTasks: role === "founder" || role === "team_lead",
    canInviteUsers: role === "founder",
    canManageRoles: role === "founder",
    canEditIdentityMemory: role === "founder",
  };
}

function effectiveRoleFromRows(
  rows: Array<{ role: string; projectId: string | null }>,
  isInstanceAdmin: boolean,
): { role: UserRole | null; projectId: string | null } {
  if (isInstanceAdmin) return { role: "founder", projectId: null };
  if (rows.some((row) => row.role === "founder")) {
    return { role: "founder", projectId: null };
  }
  const leadRow = rows.find((row) => row.role === "team_lead");
  if (leadRow) {
    return { role: "team_lead", projectId: leadRow.projectId };
  }
  const memberRow = rows.find((row) => row.role === "team_member");
  if (memberRow) {
    return { role: "team_member", projectId: memberRow.projectId };
  }
  return { role: null, projectId: null };
}

function roleGrants(role: UserRole, projectId: string | null) {
  return TEAM_PERMISSION_KEYS[role].map((permissionKey) => ({
    permissionKey,
    scope:
      permissionKey === "tasks:assign_scope" && projectId
        ? { projectId }
        : null,
  }));
}

export function teamService(db: Db) {
  const access = accessService(db);
  const orgHierarchy = orgHierarchyService(db);

  async function isInstanceAdmin(userId: string | null | undefined) {
    if (!userId) return false;
    const row = await db
      .select({ id: instanceUserRoles.id })
      .from(instanceUserRoles)
      .where(and(eq(instanceUserRoles.userId, userId), eq(instanceUserRoles.role, "instance_admin")))
      .then((rows) => rows[0] ?? null);
    return Boolean(row);
  }

  async function getUserRole(companyId: string, userId: string | null | undefined) {
    if (!userId) return { role: null, projectId: null } as const;
    const [instanceAdmin, rows] = await Promise.all([
      isInstanceAdmin(userId),
      db
        .select({
          role: userRoles.role,
          projectId: userRoles.projectId,
        })
        .from(userRoles)
        .where(and(eq(userRoles.companyId, companyId), eq(userRoles.userId, userId))),
    ]);
    return effectiveRoleFromRows(rows, instanceAdmin);
  }

  async function assertFounder(companyId: string, userId: string | null | undefined) {
    const { role } = await getUserRole(companyId, userId);
    if (role !== "founder") {
      throw conflict("Only founders can manage team roles");
    }
  }

  async function listTeam(companyId: string, currentUserId: string | null | undefined): Promise<TeamSummary> {
    const memberships = await db
      .select({
        principalId: companyMemberships.principalId,
        status: companyMemberships.status,
      })
      .from(companyMemberships)
      .where(
        and(
          eq(companyMemberships.companyId, companyId),
          eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.status, "active"),
        ),
      );

    const userIds = memberships.map((membership) => membership.principalId);
    const [users, roleRows, grants, pendingInvites, departmentRows] = await Promise.all([
      userIds.length > 0
        ? db
            .select({
              id: authUsers.id,
              email: authUsers.email,
              displayName: authUsers.displayName,
              avatarUrl: authUsers.avatarUrl,
              name: authUsers.name,
            })
            .from(authUsers)
            .where(inArray(authUsers.id, userIds))
        : Promise.resolve([]),
      userIds.length > 0
        ? db
            .select({
              userId: userRoles.userId,
              role: userRoles.role,
              projectId: userRoles.projectId,
            })
            .from(userRoles)
            .where(and(eq(userRoles.companyId, companyId), inArray(userRoles.userId, userIds)))
        : Promise.resolve([]),
      userIds.length > 0
        ? db
            .select({
              principalId: principalPermissionGrants.principalId,
              permissionKey: principalPermissionGrants.permissionKey,
            })
            .from(principalPermissionGrants)
            .where(
              and(
                eq(principalPermissionGrants.companyId, companyId),
                eq(principalPermissionGrants.principalType, "user"),
                inArray(principalPermissionGrants.principalId, userIds),
              ),
            )
        : Promise.resolve([]),
      db
        .select({
          id: invites.id,
          defaultsPayload: invites.defaultsPayload,
          expiresAt: invites.expiresAt,
        })
        .from(invites)
        .where(
          and(
            eq(invites.companyId, companyId),
            isNull(invites.revokedAt),
            isNull(invites.acceptedAt),
            sql`${invites.expiresAt} > now()`,
          ),
        ),
      db
        .select({ id: projects.id, name: projects.name })
        .from(projects)
        .where(and(eq(projects.companyId, companyId), eq(projects.type, "department"))),
    ]);

    const userMap = new Map(users.map((user) => [user.id, user]));
    const roleRowsByUser = new Map<string, Array<{ role: string; projectId: string | null }>>();
    for (const row of roleRows) {
      const existing = roleRowsByUser.get(row.userId) ?? [];
      existing.push({ role: row.role, projectId: row.projectId });
      roleRowsByUser.set(row.userId, existing);
    }
    const grantsByUser = new Map<string, PermissionKey[]>();
    for (const grant of grants) {
      const existing = grantsByUser.get(grant.principalId) ?? [];
      existing.push(grant.permissionKey as PermissionKey);
      grantsByUser.set(grant.principalId, existing);
    }
    const departmentMap = new Map(departmentRows.map((row) => [row.id, row.name]));
    const adminIds = new Set<string>();
    for (const userId of userIds) {
      if (await isInstanceAdmin(userId)) {
        adminIds.add(userId);
      }
    }

    const members = memberships
      .map((membership) => {
        const roleRowsForUser = roleRowsByUser.get(membership.principalId) ?? [];
        const isAdmin = adminIds.has(membership.principalId);
        const effectiveRole = effectiveRoleFromRows(roleRowsForUser, isAdmin);
        if (!effectiveRole.role) return null;
        const user = userMap.get(membership.principalId);
        return {
          userId: membership.principalId,
          email: user?.email ?? null,
          displayName: user?.displayName ?? user?.name ?? null,
          avatarUrl: user?.avatarUrl ?? null,
          role: effectiveRole.role,
          departmentId: effectiveRole.projectId,
          departmentName: effectiveRole.projectId ? (departmentMap.get(effectiveRole.projectId) ?? null) : null,
          permissions: grantsByUser.get(membership.principalId) ?? [],
          isCurrentUser: membership.principalId === currentUserId,
        };
      })
      .filter((member): member is NonNullable<typeof member> => Boolean(member))
      .sort((left, right) => {
        const roleOrder = { founder: 0, team_lead: 1, team_member: 2 } as const;
        const roleSort = roleOrder[left.role] - roleOrder[right.role];
        if (roleSort !== 0) return roleSort;
        return (left.displayName ?? left.email ?? left.userId).localeCompare(
          right.displayName ?? right.email ?? right.userId,
        );
      });

    const pendingInviteSummaries = pendingInvites
      .map((invite) => {
        const metadata = parseInviteRoleMetadata(invite.defaultsPayload as Record<string, unknown> | null);
        if (!metadata) return null;
        return {
          id: invite.id,
          email: metadata.email,
          role: metadata.role,
          departmentId: metadata.projectId,
          departmentName: metadata.projectId ? (departmentMap.get(metadata.projectId) ?? null) : null,
          expiresAt: invite.expiresAt,
          inviteUrl: "",
        };
      })
      .filter((invite): invite is NonNullable<typeof invite> => Boolean(invite));

    const currentUser = await getUserRole(companyId, currentUserId);
    return {
      currentUser: {
        userId: currentUserId ?? null,
        role: currentUser.role,
        departmentId: currentUser.projectId,
        permissions: currentUser.role
          ? derivePermissions(currentUser.role)
          : {
              canAssignTasks: false,
              canInviteUsers: false,
              canManageRoles: false,
              canEditIdentityMemory: false,
            },
      },
      members,
      pendingInvites: pendingInviteSummaries,
    };
  }

  async function founderCount(companyId: string) {
    const founderRoleRows = await db
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(and(eq(userRoles.companyId, companyId), eq(userRoles.role, "founder")))
      .then((rows) => rows.map((row) => row.userId));
    const founderIds = new Set(founderRoleRows);
    const membershipUserIds = await db
      .select({ principalId: companyMemberships.principalId })
      .from(companyMemberships)
      .where(
        and(
          eq(companyMemberships.companyId, companyId),
          eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.status, "active"),
        ),
      );
    for (const membership of membershipUserIds) {
      if (await isInstanceAdmin(membership.principalId)) {
        founderIds.add(membership.principalId);
      }
    }
    return founderIds.size;
  }

  async function updateUserRole(
    companyId: string,
    userId: string,
    input: UpdateTeamMemberRole,
    grantedByUserId: string | null,
  ) {
    const membership = await access.getMembership(companyId, "user", userId);
    if (!membership || membership.status !== "active") throw notFound("Team member not found");

    const currentRole = await getUserRole(companyId, userId);
    if (currentRole.role === "founder" && input.role !== "founder") {
      const founders = await founderCount(companyId);
      if (founders <= 1) {
        throw conflict("You cannot remove the last founder");
      }
    }

    // Handle parent assignment
    if (input.parentType !== undefined || input.parentId !== undefined) {
      if (input.parentId && input.parentType) {
        await orgHierarchy.ensureParent(companyId, input.parentType, input.parentId);
        await orgHierarchy.assertNoCycle(companyId, userId, "user", input.parentId, input.parentType);
      }
    }

    await db.transaction(async (tx) => {
      await tx.delete(userRoles).where(and(eq(userRoles.companyId, companyId), eq(userRoles.userId, userId)));
      await tx.insert(userRoles).values({
        companyId,
        userId,
        role: input.role,
        projectId: input.role === "founder" ? null : (input.projectId ?? null),
      });

      const membershipUpdate: Record<string, unknown> = {
        membershipRole: input.role,
        updatedAt: new Date(),
      };
      if (input.parentType !== undefined || input.parentId !== undefined) {
        membershipUpdate.parentType = input.parentType ?? null;
        membershipUpdate.parentId = input.parentId ?? null;
      }

      await tx
        .update(companyMemberships)
        .set(membershipUpdate)
        .where(eq(companyMemberships.id, membership.id));
    });

    await access.setPrincipalGrants(companyId, "user", userId, roleGrants(input.role, input.role === "founder" ? null : (input.projectId ?? null)), grantedByUserId);

    return getUserRole(companyId, userId);
  }

  async function removeMember(companyId: string, userId: string) {
    const membership = await access.getMembership(companyId, "user", userId);
    if (!membership || membership.status !== "active") throw notFound("Team member not found");

    const currentRole = await getUserRole(companyId, userId);
    if (currentRole.role === "founder") {
      const founders = await founderCount(companyId);
      if (founders <= 1) throw conflict("Cannot remove the last founder");
    }

    await db.transaction(async (tx) => {
      // Orphan all children pointing to this user
      await orgHierarchy.orphanChildren(userId, "user", tx);
      // Delete role assignments
      await tx.delete(userRoles).where(and(eq(userRoles.companyId, companyId), eq(userRoles.userId, userId)));
      // Delete permission grants
      await tx.delete(principalPermissionGrants).where(and(
        eq(principalPermissionGrants.companyId, companyId),
        eq(principalPermissionGrants.principalType, "user"),
        eq(principalPermissionGrants.principalId, userId),
      ));
      // Delete membership
      await tx.delete(companyMemberships).where(eq(companyMemberships.id, membership.id));
    });
  }

  async function applyInviteRole(
    companyId: string,
    userId: string,
    defaultsPayload: Record<string, unknown> | null | undefined,
    grantedByUserId: string | null,
  ) {
    const metadata = parseInviteRoleMetadata(defaultsPayload);
    if (!metadata) return null;
    return updateUserRole(
      companyId,
      userId,
      { role: metadata.role as UserRole, projectId: metadata.projectId },
      grantedByUserId,
    );
  }

  return {
    assertFounder,
    applyInviteRole,
    getUserRole,
    listTeam,
    removeMember,
    roleGrants,
    updateUserRole,
  };
}
