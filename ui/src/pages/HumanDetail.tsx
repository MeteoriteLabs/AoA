import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, Link, useNavigate } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Users,
  Bot,
  ClipboardList,
  FileText,
  Shield,
  Settings,
  Trash2,
  ChevronRight,
} from "lucide-react";
import type { UserRole, Project } from "@paperclipai/shared";
import { teamApi } from "../api/team";
import { projectsApi } from "../api/projects";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { PageSkeleton } from "../components/PageSkeleton";
import { EmptyState } from "../components/EmptyState";
import { MetricCard } from "../components/MetricCard";
import { Identity } from "../components/Identity";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageTabBar } from "../components/PageTabBar";
import { ReassignmentDialog } from "../components/team/ReassignmentDialog";
import { cn } from "../lib/utils";

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

const TAB_ITEMS = [
  { value: "overview", label: "Overview" },
  { value: "settings", label: "Settings" },
];

function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export function HumanDetail() {
  const { userId, tab } = useParams<{ userId: string; tab?: string }>();
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const activeTab = tab === "settings" ? "settings" : "overview";

  const handleTabChange = useCallback(
    (value: string) => {
      navigate(value === "overview" ? `/team/${userId}` : `/team/${userId}/${value}`);
    },
    [navigate, userId],
  );

  // Member + dependencies
  const { data, isLoading } = useQuery({
    queryKey: selectedCompanyId && userId
      ? queryKeys.team.member(selectedCompanyId, userId)
      : ["team", "none", "member"],
    queryFn: () => teamApi.getMember(selectedCompanyId!, userId!),
    enabled: Boolean(selectedCompanyId && userId),
  });

  // Team summary (for settings tab — member list for reports-to, permissions)
  const teamQuery = useQuery({
    queryKey: selectedCompanyId
      ? queryKeys.team.summary(selectedCompanyId)
      : ["team", "none"],
    queryFn: () => teamApi.get(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId) && activeTab === "settings",
  });

  // Departments (for settings tab)
  const deptQuery = useQuery({
    queryKey: selectedCompanyId
      ? queryKeys.projects.list(selectedCompanyId)
      : ["projects", "none"],
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId) && activeTab === "settings",
  });

  const member = data?.member;
  const deps = data?.dependencies;
  const teamSummary = teamQuery.data;
  const departments = useMemo(
    () => (deptQuery.data ?? []).filter((p: Project) => p.type === "department"),
    [deptQuery.data],
  );

  // Settings draft state
  const [draftRole, setDraftRole] = useState<UserRole>("team_member");
  const [draftDepartmentId, setDraftDepartmentId] = useState<string>("none");
  const [draftParentId, setDraftParentId] = useState<string>("none");

  // Sync draft state when member loads
  useEffect(() => {
    if (member) {
      setDraftRole(member.role);
      setDraftDepartmentId(member.departmentId ?? "none");
      setDraftParentId(member.parentId ?? "none");
    }
  }, [member]);

  // Permissions
  const currentUser = teamSummary?.currentUser;
  const canManageRoles = currentUser?.permissions?.canManageRoles ?? false;
  const founderCount = useMemo(
    () => (teamSummary?.members ?? []).filter((m) => m.role === "founder").length,
    [teamSummary?.members],
  );
  const isSelf = member?.isCurrentUser ?? false;
  const selfFounderLock = isSelf && member?.role === "founder" && founderCount <= 1;
  const canRemove = canManageRoles && !isSelf && !(member?.role === "founder" && founderCount <= 1);

  // Reports-to options: all members except self
  const reportsToOptions = useMemo(
    () => (teamSummary?.members ?? []).filter((m) => m.userId !== userId),
    [teamSummary?.members, userId],
  );

  // Remove dialog
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);

  // Has unsaved changes?
  const hasChanges = Boolean(member && (
    draftRole !== member.role ||
    (draftDepartmentId === "none" ? null : draftDepartmentId) !== member.departmentId ||
    (draftParentId === "none" ? null : draftParentId) !== member.parentId
  ));

  const invalidateAll = useCallback(() => {
    if (!selectedCompanyId || !userId) return;
    queryClient.invalidateQueries({ queryKey: queryKeys.team.member(selectedCompanyId, userId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.team.summary(selectedCompanyId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.org.tree(selectedCompanyId) });
  }, [queryClient, selectedCompanyId, userId]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: () =>
      teamApi.updateRole(selectedCompanyId!, userId!, {
        role: draftRole,
        projectId: draftRole === "founder" ? null : (draftDepartmentId === "none" ? null : draftDepartmentId),
        parentType: draftParentId === "none" ? null : "user",
        parentId: draftParentId === "none" ? null : draftParentId,
      }),
    onSuccess: () => {
      invalidateAll();
      pushToast({ title: "Settings saved", tone: "success" });
    },
    onError: (err: Error) => pushToast({ title: "Save failed", body: err.message, tone: "error" }),
  });

  useEffect(() => {
    setBreadcrumbs([
      { label: "Team", href: "/org" },
      { label: member?.displayName ?? member?.email ?? "Member" },
    ]);
  }, [setBreadcrumbs, member]);

  if (!selectedCompanyId || !userId) {
    return <EmptyState icon={Users} message="Select a company to view team." />;
  }

  if (isLoading) return <PageSkeleton variant="list" />;

  if (!member) {
    return <EmptyState icon={Users} message="Team member not found" />;
  }

  const displayName = member.displayName ?? member.email ?? member.userId.slice(0, 8);
  const initials = deriveInitials(displayName);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="mb-3">
          <Link to="/org?tab=humans">
            <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground -ml-2">
              <ArrowLeft className="h-4 w-4" />
              Back to Team
            </Button>
          </Link>
        </div>

        <div className="flex items-center gap-4">
          <Avatar className="h-16 w-16 text-lg">
            {member.avatarUrl && <AvatarImage src={member.avatarUrl} alt={displayName} />}
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold truncate">{displayName}</h1>
              <Badge variant="secondary" className={cn("border-0", ROLE_STYLES[member.role])}>
                {ROLE_LABELS[member.role]}
              </Badge>
              {member.isSystemAdmin && (
                <Badge variant="secondary" className="border-0 bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                  <Shield className="mr-1 h-3 w-3" />
                  Admin
                </Badge>
              )}
              {member.isCurrentUser && (
                <Badge variant="outline" className="text-[11px]">You</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              {member.email ?? "No email"} · {member.departmentName ?? "No department"}
            </p>
          </div>

          <Link to={`/team/${userId}/settings`}>
            <Button variant="ghost" size="sm" className="gap-1.5 shrink-0">
              <Settings className="h-4 w-4" />
              <span className="hidden sm:inline">Edit</span>
            </Button>
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <PageTabBar items={TAB_ITEMS} value={activeTab} onValueChange={handleTabChange} />

        {/* ── Overview Tab ── */}
        {activeTab === "overview" && deps && (
          <div className="space-y-4 mt-4">
            {/* Metric cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="rounded-lg border border-border bg-card">
                <MetricCard icon={Users} value={deps.teamMembers.length} label="Reports" />
              </div>
              <div className="rounded-lg border border-border bg-card">
                <MetricCard icon={Bot} value={deps.agentTrees.length} label="Agents" />
              </div>
              <div className="rounded-lg border border-border bg-card">
                <MetricCard icon={ClipboardList} value={deps.assignedTaskCount} label="Assigned Tasks" />
              </div>
              <div className="rounded-lg border border-border bg-card">
                <MetricCard icon={FileText} value={deps.createdTaskCount} label="Created Tasks" />
              </div>
            </div>

            {/* Team Reports */}
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
                <Users className="h-4 w-4" />
                Team Reports ({deps.teamMembers.length})
              </h3>
              {deps.teamMembers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No team members reporting to this person.</p>
              ) : (
                <div className="space-y-1">
                  {deps.teamMembers.map((tm) => (
                    <Link
                      key={tm.userId}
                      to={`/team/${tm.userId}`}
                      className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-accent/50 transition-colors no-underline text-inherit"
                    >
                      <Identity
                        name={tm.displayName ?? tm.email ?? tm.userId.slice(0, 8)}
                        size="sm"
                      />
                      <Badge variant="secondary" className={cn("border-0 text-[10px] ml-auto", ROLE_STYLES[tm.role])}>
                        {ROLE_LABELS[tm.role] ?? tm.role}
                      </Badge>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Agent trees */}
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
                <Bot className="h-4 w-4" />
                Agents ({deps.agentTrees.length})
              </h3>
              {deps.agentTrees.length === 0 ? (
                <p className="text-sm text-muted-foreground">No agents reporting to this person.</p>
              ) : (
                <div className="space-y-1">
                  {deps.agentTrees.map((tree) => (
                    <Link
                      key={tree.rootAgentId}
                      to={`/agents/${tree.rootAgentId}`}
                      className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-accent/50 transition-colors no-underline text-inherit"
                    >
                      <Bot className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="font-medium">{tree.rootAgentName}</span>
                      {tree.subAgentCount > 0 && (
                        <span className="text-muted-foreground text-xs">(+{tree.subAgentCount} sub-agents)</span>
                      )}
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 ml-auto" />
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Settings Tab ── */}
        {activeTab === "settings" && (
          <div className="space-y-4 mt-4">
            {/* Role & Department */}
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="text-sm font-semibold mb-4">Role & Department</h3>
              <div className="space-y-4 max-w-md">
                {/* Role */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Role</label>
                  <Select
                    value={draftRole}
                    onValueChange={(value) => {
                      const nextRole = value as UserRole;
                      setDraftRole(nextRole);
                      if (nextRole === "founder") {
                        setDraftDepartmentId("none");
                        setDraftParentId("none");
                      }
                    }}
                    disabled={!canManageRoles || selfFounderLock || saveMutation.isPending}
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
                </div>

                {/* Department */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Department</label>
                  <Select
                    value={draftDepartmentId}
                    onValueChange={setDraftDepartmentId}
                    disabled={!canManageRoles || draftRole === "founder" || saveMutation.isPending}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No department</SelectItem>
                      {departments.map((dept: Project) => (
                        <SelectItem key={dept.id} value={dept.id}>
                          {dept.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Reports to */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Reports to</label>
                  <Select
                    value={draftParentId}
                    onValueChange={setDraftParentId}
                    disabled={!canManageRoles || saveMutation.isPending}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="No manager" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No manager (root)</SelectItem>
                      {reportsToOptions.map((opt) => (
                        <SelectItem key={opt.userId} value={opt.userId}>
                          {opt.displayName ?? opt.email ?? opt.userId.slice(0, 8)}{" "}
                          <span className="text-muted-foreground">({ROLE_LABELS[opt.role]})</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Save button */}
                <Button
                  onClick={() => saveMutation.mutate()}
                  disabled={!hasChanges || saveMutation.isPending}
                  className="w-full sm:w-auto"
                >
                  {saveMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </div>

            {/* Danger Zone */}
            {canRemove && (
              <div className="rounded-xl border border-destructive/30 bg-card p-5">
                <h3 className="text-sm font-semibold text-destructive mb-2">Danger Zone</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Removing this member will revoke their access to the company. Any tasks assigned to them will need to be reassigned.
                </p>
                <Button
                  variant="destructive"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setRemoveDialogOpen(true)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove from Team
                </Button>
                <ReassignmentDialog
                  companyId={selectedCompanyId!}
                  member={member}
                  allMembers={teamSummary?.members ?? []}
                  open={removeDialogOpen}
                  onOpenChange={setRemoveDialogOpen}
                  onSuccess={() => navigate("/org?tab=humans")}
                />
              </div>
            )}

            {/* Read-only notice for non-admins */}
            {!canManageRoles && (
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-sm text-muted-foreground">
                  You don't have permission to manage roles. Contact a founder or system admin.
                </p>
              </div>
            )}
          </div>
        )}
      </Tabs>
    </div>
  );
}
