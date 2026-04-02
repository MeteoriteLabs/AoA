import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, UserPlus, Shield, ArrowRightLeft, RotateCw, X } from "lucide-react";
import type { TeamMemberSummary, TeamSummary, TeamPermissionSummary, UserRole } from "@paperclipai/shared";
import { useNavigate } from "@/lib/router";
import { teamApi } from "../../api/team";
import { projectsApi } from "../../api/projects";
import { useCompany } from "../../context/CompanyContext";
import { useToast } from "../../context/ToastContext";
import { queryKeys } from "../../lib/queryKeys";
import { AddMemberDialog } from "./AddMemberDialog";
import { TransferAdminDialog } from "./TransferAdminDialog";
import { EmptyState } from "../EmptyState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ClickableDiv } from "@/components/ui/clickable-div";
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
  isSystemAdmin: boolean;
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

function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function MemberCard({
  member,
  members,
  isHighlighted,
}: {
  member: TeamMemberSummary;
  members: TeamMemberSummary[];
  isHighlighted: boolean;
}) {
  const navigate = useNavigate();
  const cardRef = useRef<HTMLDivElement>(null);
  const displayName = member.displayName ?? member.email ?? member.userId.slice(0, 8);
  const initials = deriveInitials(displayName);
  const parent = member.parentId
    ? members.find((m) => m.userId === member.parentId)
    : null;

  useEffect(() => {
    if (isHighlighted && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [isHighlighted]);

  return (
    <ClickableDiv
      ref={cardRef}
      className={cn(
        "border border-border bg-card rounded-lg p-4 transition-all duration-150 cursor-pointer hover:bg-accent/30",
        isHighlighted && "ring-2 ring-primary animate-pulse",
      )}
      onClick={() => navigate(`/team/${member.userId}`)}
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        <Avatar className="h-10 w-10 shrink-0">
          {member.avatarUrl && <AvatarImage src={member.avatarUrl} alt={displayName} />}
          <AvatarFallback className="text-xs">{initials}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-semibold truncate">{displayName}</span>
            {member.isCurrentUser && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">You</Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground truncate mt-0.5">
            {member.email ?? "No email"}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="mt-3 space-y-1.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="secondary" className={cn("border-0 text-[10px]", ROLE_STYLES[member.role])}>
            {ROLE_LABELS[member.role]}
          </Badge>
          {member.isSystemAdmin && (
            <Badge variant="secondary" className="border-0 text-[10px] bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
              <Shield className="mr-0.5 h-2.5 w-2.5" />
              Admin
            </Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          {member.departmentName ?? "No department"}
        </div>
      </div>

      {/* Footer */}
      <div className="mt-3 pt-3 border-t border-border/50 text-[11px] text-muted-foreground">
        {parent
          ? `Reports to ${parent.displayName ?? parent.email ?? parent.userId.slice(0, 8)}`
          : "No manager (root)"}
      </div>
    </ClickableDiv>
  );
}

function PendingInvitesSection({
  companyId,
  pendingInvites,
  canManage,
  onMutationSuccess,
}: {
  companyId: string;
  pendingInvites: TeamSummary["pendingInvites"];
  canManage: boolean;
  onMutationSuccess: () => Promise<void>;
}) {
  const { pushToast } = useToast();

  const resendMutation = useMutation({
    mutationFn: (inviteId: string) => teamApi.resendInvite(companyId, inviteId),
    onSuccess: async () => {
      await onMutationSuccess();
      pushToast({ title: "Invite resent", tone: "success" });
    },
    onError: (err: Error) => {
      pushToast({ title: "Failed to resend invite", body: err.message, tone: "error" });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (inviteId: string) => teamApi.revokeInvite(companyId, inviteId),
    onSuccess: async () => {
      await onMutationSuccess();
      pushToast({ title: "Invite revoked", tone: "success" });
    },
    onError: (err: Error) => {
      pushToast({ title: "Failed to revoke invite", body: err.message, tone: "error" });
    },
  });

  return (
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
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                Expires {new Date(invite.expiresAt).toLocaleString()}
              </span>
              {canManage && (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => resendMutation.mutate(invite.id)}
                        disabled={resendMutation.isPending || revokeMutation.isPending}
                      >
                        <RotateCw className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Resend invite</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => revokeMutation.mutate(invite.id)}
                        disabled={resendMutation.isPending || revokeMutation.isPending}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Revoke invite</TooltipContent>
                  </Tooltip>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function HumansTab({ teamSummary, highlightId, permissions, isSystemAdmin, onMutationSuccess }: HumansTabProps) {
  const { selectedCompanyId } = useCompany();
  const queryClient = useQueryClient();
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [transferAdminOpen, setTransferAdminOpen] = useState(false);

  // Departments needed for AddMemberDialog
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

  const invalidateTeam = useCallback(async () => {
    if (selectedCompanyId) {
      await queryClient.invalidateQueries({ queryKey: queryKeys.team.summary(selectedCompanyId) });
    }
    onMutationSuccess?.();
  }, [queryClient, selectedCompanyId, onMutationSuccess]);

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
          <div className="flex gap-2">
            {isSystemAdmin && (
              <Button variant="outline" onClick={() => setTransferAdminOpen(true)}>
                <ArrowRightLeft className="mr-1.5 h-4 w-4" />
                Transfer Admin
              </Button>
            )}
            <PermissionDisabledButton
              disabled={!permissions.canInviteUsers}
              tooltip="You don't have permission to add members"
            >
              <Button
                onClick={() => setAddMemberOpen(true)}
                disabled={!permissions.canInviteUsers}
              >
                <UserPlus className="mr-1.5 h-4 w-4" />
                Add Member
              </Button>
            </PermissionDisabledButton>
          </div>
        </div>

        {members.length === 0 && pendingInvites.length === 0 ? (
          <EmptyState
            icon={Users}
            message="Add your first team member"
            description="Add a team lead or contributor directly, or send an invite link."
            action="Add Member"
            onAction={permissions.canInviteUsers ? () => setAddMemberOpen(true) : undefined}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {members.map((member) => (
              <MemberCard
                key={member.userId}
                member={member}
                members={members}
                isHighlighted={highlightId === member.userId}
              />
            ))}
          </div>
        )}

        {pendingInvites.length > 0 && (
          <PendingInvitesSection
            companyId={selectedCompanyId}
            pendingInvites={pendingInvites}
            canManage={permissions.canInviteUsers}
            onMutationSuccess={invalidateTeam}
          />
        )}

        <AddMemberDialog
          companyId={selectedCompanyId}
          departments={departments}
          members={members}
          isSystemAdmin={isSystemAdmin}
          open={addMemberOpen}
          onOpenChange={setAddMemberOpen}
        />

        {isSystemAdmin && (
          <TransferAdminDialog
            companyId={selectedCompanyId}
            founders={members.filter((m) => m.role === "founder")}
            currentUserId={teamSummary.currentUser?.userId ?? ""}
            open={transferAdminOpen}
            onOpenChange={setTransferAdminOpen}
          />
        )}
      </div>
    </TooltipProvider>
  );
}
