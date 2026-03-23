import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, UserPlus, Trash2 } from "lucide-react";
import type { Project, TeamMemberSummary, TeamSummary, TeamPermissionSummary, UserRole } from "@paperclipai/shared";
import { teamApi } from "../../api/team";
import { projectsApi } from "../../api/projects";
import { useCompany } from "../../context/CompanyContext";
import { useToast } from "../../context/ToastContext";
import { queryKeys } from "../../lib/queryKeys";
import { InviteDialog } from "../InviteDialog";
import { EmptyState } from "../EmptyState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

interface HumansTabProps {
  teamSummary: TeamSummary;
  highlightId?: string | null;
  permissions: TeamPermissionSummary;
  onMutationSuccess?: () => void;
}

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

function ReportsToSelect({
  member,
  members,
  disabled,
  onParentChange,
  isUpdating,
}: {
  member: TeamMemberSummary;
  members: TeamMemberSummary[];
  disabled: boolean;
  onParentChange: (parentId: string | null) => void;
  isUpdating: boolean;
}) {
  // D1: humans only report to humans — filter to accepted users only, exclude self
  const options = useMemo(
    () => members.filter((m) => m.userId !== member.userId),
    [members, member.userId],
  );

  return (
    <PermissionDisabledButton
      disabled={disabled}
      tooltip="You don't have permission to change reporting structure"
    >
      <Select
        value={member.parentId ?? "none"}
        onValueChange={(value) => onParentChange(value === "none" ? null : value)}
        disabled={disabled || isUpdating}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="No manager" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">No manager (root)</SelectItem>
          {options.map((opt) => (
            <SelectItem key={opt.userId} value={opt.userId}>
              {opt.displayName ?? opt.email ?? opt.userId.slice(0, 8)}
              {" "}
              <span className="text-muted-foreground">({ROLE_LABELS[opt.role]})</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </PermissionDisabledButton>
  );
}

function RemoveConfirmDialog({
  member,
  open,
  onOpenChange,
  onConfirm,
  isPending,
}: {
  member: TeamMemberSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isPending: boolean;
}) {
  const displayName = member.displayName ?? member.email ?? member.userId.slice(0, 8);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Remove team member</DialogTitle>
          <DialogDescription>
            This will remove <strong>{displayName}</strong> from the team. Agents or team members
            reporting to them will be unlinked.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isPending}>
            {isPending ? "Removing..." : "Remove"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MemberCard({
  member,
  members,
  departments,
  canManageRoles,
  onRoleChange,
  onParentChange,
  onRemove,
  isUpdating,
  founderCount,
  isHighlighted,
}: {
  member: TeamMemberSummary;
  members: TeamMemberSummary[];
  departments: Project[];
  canManageRoles: boolean;
  onRoleChange: (member: TeamMemberSummary, nextRole: UserRole, nextDepartmentId: string | null) => void;
  onParentChange: (member: TeamMemberSummary, parentId: string | null) => void;
  onRemove: (member: TeamMemberSummary) => void;
  isUpdating: boolean;
  founderCount: number;
  isHighlighted: boolean;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [draftRole, setDraftRole] = useState<UserRole>(member.role);
  const [draftDepartmentId, setDraftDepartmentId] = useState<string>(member.departmentId ?? "none");
  const selfFounderLock = member.isCurrentUser && member.role === "founder" && founderCount <= 1;
  const roleChangeDisabled = !canManageRoles || selfFounderLock;
  const canRemove = canManageRoles && !member.isCurrentUser && !(member.role === "founder" && founderCount <= 1);

  useEffect(() => {
    setDraftRole(member.role);
    setDraftDepartmentId(member.departmentId ?? "none");
  }, [member.departmentId, member.role]);

  useEffect(() => {
    if (isHighlighted && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [isHighlighted]);

  return (
    <div
      ref={cardRef}
      className={cn(
        "rounded-xl border border-border bg-card p-4 transition-all duration-500",
        isHighlighted && "ring-2 ring-primary animate-pulse",
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
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

          <div className="flex items-center gap-2">
            <div className="flex-1">
              <ReportsToSelect
                member={member}
                members={members}
                disabled={!canManageRoles || isUpdating}
                onParentChange={(parentId) => onParentChange(member, parentId)}
                isUpdating={isUpdating}
              />
            </div>
            {canRemove && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => onRemove(member)}
                    disabled={isUpdating}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Remove team member</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function HumansTab({ teamSummary, highlightId, permissions, onMutationSuccess }: HumansTabProps) {
  const { selectedCompanyId } = useCompany();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<TeamMemberSummary | null>(null);

  const { data: projects } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.projects.list(selectedCompanyId) : ["projects", "none"],
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  const departments = useMemo(
    () => (projects ?? []).filter((project) => project.type === "department"),
    [projects],
  );

  const members = teamSummary.members;
  const pendingInvites = teamSummary.pendingInvites;
  const founderCount = members.filter((m) => m.role === "founder").length;
  const nonFounderMembers = members;

  const invalidateTeam = useCallback(async () => {
    if (selectedCompanyId) {
      await queryClient.invalidateQueries({ queryKey: queryKeys.team.summary(selectedCompanyId) });
    }
    onMutationSuccess?.();
  }, [queryClient, selectedCompanyId, onMutationSuccess]);

  const updateRole = useMutation({
    mutationFn: ({
      userId,
      role,
      projectId,
      parentType,
      parentId,
    }: {
      userId: string;
      role: UserRole;
      projectId: string | null;
      parentType?: "user" | null;
      parentId?: string | null;
    }) =>
      teamApi.updateRole(selectedCompanyId!, userId, { role, projectId, parentType, parentId }),
    onSuccess: invalidateTeam,
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) => teamApi.removeMember(selectedCompanyId!, userId),
    onSuccess: async () => {
      setRemoveTarget(null);
      await invalidateTeam();
      pushToast({ title: "Team member removed", tone: "success" });
    },
    onError: () => {
      pushToast({ title: "Failed to remove team member", tone: "error" });
    },
  });

  const handleRoleChange = useCallback(
    (member: TeamMemberSummary, nextRole: UserRole, nextDepartmentId: string | null) => {
      updateRole.mutate({
        userId: member.userId,
        role: nextRole,
        projectId: nextDepartmentId,
      });
    },
    [updateRole],
  );

  const handleParentChange = useCallback(
    (member: TeamMemberSummary, parentId: string | null) => {
      updateRole.mutate({
        userId: member.userId,
        role: member.role,
        projectId: member.departmentId,
        parentType: parentId ? "user" : null,
        parentId,
      });
    },
    [updateRole],
  );

  if (!selectedCompanyId) {
    return <EmptyState icon={Users} message="Select a company to view team." />;
  }

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Team Members</h2>
            <p className="text-sm text-muted-foreground">
              Manage roles, reporting structure, and invites for human collaborators.
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
                members={members}
                departments={departments}
                canManageRoles={permissions.canManageRoles}
                founderCount={founderCount}
                isUpdating={updateRole.isPending}
                isHighlighted={highlightId === member.userId}
                onRoleChange={handleRoleChange}
                onParentChange={handleParentChange}
                onRemove={setRemoveTarget}
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

        {removeTarget && (
          <RemoveConfirmDialog
            member={removeTarget}
            open={Boolean(removeTarget)}
            onOpenChange={(open) => { if (!open) setRemoveTarget(null); }}
            onConfirm={() => removeMember.mutate(removeTarget.userId)}
            isPending={removeMember.isPending}
          />
        )}
      </div>
    </TooltipProvider>
  );
}
