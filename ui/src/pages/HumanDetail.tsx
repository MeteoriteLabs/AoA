import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link, useNavigate } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Users,
  Bot,
  ClipboardList,
  FileText,
  Shield,
  Trash2,
  ChevronRight,
  MapPin,
  Clock,
  Link as LinkIcon,
  Activity,
  Camera,
  Pencil,
  X,
} from "lucide-react";
import type {
  ActivityEvent,
  HumanSocialLink,
  HumanSocialLinkType,
  Issue,
  Project,
  UpdateCompanyUserProfile,
  UserRole,
} from "@armyofagents/shared";
import { teamApi } from "../api/team";
import { projectsApi } from "../api/projects";
import { issuesApi } from "../api/issues";
import { activityApi } from "../api/activity";
import { assetsApi } from "../api/assets";
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
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

const HUMAN_SOCIAL_LINK_TYPES: HumanSocialLinkType[] = [
  "linkedin",
  "github",
  "x",
  "instagram",
  "facebook",
  "substack",
  "website",
  "portfolio",
  "youtube",
  "medium",
  "other",
];

const HUMAN_TITLE_OPTIONS = [
  "Founder",
  "Co-Founder",
  "Founder Partner",
  "Founder Operator",
  "CEO",
  "COO",
  "CTO",
  "CPO",
  "Chief of Staff",
  "General Manager",
  "Team Lead",
  "Product Lead",
  "Engineering Lead",
  "Design Lead",
  "Marketing Lead",
  "Sales Lead",
  "Customer Success Lead",
  "Operations Lead",
  "Finance Lead",
  "Legal Lead",
  "People Lead",
  "Product Manager",
  "Engineer",
  "Designer",
  "Researcher",
  "Analyst",
  "Operator",
  "Advisor",
] as const;

const FALLBACK_TIMEZONE_OPTIONS = [
  "UTC",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Amsterdam",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
] as const;

function getTimezoneOptions(): string[] {
  const supported = Intl.supportedValuesOf?.("timeZone") ?? [];
  return Array.from(new Set(["UTC", ...FALLBACK_TIMEZONE_OPTIONS, ...supported])).sort((a, b) => a.localeCompare(b));
}

const FIELD_CLASS =
  "h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

const TEXTAREA_CLASS =
  "min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function compactDate(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function displayIssueStatus(status: string): string {
  return status.replace(/_/g, " ");
}

function displaySocialLabel(link: HumanSocialLink): string {
  return link.label?.trim() || link.type[0].toUpperCase() + link.type.slice(1);
}

function activityTitle(event: ActivityEvent): string | null {
  const title = event.details?.title;
  const name = event.details?.name;
  if (typeof title === "string" && title.trim()) return title;
  if (typeof name === "string" && name.trim()) return name;
  return null;
}

