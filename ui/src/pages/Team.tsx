import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, UserPlus } from "lucide-react";
import type { Project, TeamMemberSummary, UserRole } from "@armyofagents/shared";
import { teamApi } from "../api/team";
import { projectsApi } from "../api/projects";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { useTeamAccess } from "../hooks/useTeamAccess";
import { InviteDialog } from "../components/InviteDialog";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const ROLE_STYLES: Record<UserRole, string> = {
  founder: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  team_lead: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  team_member: "bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-300",
};

const ROLE_LABELS: Record<UserRole, string> = {
  founder: "Founder",
  team_lead: "Team Lead",
  team_member: "Team Member",
};

function PermissionDisabledButton({
  disabled,
  tooltip,
  children,
}: {
  disabled: boolean;
  tooltip: string;
  children: React.ReactNode;
}) {
  if (!disabled) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{children}</span>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function MemberCard({
  member,
  departments,
  canManageRoles,
  onRoleChange,
  isUpdating,
  founderCount,
}: {
  member: TeamMemberSummary;
  departments: Project[];
  canManageRoles: boolean;
  onRoleChange: (member: TeamMemberSummary, nextRole: UserRole, nextDepartmentId: string | null) => void;
  isUpdating: boolean;
  founderCount: number;
}) {
  const [draftRole, setDraftRole] = useState<UserRole>(member.role);
  const [draftDepartmentId, setDraftDepartmentId] = useState<string>(member.departmentId ?? "none");
  const selfFounderLock = member.isCurrentUser && member.role === "founder" && founderCount <= 1;
  const roleChangeDisabled = !canManageRoles || selfFounderLock;

  useEffect(() => {
    setDraftRole(member.role);
    setDraftDepartmentId(member.departmentId ?? "none");
  }, [member.departmentId, member.role]);

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold">
              {member.displayName ?? member.email ?? member.userId.slice(0, 8)}
            </span>
            <Badge variant="secondary" className={cn("border-0", ROLE_STYLES[member.role])}>
              {ROLE_LABELS[member.role]}
            </Badge>
            {member.isCurrentUser && (
              <Badge variant="outline" className="text-[11px]">
                You
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {member.email ?? "No email"} · {member.departmentName ?? "No department"}
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:w-[320px]">
          <PermissionDisabledButton
            disabled={roleChangeDisabled}
            tooltip={
              selfFounderLock
                ? "You don't have permission to demote the last founder"
                : "You don't have permission to manage roles"
            }
          >
            <Select
              value={draftRole}
              onValueChange={(value) => {
                const nextRole = value as UserRole;
                setDraftRole(nextRole);
                if (nextRole === "founder") {
                  setDraftDepartmentId("none");
                }
                onRoleChange(
                  member,
                  nextRole,
                  nextRole === "founder"
                    ? null
                    : nextRole === "team_lead" || draftDepartmentId !== "none"
                      ? (draftDepartmentId === "none" ? null : draftDepartmentId)
                      : null,
                );
              }}
              disabled={roleChangeDisabled || isUpdating}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="founder">Founder</SelectItem>
                <SelectItem value="team_lead">Team Lead</SelectItem>
                <SelectItem value="team_member">Team Member</SelectItem>
              </SelectContent>
            </Select>
          </PermissionDisabledButton>

          <PermissionDisabledButton
            disabled={!canManageRoles}
            tooltip="You don't have permission to manage department scope"
          >
            <Select
              value={draftDepartmentId}
              onValueChange={(value) => {
                setDraftDepartmentId(value);
                onRoleChange(member, draftRole, value === "none" ? null : value);
              }}
              disabled={!canManageRoles || draftRole === "founder" || isUpdating}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No department</SelectItem>
                {departments.map((department) => (
                  <SelectItem key={department.id} value={department.id}>
                    {department.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </PermissionDisabledButton>
        </div>
      </div>
    </div>
  );
}

export function Team() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const { summary, permissions, isLoading } = useTeamAccess(selectedCompanyId);

  const { data: projects } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.projects.list(selectedCompanyId) : ["projects", "none"],
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  useEffect(() => {
    setBreadcrumbs([{ label: "Team" }]);
  }, [setBreadcrumbs]);

  const departments = useMemo(
    () => (projects ?? []).filter((project) => project.type === "department"),
    [projects],
  );

  const updateRole = useMutation({
    mutationFn: ({
      userId,
      role,
      projectId,
    }: {
      userId: string;
      role: UserRole;
      projectId: string | null;
    }) => teamApi.updateRole(selectedCompanyId!, userId, { role, projectId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.team.summary(selectedCompanyId!) });
    },
  });

  if (!selectedCompanyId) {
    return <EmptyState icon={Users} message="Select a company to view team." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="list" />;
  }

  const members = summary?.members ?? [];
  const pendingInvites = summary?.pendingInvites ?? [];
  const founderCount = members.filter((member) => member.role === "founder").length;
  const nonFounderMembers = members.filter((member) => member.role !== "founder");

  return (
    <TooltipProvider>
      <div className="space-y-6">
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">Team</h1>
          <p className="text-sm text-muted-foreground">
            Manage roles, department scope, and invites for human collaborators.
          </p>
        </div>
        <PermissionDisabledButton
          disabled={!permissions.canInviteUsers}
          tooltip="You don't have permission to invite users"
        >
          <Button
            onClick={() => setInviteOpen(true)}
            disabled={!permissions.canInviteUsers}
          >
            <UserPlus className="mr-1.5 h-4 w-4" />
            Invite teammate
          </Button>
        </PermissionDisabledButton>
      </div>

      {nonFounderMembers.length === 0 && pendingInvites.length === 0 ? (
        <EmptyState
          icon={Users}
          message="Invite your first team member"
          description="Create a scoped invite to bring in a team lead or contributor."
          action="Invite teammate"
          onAction={permissions.canInviteUsers ? () => setInviteOpen(true) : undefined}
        />
      ) : (
        <div className="space-y-3">
          {members.map((member) => (
            <MemberCard
              key={member.userId}
              member={member}
              departments={departments}
              canManageRoles={permissions.canManageRoles}
              founderCount={founderCount}
              isUpdating={updateRole.isPending}
              onRoleChange={(currentMember, nextRole, nextDepartmentId) =>
                updateRole.mutate({
                  userId: currentMember.userId,
                  role: nextRole,
                  projectId: nextDepartmentId,
                })
              }
            />
          ))}
        </div>
      )}

      {pendingInvites.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">Pending invites</h2>
          <div className="mt-3 space-y-2">
            {pendingInvites.map((invite) => (
              <div
                key={invite.id}
                className="flex flex-col gap-1 rounded-lg border border-border/80 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="font-medium">{invite.email ?? "Pending invite"}</div>
                  <div className="text-xs text-muted-foreground">
                    {ROLE_LABELS[invite.role]} · {invite.departmentName ?? "No department"}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  Expires {new Date(invite.expiresAt).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

        <InviteDialog
          companyId={selectedCompanyId}
          departments={departments}
          open={inviteOpen}
          onOpenChange={setInviteOpen}
        />
      </div>
    </TooltipProvider>
  );
}
