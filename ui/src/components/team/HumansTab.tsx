import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, UserPlus, Shield, ArrowRightLeft, RotateCw, X, Search, Mail } from "lucide-react";
import type { TeamMemberSummary, TeamSummary, TeamPermissionSummary, UserRole } from "@armyofagents/shared";
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
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ClickableDiv } from "@/components/ui/clickable-div";
import { cn } from "@/lib/utils";
import { getInitials } from "@/lib/initials";
import { RoleBadge } from "./RoleBadge";

type RoleFilter = "all" | "founder" | "team_lead" | "team_member" | "pending";

const ROLE_LABELS: Record<UserRole, string> = {
  founder: "Founder",
  team_lead: "Team Lead",
  team_member: "Team Member",
};

const ROLE_FILTERS: { value: RoleFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "founder", label: "Founder" },
  { value: "team_lead", label: "Team Lead" },
  { value: "team_member", label: "Member" },
  { value: "pending", label: "Pending" },
];

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
  const initials = getInitials(displayName);
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
          <RoleBadge role={member.role} />
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

function InviteCard({
  invite,
  canManage,
  onMutationSuccess,
}: {
  invite: TeamSummary["pendingInvites"][number];
  canManage: boolean;
  onMutationSuccess: () => Promise<void>;
}) {
  const { selectedCompanyId } = useCompany();
  const { pushToast } = useToast();

  const resendMutation = useMutation({
    mutationFn: () => teamApi.resendInvite(selectedCompanyId!, invite.id),
    onSuccess: async () => {
      await onMutationSuccess();
      pushToast({ title: "Invite resent", tone: "success" });
    },
    onError: (err: Error) => {
      pushToast({ title: "Failed to resend invite", body: err.message, tone: "error" });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: () => teamApi.revokeInvite(selectedCompanyId!, invite.id),
    onSuccess: async () => {
      await onMutationSuccess();
      pushToast({ title: "Invite revoked", tone: "success" });
    },
    onError: (err: Error) => {
      pushToast({ title: "Failed to revoke invite", body: err.message, tone: "error" });
    },
  });

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border bg-card p-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-dashed border-border bg-muted text-muted-foreground">
          <Mail className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="block truncate text-sm font-semibold">
            {invite.email ?? "Pending invite"}
          </span>
          <span className="text-xs text-muted-foreground">Pending invite</span>
        </div>
      </div>

      {/* Role + dept */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <RoleBadge role={invite.role} />
        <span className="text-xs text-muted-foreground">
          {invite.departmentName ?? "No department"}
        </span>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-dashed border-border/50 pt-2.5">
        <span className="text-[11px] text-muted-foreground">
          Expires {new Date(invite.expiresAt).toLocaleDateString()}
        </span>
        {canManage && (
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => resendMutation.mutate()}
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
                  size="icon-xs"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => revokeMutation.mutate()}
                  disabled={resendMutation.isPending || revokeMutation.isPending}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Revoke invite</TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>
    </div>
  );
}

export function HumansTab({ teamSummary, highlightId, permissions, isSystemAdmin, onMutationSuccess }: HumansTabProps) {
  const { selectedCompanyId } = useCompany();
  const queryClient = useQueryClient();
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [transferAdminOpen, setTransferAdminOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");

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
  const teamLeadCount = members.filter((m) => m.role === "team_lead").length;
  const memberCount = members.filter((m) => m.role === "team_member").length;
  const pendingCount = pendingInvites.length;

  const { filteredMembers, filteredInvites } = useMemo(() => {
    const showMembers = roleFilter !== "pending";
    const showInvites = roleFilter === "all" || roleFilter === "pending";
    const roleToMatch = roleFilter !== "all" && roleFilter !== "pending" ? roleFilter : null;

    const fMembers = showMembers
      ? members.filter((m) => {
          if (roleToMatch && m.role !== roleToMatch) return false;
          if (search) {
            const q = search.toLowerCase();
            return (
              (m.displayName ?? "").toLowerCase().includes(q) ||
              (m.email ?? "").toLowerCase().includes(q)
            );
          }
          return true;
        })
      : [];

    const fInvites = showInvites
      ? pendingInvites.filter((inv) => {
          if (!search) return true;
          return (inv.email ?? "").toLowerCase().includes(search.toLowerCase());
        })
      : [];

    return { filteredMembers: fMembers, filteredInvites: fInvites };
  }, [members, pendingInvites, roleFilter, search]);

  const invalidateTeam = useCallback(async () => {
    if (selectedCompanyId) {
      await queryClient.invalidateQueries({ queryKey: queryKeys.team.summary(selectedCompanyId) });
    }
    onMutationSuccess?.();
  }, [queryClient, selectedCompanyId, onMutationSuccess]);

  if (!selectedCompanyId) {
    return <EmptyState icon={Users} message="Select a company to view team." />;
  }

  const isEmpty = members.length === 0 && pendingInvites.length === 0;
  const isFilteredEmpty = filteredMembers.length === 0 && filteredInvites.length === 0;

  return (
    <TooltipProvider>
      <div className="p-5 space-y-4">
        {/* Header */}
        <header className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold">
              Humans
              <span className="ml-1 font-mono text-xs font-medium text-muted-foreground">
                {members.length}
              </span>
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Roles, reporting structure, and invites for human collaborators.
            </p>
          </div>
          <div className="flex gap-2">
            {isSystemAdmin && (
              <Button variant="outline" size="sm" onClick={() => setTransferAdminOpen(true)}>
                <ArrowRightLeft className="mr-1.5 h-4 w-4" />
                Transfer Admin
              </Button>
            )}
            <PermissionDisabledButton
              disabled={!permissions.canInviteUsers}
              tooltip="You don't have permission to add members"
            >
              <Button
                size="sm"
                onClick={() => setAddMemberOpen(true)}
                disabled={!permissions.canInviteUsers}
              >
                <UserPlus className="mr-1.5 h-4 w-4" />
                Add Member
              </Button>
            </PermissionDisabledButton>
          </div>
        </header>

        {/* Stats bar */}
        <div className="flex items-center gap-3 overflow-x-auto rounded-lg border border-border bg-card px-4 py-3 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
          <div className="flex flex-col items-center gap-0.5 shrink-0">
            <span className="font-mono text-sm font-bold tabular-nums">{members.length}</span>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Members</span>
          </div>
          <div className="h-6 w-px shrink-0 bg-border" />
          <div className="flex flex-col items-center gap-0.5 shrink-0">
            <span className="font-mono text-sm font-bold tabular-nums text-brand">{founderCount}</span>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Founder</span>
          </div>
          <div className="h-6 w-px shrink-0 bg-border" />
          <div className="flex flex-col items-center gap-0.5 shrink-0">
            <span
              className="font-mono text-sm font-bold tabular-nums"
              style={{ color: "var(--data-indigo)" }}
            >
              {teamLeadCount}
            </span>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Team Lead</span>
          </div>
          <div className="h-6 w-px shrink-0 bg-border" />
          <div className="flex flex-col items-center gap-0.5 shrink-0">
            <span className="font-mono text-sm font-bold tabular-nums">{memberCount}</span>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Member</span>
          </div>
          {pendingCount > 0 && (
            <>
              <div className="h-6 w-px shrink-0 bg-border" />
              <div className="flex flex-col items-center gap-0.5 shrink-0">
                <span
                  className="font-mono text-sm font-bold tabular-nums"
                  style={{ color: "var(--warning)" }}
                >
                  {pendingCount}
                </span>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Pending</span>
              </div>
            </>
          )}
        </div>

        {/* Search + role filter */}
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or email…"
              className="h-8 pl-8 text-xs"
            />
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {ROLE_FILTERS.map(({ value, label }) => {
              const isActive = roleFilter === value;
              const count =
                value === "all"
                  ? members.length + pendingCount
                  : value === "pending"
                    ? pendingCount
                    : value === "founder"
                      ? founderCount
                      : value === "team_lead"
                        ? teamLeadCount
                        : memberCount;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setRoleFilter(value)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap",
                    isActive
                      ? "bg-foreground text-background border-foreground"
                      : "bg-card border-border text-foreground/70 hover:bg-accent hover:text-foreground",
                  )}
                >
                  {label}
                  <span className="font-mono text-[10px] opacity-70">{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Grid */}
        {isEmpty ? (
          <EmptyState
            icon={Users}
            message="Add your first team member"
            description="Add a team lead or contributor directly, or send an invite link."
            action="Add Member"
            onAction={permissions.canInviteUsers ? () => setAddMemberOpen(true) : undefined}
          />
        ) : isFilteredEmpty ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No results match your search or filter.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredMembers.map((member) => (
              <MemberCard
                key={member.userId}
                member={member}
                members={members}
                isHighlighted={highlightId === member.userId}
              />
            ))}
            {filteredInvites.map((invite) => (
              <InviteCard
                key={invite.id}
                invite={invite}
                canManage={permissions.canInviteUsers}
                onMutationSuccess={invalidateTeam}
              />
            ))}
          </div>
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