function TaskListSection({
  title,
  icon: Icon,
  tasks,
  isLoading,
  empty,
}: {
  title: string;
  icon: typeof ClipboardList;
  tasks: Array<Issue & { responsibleAgentId?: string }>;
  isLoading: boolean;
  empty: string;
}) {
  const visible = tasks.slice(0, 5);
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Icon className="h-4 w-4" />
          {title}
        </h3>
        {tasks.length > visible.length && (
          <span className="text-xs text-muted-foreground">{tasks.length - visible.length} more</span>
        )}
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="space-y-1">
          {visible.map((task) => (
            <Link
              key={task.id}
              to={`/issues/${task.id}`}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-accent/50 transition-colors no-underline text-inherit"
            >
              <span className="min-w-0">
                <span className="mr-2 text-xs font-medium text-muted-foreground">{task.identifier ?? `#${task.issueNumber ?? ""}`}</span>
                <span className="font-medium">{task.title}</span>
              </span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="capitalize">{displayIssueStatus(task.status)}</span>
                <span>{compactDate(task.updatedAt)}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function ActivitySection({ events, isLoading }: { events: ActivityEvent[]; isLoading: boolean }) {
  const visible = events.slice(0, 6);
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
        <Activity className="h-4 w-4" />
        Activity
      </h3>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">No recent activity by this person.</p>
      ) : (
        <div className="space-y-1">
          {visible.map((event) => {
            const label = activityTitle(event);
            const body = (
              <>
                <span className="font-medium">{event.action}</span>
                {label && <span className="truncate text-muted-foreground">{label}</span>}
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">{compactDate(event.createdAt)}</span>
              </>
            );
            const className = "flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-accent/50 transition-colors no-underline text-inherit";
            return event.entityType === "issue" ? (
              <Link key={event.id} to={`/issues/${event.entityId}`} className={className}>
                {body}
              </Link>
            ) : (
              <div key={event.id} className={className}>
                {body}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
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
    enabled: Boolean(selectedCompanyId),
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
  const directAgentIds = useMemo(
    () => Array.from(new Set((deps?.agentTrees ?? []).flatMap((tree) => tree.agentIds ?? [tree.rootAgentId]))),
    [deps?.agentTrees],
  );
  const departments = useMemo(
    () => (deptQuery.data ?? []).filter((p: Project) => p.type === "department"),
    [deptQuery.data],
  );

  // Settings draft state
  const [draftRole, setDraftRole] = useState<UserRole>("team_member");
  const [draftDepartmentId, setDraftDepartmentId] = useState<string>("none");
  const [draftParentId, setDraftParentId] = useState<string>("none");
  const [profileDraft, setProfileDraft] = useState<UpdateCompanyUserProfile>({
    socialLinks: [],
  });
  const [profileDraftDirty, setProfileDraftDirty] = useState(false);
  const profileDraftSourceKeyRef = useRef<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const [avatarFileDirty, setAvatarFileDirty] = useState(false);
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const timezoneOptions = useMemo(() => getTimezoneOptions(), []);
  const titleOptions = useMemo(
    () => Array.from(new Set([
      ...HUMAN_TITLE_OPTIONS,
      ...(member?.title ? [member.title] : []),
      ...(profileDraft.title ? [profileDraft.title] : []),
    ])).filter(Boolean).sort((a, b) => a.localeCompare(b)),
    [member?.title, profileDraft.title],
  );

  const resetProfileDraftFromMember = useCallback(() => {
    if (!member) return;
    setProfileDraft({
      displayName: member.displayName ?? null,
      title: member.title ?? null,
      bio: member.bio ?? null,
      location: member.location ?? null,
      timezone: member.timezone ?? null,
      socialLinks: member.socialLinks.length > 0
        ? member.socialLinks
        : [{ type: "github", label: null, url: "" }],
    });
    setProfileDraftDirty(false);
    setAvatarFileDirty(false);
  }, [member]);

  // Sync draft state when member loads
  useEffect(() => {
    if (member) {
      const sourceKey = `${selectedCompanyId ?? "none"}:${member.userId}`;
      if (profileDraftSourceKeyRef.current === sourceKey && (profileDraftDirty || avatarFileDirty)) return;
      profileDraftSourceKeyRef.current = sourceKey;
      setDraftRole(member.role);
      setDraftDepartmentId(member.departmentId ?? "none");
      setDraftParentId(member.parentId ?? "none");
      resetProfileDraftFromMember();
    }
  }, [avatarFileDirty, member, profileDraftDirty, resetProfileDraftFromMember, selectedCompanyId]);

  // Permissions
  const currentUser = teamSummary?.currentUser;
  const canManageRoles = currentUser?.permissions?.canManageRoles ?? false;
  const founderCount = useMemo(
    () => (teamSummary?.members ?? []).filter((m) => m.role === "founder").length,
    [teamSummary?.members],
  );
  const isSelf = member?.isCurrentUser ?? false;
  const canEditProfile = isSelf || canManageRoles || (currentUser?.isSystemAdmin ?? false);
  const selfFounderLock = isSelf && member?.role === "founder" && founderCount <= 1;
  const canRemove = canManageRoles && !isSelf && !(member?.role === "founder" && founderCount <= 1);

  const manager = useMemo(
    () => (member?.parentId ? (teamSummary?.members ?? []).find((m) => m.userId === member.parentId) : null),
    [member?.parentId, teamSummary?.members],
  );

  const assignedTasksQuery = useQuery({
    queryKey: selectedCompanyId && userId
      ? ["team", selectedCompanyId, "human", userId, "assigned-tasks", "all"]
      : ["team", "none", "human", "assigned-tasks"],
    queryFn: () => issuesApi.list(selectedCompanyId!, { assigneeUserId: userId!, taskScope: "all" }),
    enabled: Boolean(selectedCompanyId && userId) && activeTab === "overview",
  });

  const createdTasksQuery = useQuery({
    queryKey: selectedCompanyId && userId
      ? ["team", selectedCompanyId, "human", userId, "created-tasks", "all"]
      : ["team", "none", "human", "created-tasks"],
    queryFn: () => issuesApi.list(selectedCompanyId!, { createdByUserId: userId!, taskScope: "all" }),
    enabled: Boolean(selectedCompanyId && userId) && activeTab === "overview",
  });

  const agentTasksQuery = useQuery({
    queryKey: selectedCompanyId && userId
      ? ["team", selectedCompanyId, "human", userId, "responsible-agent-tasks", directAgentIds]
      : ["team", "none", "human", "responsible-agent-tasks"],
    queryFn: async () => {
      const taskLists = await Promise.all(
        directAgentIds.map(async (agentId) => ({
          agentId,
          tasks: await issuesApi.list(selectedCompanyId!, { assigneeAgentId: agentId, taskScope: "all" }),
        })),
      );
      const byId = new Map<string, Issue & { responsibleAgentId?: string }>();
      for (const { agentId, tasks } of taskLists) {
        for (const task of tasks) {
          if (!byId.has(task.id)) byId.set(task.id, { ...task, responsibleAgentId: agentId });
        }
      }
      return Array.from(byId.values());
    },
    enabled: Boolean(selectedCompanyId && userId) && activeTab === "overview" && directAgentIds.length > 0,
  });

  const activityQuery = useQuery({
    queryKey: selectedCompanyId && userId
      ? ["team", selectedCompanyId, "human", userId, "activity", "user"]
      : ["team", "none", "human", "activity"],
    queryFn: () => activityApi.list(selectedCompanyId!, { actorType: "user", actorId: userId! }),
    enabled: Boolean(selectedCompanyId && userId) && activeTab === "overview",
  });

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

  const saveProfileMutation = useMutation({
    mutationFn: (input: UpdateCompanyUserProfile) => teamApi.updateProfile(selectedCompanyId!, userId!, input),
    onSuccess: () => {
      setProfileDraftDirty(false);
      setProfileDialogOpen(false);
      invalidateAll();
      pushToast({ title: "Profile saved", tone: "success" });
    },
    onError: (err: Error) => pushToast({ title: "Profile save failed", body: err.message, tone: "error" }),
  });

  const avatarUploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const asset = await assetsApi.uploadImage(selectedCompanyId!, file, "humans/avatars");
      return teamApi.updateProfile(selectedCompanyId!, userId!, { avatarAssetId: asset.assetId });
    },
    onSuccess: () => {
      setAvatarFileDirty(false);
      invalidateAll();
      pushToast({ title: "Avatar updated", tone: "success" });
    },
    onError: (err: Error) => pushToast({ title: "Avatar update failed", body: err.message, tone: "error" }),
  });

  const removeAvatarMutation = useMutation({
    mutationFn: () => teamApi.updateProfile(selectedCompanyId!, userId!, { avatarAssetId: null }),
    onSuccess: () => {
      invalidateAll();
      pushToast({ title: "Avatar removed", tone: "success" });
    },
    onError: (err: Error) => pushToast({ title: "Avatar remove failed", body: err.message, tone: "error" }),
  });

  const saveProfile = useCallback(() => {
    const socialLinks = (profileDraft.socialLinks ?? [])
      .map((link) => ({
        type: link.type,
        label: link.label?.trim() ? link.label.trim() : null,
        url: link.url.trim(),
      }))
      .filter((link) => link.url.length > 0);

    saveProfileMutation.mutate({
      displayName: profileDraft.displayName?.trim() ? profileDraft.displayName.trim() : null,
      title: profileDraft.title?.trim() ? profileDraft.title.trim() : null,
      bio: profileDraft.bio?.trim() ? profileDraft.bio.trim() : null,
      location: profileDraft.location?.trim() ? profileDraft.location.trim() : null,
      timezone: profileDraft.timezone?.trim() ? profileDraft.timezone.trim() : null,
      socialLinks,
    });
  }, [profileDraft, saveProfileMutation]);

  const updateSocialLink = useCallback((index: number, patch: Partial<HumanSocialLink>) => {
    setProfileDraftDirty(true);
    setProfileDraft((current) => {
      const links = [...(current.socialLinks ?? [])];
      links[index] = { ...links[index], ...patch } as HumanSocialLink;
      return { ...current, socialLinks: links };
    });
  }, []);

  useEffect(() => {
    setBreadcrumbs([
      { label: "Team", href: "/team" },
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
  const headerMeta = [
    member.location ? { icon: MapPin, label: member.location } : null,
    member.timezone ? { icon: Clock, label: member.timezone } : null,
  ].filter(Boolean) as Array<{ icon: typeof MapPin; label: string }>;
  const canRemoveAvatar = Boolean(member.avatarUrl) || avatarUploadMutation.isSuccess;

  return (
    <div className="space-y-6">
      <Link to="/team?tab=humans" className="inline-flex no-underline">
        <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground -ml-2">
          <ArrowLeft className="h-4 w-4" />
          Back to Team
        </Button>
      </Link>

      {/* Header */}
      <div className="relative rounded-2xl border border-border bg-card p-5 pr-16">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="absolute right-4 top-4"
          aria-label="Edit profile"
          onClick={() => setProfileDialogOpen(true)}
        >
          <Pencil className="h-4 w-4" />
        </Button>

        <div className="grid gap-4 sm:grid-cols-[4rem_minmax(0,1fr)] sm:items-start">
          <Avatar
            data-testid="human-profile-avatar"
            shape="squircle"
            className="h-16 w-16 border border-border bg-accent text-lg shadow-sm sm:mt-1"
          >
            {member.avatarUrl && <AvatarImage src={member.avatarUrl} alt={displayName} />}
            <AvatarFallback className="bg-accent text-foreground font-semibold">{initials}</AvatarFallback>
          </Avatar>

          <div className="min-w-0">
            <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center">
              <h1 className="min-w-0 text-2xl font-bold leading-tight">{displayName}</h1>
              <div className="flex flex-wrap items-center gap-2">
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
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              {member.email ?? "No email"} · {member.departmentName ?? "No department"}
            </p>
            {member.title && <p className="mt-2 text-sm font-medium text-foreground">{member.title}</p>}
            {member.bio && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{member.bio}</p>}
            {(headerMeta.length > 0 || member.socialLinks.length > 0) && (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {headerMeta.map(({ icon: Icon, label }) => (
                  <span key={label} className="inline-flex min-w-0 items-center gap-1 rounded-md border border-border px-2 py-1">
                    <Icon className="h-3 w-3 shrink-0" />
                    <span className="truncate">{label}</span>
                  </span>
                ))}
                {member.socialLinks.map((social) => (
                  <a
                    key={`${social.type}-${social.url}`}
                    href={social.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-w-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-muted-foreground no-underline hover:text-foreground"
                  >
                    <LinkIcon className="h-3 w-3 shrink-0" />
                    <span className="truncate">{displaySocialLabel(social)}</span>
                  </a>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>

      <Dialog
        open={profileDialogOpen}
        onOpenChange={(open) => {
          setProfileDialogOpen(open);
          if (!open) resetProfileDraftFromMember();
        }}
      >
        <DialogContent className="flex max-h-[90vh] overflow-hidden sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Edit Profile</DialogTitle>
            <DialogDescription className="sr-only">
              Update this person's company profile identity.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="min-h-0 flex-1 space-y-5 overflow-y-auto">
            <div className="rounded-lg border border-border bg-muted/25 p-4">
              <div className="mb-4">
                <p className="text-sm font-semibold">Company profile identity</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="relative shrink-0">
                  <Avatar
                    shape="squircle"
                    className="h-16 w-16 border border-border bg-accent text-lg shadow-sm"
                  >
                    {member.avatarUrl && <AvatarImage src={member.avatarUrl} alt={displayName} />}
                    <AvatarFallback className="bg-accent text-foreground font-semibold">{initials}</AvatarFallback>
                  </Avatar>
                  <input
                    ref={avatarInputRef}
                    id="human-avatar"
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    aria-label="Change avatar"
                    disabled={!canEditProfile || avatarUploadMutation.isPending}
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      setAvatarFileDirty(true);
                      if (file) avatarUploadMutation.mutate(file);
                      event.target.value = "";
                    }}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon-sm"
                    className="absolute -bottom-2 -right-2 h-7 w-7 rounded-md border border-border shadow-sm"
                    disabled={!canEditProfile || avatarUploadMutation.isPending}
                    aria-label="Choose avatar image"
                    onClick={() => avatarInputRef.current?.click()}
                  >
                    <Camera className="h-3.5 w-3.5" />
                  </Button>
                  {canRemoveAvatar && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="absolute -left-2 -top-2 h-6 w-6 rounded-md border border-border bg-card shadow-sm"
                      disabled={!canEditProfile || removeAvatarMutation.isPending}
                      onClick={() => removeAvatarMutation.mutate()}
                      aria-label="Remove avatar"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium">{displayName}</p>
                  <p className="text-xs text-muted-foreground">{member.email ?? "No email"}</p>
                </div>
                <div className="ml-auto">
                  {!canEditProfile && <Badge variant="outline" className="text-[10px]">Read only</Badge>}
                  {avatarUploadMutation.isPending && <Badge variant="outline" className="text-[10px]">Uploading</Badge>}
                </div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="human-display-name" className="text-xs font-medium text-muted-foreground">Display name</label>
                <input
                  id="human-display-name"
                  className={FIELD_CLASS}
                  value={profileDraft.displayName ?? ""}
                  disabled={!canEditProfile || saveProfileMutation.isPending}
                  onChange={(event) => {
                    setProfileDraftDirty(true);
                    setProfileDraft((current) => ({ ...current, displayName: event.target.value }));
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="human-title" className="text-xs font-medium text-muted-foreground">Title</label>
                <select
                  id="human-title"
                  className={FIELD_CLASS}
                  value={profileDraft.title ?? ""}
                  disabled={!canEditProfile || saveProfileMutation.isPending}
                  onChange={(event) => {
                    setProfileDraftDirty(true);
                    setProfileDraft((current) => ({ ...current, title: event.target.value || null }));
                  }}
                >
                  <option value="">No title</option>
                  {titleOptions.map((title) => (
                    <option key={title} value={title}>{title}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="human-location" className="text-xs font-medium text-muted-foreground">Location</label>
                <input
                  id="human-location"
                  className={FIELD_CLASS}
                  value={profileDraft.location ?? ""}
                  disabled={!canEditProfile || saveProfileMutation.isPending}
                  onChange={(event) => {
                    setProfileDraftDirty(true);
                    setProfileDraft((current) => ({ ...current, location: event.target.value }));
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="human-timezone" className="text-xs font-medium text-muted-foreground">Timezone</label>
                <select
                  id="human-timezone"
                  className={FIELD_CLASS}
                  value={profileDraft.timezone ?? ""}
                  disabled={!canEditProfile || saveProfileMutation.isPending}
                  onChange={(event) => {
                    setProfileDraftDirty(true);
                    setProfileDraft((current) => ({ ...current, timezone: event.target.value || null }));
                  }}
                >
                  <option value="">No timezone</option>
                  {timezoneOptions.map((timezone) => (
                    <option key={timezone} value={timezone}>{timezone}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="human-bio" className="text-xs font-medium text-muted-foreground">Bio</label>
              <textarea
                id="human-bio"
                className={TEXTAREA_CLASS}
                value={profileDraft.bio ?? ""}
                disabled={!canEditProfile || saveProfileMutation.isPending}
                onChange={(event) => {
                  setProfileDraftDirty(true);
                  setProfileDraft((current) => ({ ...current, bio: event.target.value }));
                }}
              />
            </div>

            <div className="space-y-3">
              {(profileDraft.socialLinks ?? []).map((link, index) => (
                <div key={index} className="grid gap-3 md:grid-cols-[150px_minmax(0,1fr)_minmax(0,2fr)_auto]">
                  <div className="space-y-1.5">
                    <label htmlFor={`human-social-type-${index}`} className="text-xs font-medium text-muted-foreground">Type</label>
                    <select
                      id={`human-social-type-${index}`}
                      className={FIELD_CLASS}
                      value={link.type}
                      disabled={!canEditProfile || saveProfileMutation.isPending}
                      onChange={(event) => updateSocialLink(index, { type: event.target.value as HumanSocialLinkType })}
                    >
                      {HUMAN_SOCIAL_LINK_TYPES.map((type) => (
                        <option key={type} value={type}>{type}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor={`human-social-label-${index}`} className="text-xs font-medium text-muted-foreground">Label</label>
                    <input
                      id={`human-social-label-${index}`}
                      className={FIELD_CLASS}
                      value={link.label ?? ""}
                      disabled={!canEditProfile || saveProfileMutation.isPending}
                      onChange={(event) => updateSocialLink(index, { label: event.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor={`human-social-url-${index}`} className="text-xs font-medium text-muted-foreground">URL</label>
                    <input
                      id={`human-social-url-${index}`}
                      className={FIELD_CLASS}
                      value={link.url}
                      disabled={!canEditProfile || saveProfileMutation.isPending}
                      onChange={(event) => updateSocialLink(index, { url: event.target.value })}
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={!canEditProfile || saveProfileMutation.isPending}
                      onClick={() => {
                        setProfileDraftDirty(true);
                        setProfileDraft((current) => ({
                          ...current,
                          socialLinks: (current.socialLinks ?? []).filter((_, i) => i !== index),
                        }));
                      }}
                      aria-label="Remove social link"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!canEditProfile || saveProfileMutation.isPending}
                onClick={() => {
                  setProfileDraftDirty(true);
                  setProfileDraft((current) => ({
                    ...current,
                    socialLinks: [...(current.socialLinks ?? []), { type: "website", label: null, url: "" }],
                  }));
                }}
              >
                Add Social Link
              </Button>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setProfileDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={saveProfile}
              disabled={!canEditProfile || saveProfileMutation.isPending}
            >
              {saveProfileMutation.isPending ? "Saving..." : "Save Profile"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

            <section className="rounded-xl border border-border bg-card p-4">
              <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
                <Shield className="h-4 w-4" />
                Authority
              </h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Role</p>
                  <p className="mt-1 text-sm">{ROLE_LABELS[member.role]}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Department</p>
                  <p className="mt-1 text-sm">{member.departmentName ?? "No department"}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Reports to</p>
                  <p className="mt-1 text-sm">{manager?.displayName ?? manager?.email ?? "No manager"}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Access</p>
                  <p className="mt-1 text-sm">{member.isSystemAdmin ? "System admin" : "Company member"}</p>
                </div>
              </div>
              {member.permissions.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {member.permissions.slice(0, 6).map((permission) => (
                    <Badge key={permission} variant="outline" className="max-w-full truncate text-[10px]">
                      {permission}
                    </Badge>
                  ))}
                </div>
              )}
            </section>

            <div className="grid gap-4 xl:grid-cols-2">
              <TaskListSection
                title="Assigned Tasks"
                icon={ClipboardList}
                tasks={assignedTasksQuery.data ?? []}
                isLoading={assignedTasksQuery.isLoading}
                empty="No tasks assigned directly to this person."
              />
              <TaskListSection
                title="Created Tasks"
                icon={FileText}
                tasks={createdTasksQuery.data ?? []}
                isLoading={createdTasksQuery.isLoading}
                empty="No tasks created by this person."
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <TaskListSection
                title="Responsible Agent Tasks"
                icon={Bot}
                tasks={agentTasksQuery.data ?? []}
                isLoading={agentTasksQuery.isLoading}
                empty="No active tasks assigned to this person's agent tree."
              />
              <ActivitySection
                events={activityQuery.data ?? []}
                isLoading={activityQuery.isLoading}
              />
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
                  onSuccess={() => navigate("/team?tab=humans")}
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
