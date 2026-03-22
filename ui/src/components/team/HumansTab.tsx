import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Users, UserPlus } from "lucide-react";
import type { Project, TeamMemberSummary, TeamSummary, UserRole } from "@paperclipai/shared";
import { teamApi } from "../../api/team";
import { queryKeys } from "../../lib/queryKeys";
import { InviteDialog } from "../InviteDialog";
import { EmptyState } from "../EmptyState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
  cardRef,
}: {
  member: TeamMemberSummary;
  departments: Project[];
  canManageRoles: boolean;
  onRoleChange: (member: TeamMemberSummary, nextRole: UserRole, nextDepartmentId: string | null) => void;
  isUpdating: boolean;
  founderCount: number;
  cardRef?: (el: HTMLDivElement | null) => void;
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
    <div ref={cardRef} className="rounded-xl border border-border bg-card p-4 transition-all duration-150">
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

interface HumansTabProps {
  summary: TeamSummary | null;
  companyId: string;
  departments: Project[];
  isLoading: boolean;
  highlightId: string | null;
  onHighlightClear: () => void;
  onMutationSuccess: () => void;
  permissions: {
    canAssignTasks: boolean;
    canInviteUsers: boolean;
    canManageRoles: boolean;
    canEditIdentityMemory: boolean;
  };
}

export function HumansTab({
  summary,
  companyId,
  departments,
  isLoading,
  highlightId,
  onHighlightClear,
  onMutationSuccess,
  permissions,
}: HumansTabProps) {
  const queryClient = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Scroll to highlighted card and flash animation
  useEffect(() => {
    if (!highlightId) return;

    const el = cardRefs.current.get(highlightId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-blue-400");

      highlightTimerRef.current = setTimeout(() => {
        el.classList.remove("ring-2", "ring-blue-400");
        onHighlightClear();
      }, 2000);
    } else {
      onHighlightClear();
    }

    return () => {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
      }
    };
  }, [highlightId, onHighlightClear]);

  const updateRole = useMutation({
    mutationFn: ({
      userId,
      role,
      projectId,
    }: {
      userId: string;
      role: UserRole;
      projectId: string | null;
    }) => teamApi.updateRole(companyId, userId, { role, projectId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.team.summary(companyId) });
      onMutationSuccess();
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  const members = summary?.members ?? [];
  const pendingInvites = summary?.pendingInvites ?? [];
  const founderCount = members.filter((member) => member.role === "founder").length;
  const nonFounderMembers = members.filter((member) => member.role !== "founder");

  return (
    <>
      {/* Invite button header */}
      <div className="flex items-center justify-between mb-4">
        <div />
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
          message="Invite your first team member to start building your team"
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
              cardRef={(el) => {
                if (el) cardRefs.current.set(member.userId, el);
                else cardRefs.current.delete(member.userId);
              }}
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
        <div className="rounded-2xl border border-border bg-card p-5 mt-4">
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
        companyId={companyId}
        departments={departments}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
      />
    </>
  );
}
