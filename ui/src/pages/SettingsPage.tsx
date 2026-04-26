import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "@/lib/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { companiesApi } from "../api/companies";
import { accessApi } from "../api/access";
import { costsApi } from "../api/costs";
import { budgetsApi } from "../api/budgets";
import type { ResolveBudgetIncidentInput } from "@armyofagents/shared";
import { activityApi } from "../api/activity";
import { agentsApi } from "../api/agents";
import { issuesApi } from "../api/issues";
import { projectsApi } from "../api/projects";
import { goalsApi } from "../api/goals";
import { mcpApi } from "../api/mcp";
import { pluginsApi, type CompanyPluginSetting } from "../api/plugins";
import { internalAgentApi } from "../api/internal-agent";
import { queryKeys } from "../lib/queryKeys";
import { formatCents, formatTokens, budgetProgressColor } from "../lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Settings,
  ArrowRight,
  Check,
  ChevronRight,
  DollarSign,
  History,
  Plus,
  Puzzle,
  Upload,
  X,
} from "lucide-react";
import { CompanyPatternIcon } from "../components/CompanyPatternIcon";
import {
  Field,
  ToggleField,
  HintIcon,
} from "../components/agent-config-primitives";
import { LLMProvidersSection } from "../components/LLMProvidersSection";
import { GitHubIntegrationCard } from "../components/GitHubIntegrationCard";
import { PageTabBar } from "../components/PageTabBar";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { Identity } from "../components/Identity";
import { StatusBadge } from "../components/StatusBadge";
import { ActivityRow } from "../components/ActivityRow";
import { CreateBudgetPolicyDialog } from "../components/finance/CreateBudgetPolicyDialog";
import type { Agent } from "@armyofagents/shared";

const SETTINGS_TABS = [
  { value: "general", label: "General" },
  { value: "llm", label: "LLM Providers" },
  { value: "budget", label: "Budget" },
  { value: "activity", label: "Activity" },
  { value: "integrations", label: "Integrations" },
  { value: "plugins", label: "Plugins" },
];

// ─── Agent snippet helpers (from CompanySettings.tsx) ─────────────────
type AgentSnippetInput = {
  onboardingTextUrl: string;
  connectionCandidates?: string[] | null;
  testResolutionUrl?: string | null;
};

function buildCandidateOnboardingUrls(input: AgentSnippetInput): string[] {
  const candidates = (input.connectionCandidates ?? [])
    .map((candidate) => candidate.trim())
    .filter(Boolean);
  const urls = new Set<string>();
  let onboardingUrl: URL | null = null;

  try {
    onboardingUrl = new URL(input.onboardingTextUrl);
    urls.add(onboardingUrl.toString());
  } catch {
    const trimmed = input.onboardingTextUrl.trim();
    if (trimmed) {
      urls.add(trimmed);
    }
  }

  if (!onboardingUrl) {
    for (const candidate of candidates) {
      urls.add(candidate);
    }
    return Array.from(urls);
  }

  const onboardingPath = `${onboardingUrl.pathname}${onboardingUrl.search}`;
  for (const candidate of candidates) {
    try {
      const base = new URL(candidate);
      urls.add(`${base.origin}${onboardingPath}`);
    } catch {
      urls.add(candidate);
    }
  }

  return Array.from(urls);
}

function buildResolutionTestUrl(input: AgentSnippetInput): string | null {
  const explicit = input.testResolutionUrl?.trim();
  if (explicit) return explicit;

  try {
    const onboardingUrl = new URL(input.onboardingTextUrl);
    const testPath = onboardingUrl.pathname.replace(
      /\/onboarding\.txt$/,
      "/test-resolution"
    );
    return `${onboardingUrl.origin}${testPath}`;
  } catch {
    return null;
  }
}

function buildAgentSnippet(input: AgentSnippetInput) {
  const candidateUrls = buildCandidateOnboardingUrls(input);
  const resolutionTestUrl = buildResolutionTestUrl(input);

  const candidateList =
    candidateUrls.length > 0
      ? candidateUrls.map((u) => `- ${u}`).join("\n")
      : "- (No candidate URLs available yet.)";

  const connectivityBlock =
    candidateUrls.length === 0
      ? `No candidate URLs are available. Ask your user to configure a reachable hostname in AoA, then retry.
Suggested steps:
- choose a hostname that resolves to the AoA host from your runtime
- run: pnpm aoa allowed-hostname <host>
- restart AoA
- verify with: curl -fsS http://<host>:3100/api/health
- regenerate this invite snippet`
      : `If none are reachable, ask your user to add a reachable hostname in AoA, restart, and retry.
Suggested command:
- pnpm aoa allowed-hostname <host>
Then verify with: curl -fsS <base-url>/api/health`;

  const resolutionLine = resolutionTestUrl
    ? `\nYou MUST test callback reachability, call: ${resolutionTestUrl}?url=<urlencoded-webhook-url> (well using the hostname that worked above). Do not assume your 172.x is necessarily reachable from AoA. Test it. `
    : "";

  return `You're invited to join an AoA organization.

The URLs you should try are:
${candidateList}

Connectivity guidance:
If you are running on a different machine than AoA, AoA must be reachable at one of the hostnames used above.
Verify the hostname works from your runtime with: GET <base-url>/api/health

${connectivityBlock}

For your "agentName", just use your own agent name (OpenClaw or whatever your name is) and send it directly.
You also need to send a webhook URL that AoA can access. Check your config and include that URL.${resolutionLine}

---

In order for AoA to work smoothly, you need to enable \`gateway.http.endpoints.responses.enabled=true\` in your OpenClaw config.

Please enable that setting and notify your user that we did so.

Before you do anything, please respond to your user that you understand the instructions and you're going to work on them. Then do the step above in another session called "paperclip-onboarding" and then tell your user when you're done. Update your user in intermediate steps along the way so they know what's going on.

Then after you've connected to AoA (exchanged keys etc.) you MUST review and follow the onboarding instructions in onboarding.txt they give you.

`;
}

// ─── Budget date range helpers (from Costs.tsx) ───────────────────────
type DatePreset = "mtd" | "7d" | "30d" | "ytd" | "all" | "custom";

const PRESET_LABELS: Record<DatePreset, string> = {
  mtd: "Month to Date",
  "7d": "Last 7 Days",
  "30d": "Last 30 Days",
  ytd: "Year to Date",
  all: "All Time",
  custom: "Custom",
};

function computeRange(preset: DatePreset): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString();
  switch (preset) {
    case "mtd": {
      const d = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: d.toISOString(), to };
    }
    case "7d": {
      const d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return { from: d.toISOString(), to };
    }
    case "30d": {
      const d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return { from: d.toISOString(), to };
    }
    case "ytd": {
      const d = new Date(now.getFullYear(), 0, 1);
      return { from: d.toISOString(), to };
    }
    case "all":
      return { from: "", to: "" };
    case "custom":
      return { from: "", to: "" };
  }
}

// ─── General Section ──────────────────────────────────────────────────
function GeneralSection() {
  const {
    companies,
    selectedCompany,
    selectedCompanyId,
    setSelectedCompanyId,
  } = useCompany();
  const queryClient = useQueryClient();

  const [companyName, setCompanyName] = useState("");
  const [description, setDescription] = useState("");
  const [brandColor, setBrandColor] = useState("");

  useEffect(() => {
    if (!selectedCompany) return;
    setCompanyName(selectedCompany.name);
    setDescription(selectedCompany.description ?? "");
    setBrandColor(selectedCompany.brandColor ?? "");
  }, [selectedCompany]);

  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSnippet, setInviteSnippet] = useState<string | null>(null);
  const [snippetCopied, setSnippetCopied] = useState(false);
  const [snippetCopyDelightId, setSnippetCopyDelightId] = useState(0);
  const [archiveCompanyConfirmOpen, setArchiveCompanyConfirmOpen] = useState(false);

  const generalDirty =
    !!selectedCompany &&
    (companyName !== selectedCompany.name ||
      description !== (selectedCompany.description ?? "") ||
      brandColor !== (selectedCompany.brandColor ?? ""));

  const generalMutation = useMutation({
    mutationFn: (data: {
      name: string;
      description: string | null;
      brandColor: string | null;
    }) => companiesApi.update(selectedCompanyId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
    },
  });

  const logoInputRef = useRef<HTMLInputElement>(null);
  const logoUploadMutation = useMutation({
    mutationFn: (file: File) => companiesApi.uploadLogo(selectedCompanyId!, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.detail(selectedCompanyId!) });
    },
  });
  const logoRemoveMutation = useMutation({
    mutationFn: () => companiesApi.removeLogo(selectedCompanyId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.detail(selectedCompanyId!) });
    },
  });

  const settingsMutation = useMutation({
    mutationFn: (requireApproval: boolean) =>
      companiesApi.update(selectedCompanyId!, {
        requireBoardApprovalForNewAgents: requireApproval,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
    },
  });

  const inviteMutation = useMutation({
    mutationFn: () =>
      accessApi.createCompanyInvite(selectedCompanyId!, {
        allowedJoinTypes: "agent",
      }),
    onSuccess: async (invite) => {
      setInviteError(null);
      const base = window.location.origin.replace(/\/+$/, "");
      const onboardingTextLink =
        invite.onboardingTextUrl ??
        invite.onboardingTextPath ??
        `/api/invites/${invite.token}/onboarding.txt`;
      const absoluteUrl = onboardingTextLink.startsWith("http")
        ? onboardingTextLink
        : `${base}${onboardingTextLink}`;
      setSnippetCopied(false);
      setSnippetCopyDelightId(0);
      let snippet: string;
      try {
        const manifest = await accessApi.getInviteOnboarding(invite.token);
        snippet = buildAgentSnippet({
          onboardingTextUrl: absoluteUrl,
          connectionCandidates:
            manifest.onboarding.connectivity?.connectionCandidates ?? null,
          testResolutionUrl:
            manifest.onboarding.connectivity?.testResolutionEndpoint?.url ??
            null,
        });
      } catch {
        snippet = buildAgentSnippet({
          onboardingTextUrl: absoluteUrl,
          connectionCandidates: null,
          testResolutionUrl: null,
        });
      }
      setInviteSnippet(snippet);
      try {
        await navigator.clipboard.writeText(snippet);
        setSnippetCopied(true);
        setSnippetCopyDelightId((prev) => prev + 1);
        setTimeout(() => setSnippetCopied(false), 2000);
      } catch {
        /* clipboard may not be available */
      }
      queryClient.invalidateQueries({
        queryKey: queryKeys.sidebarBadges(selectedCompanyId!),
      });
    },
    onError: (err) => {
      setInviteError(
        err instanceof Error ? err.message : "Failed to create invite"
      );
    },
  });

  useEffect(() => {
    setInviteError(null);
    setInviteSnippet(null);
    setSnippetCopied(false);
    setSnippetCopyDelightId(0);
  }, [selectedCompanyId]);

  const archiveMutation = useMutation({
    mutationFn: ({
      companyId,
      nextCompanyId,
    }: {
      companyId: string;
      nextCompanyId: string | null;
    }) => companiesApi.archive(companyId).then(() => ({ nextCompanyId })),
    onSuccess: async ({ nextCompanyId }) => {
      if (nextCompanyId) {
        setSelectedCompanyId(nextCompanyId);
      }
      await queryClient.invalidateQueries({
        queryKey: queryKeys.companies.all,
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.companies.stats,
      });
    },
  });

  if (!selectedCompany) {
    return (
      <div className="text-sm text-muted-foreground">
        No company selected. Select a company from the switcher above.
      </div>
    );
  }

  function handleSaveGeneral() {
    generalMutation.mutate({
      name: companyName.trim(),
      description: description.trim() || null,
      brandColor: brandColor || null,
    });
  }

  return (
    <div className="space-y-6">
      {/* General */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          General
        </div>
        <div className="space-y-3 rounded-md border border-border px-4 py-4">
          <Field label="Company name" hint="The display name for your company.">
            <input
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
            />
          </Field>
          <Field
            label="Description"
            hint="Optional description shown in the company profile."
          >
            <input
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
              type="text"
              value={description}
              placeholder="Optional company description"
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
        </div>
      </div>

      {/* Appearance */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Appearance
        </div>
        <div className="space-y-3 rounded-md border border-border px-4 py-4">
          {/* Logo */}
          <Field label="Company logo" hint="Displayed in sidebar and lobby. Recommended: square image, at least 128x128.">
            <div className="flex items-center gap-3">
              {selectedCompany.logoAssetId ? (
                <img
                  src={`/api/assets/${selectedCompany.logoAssetId}/content`}
                  alt={selectedCompany.name}
                  className="w-16 h-16 rounded-lg object-cover border border-border"
                />
              ) : (
                <CompanyPatternIcon
                  companyName={companyName || selectedCompany.name}
                  brandColor={brandColor || null}
                  className="rounded-lg"
                />
              )}
              <div className="flex flex-col gap-1.5">
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) logoUploadMutation.mutate(file);
                    e.target.value = "";
                  }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => logoInputRef.current?.click()}
                  disabled={logoUploadMutation.isPending}
                >
                  <Upload className="h-3.5 w-3.5 mr-1.5" />
                  {logoUploadMutation.isPending ? "Uploading..." : "Upload logo"}
                </Button>
                {selectedCompany.logoAssetId && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs text-muted-foreground"
                    onClick={() => logoRemoveMutation.mutate()}
                    disabled={logoRemoveMutation.isPending}
                  >
                    <X className="h-3 w-3 mr-1" />
                    Remove
                  </Button>
                )}
                {logoUploadMutation.isError && (
                  <span className="text-xs text-destructive">
                    {logoUploadMutation.error instanceof Error
                      ? logoUploadMutation.error.message
                      : "Upload failed"}
                  </span>
                )}
              </div>
            </div>
          </Field>

          {/* Brand color + icon preview */}
          <div className="flex items-start gap-4">
            <div className="shrink-0">
              <CompanyPatternIcon
                companyName={companyName || selectedCompany.name}
                brandColor={brandColor || null}
                className="rounded-[14px]"
              />
            </div>
            <div className="flex-1 space-y-2">
              <Field
                label="Brand color"
                hint="Sets the hue for the company icon. Leave empty for auto-generated color."
              >
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={brandColor || "#6366f1"}
                    onChange={(e) => setBrandColor(e.target.value)}
                    className="h-8 w-8 cursor-pointer rounded border border-border bg-transparent p-0"
                  />
                  <input
                    type="text"
                    value={brandColor}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "" || /^#[0-9a-fA-F]{0,6}$/.test(v)) {
                        setBrandColor(v);
                      }
                    }}
                    placeholder="Auto"
                    className="w-28 rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm font-mono outline-none"
                  />
                  {brandColor && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setBrandColor("")}
                      className="text-xs text-muted-foreground"
                    >
                      Clear
                    </Button>
                  )}
                </div>
              </Field>
            </div>
          </div>
        </div>
      </div>

      {/* Save button for General + Appearance */}
      {generalDirty && (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleSaveGeneral}
            disabled={generalMutation.isPending || !companyName.trim()}
          >
            {generalMutation.isPending ? "Saving..." : "Save changes"}
          </Button>
          {generalMutation.isSuccess && (
            <span className="text-xs text-muted-foreground">Saved</span>
          )}
          {generalMutation.isError && (
            <span className="text-xs text-destructive">
              {generalMutation.error instanceof Error
                ? generalMutation.error.message
                : "Failed to save"}
            </span>
          )}
        </div>
      )}

      {/* Hiring */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Hiring
        </div>
        <div className="rounded-md border border-border px-4 py-3">
          <ToggleField
            label="Require board approval for new hires"
            hint="New agent hires stay pending until approved by board."
            checked={!!selectedCompany.requireBoardApprovalForNewAgents}
            onChange={(v) => settingsMutation.mutate(v)}
          />
        </div>
      </div>

      {/* Invites */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Invites
        </div>
        <div className="space-y-3 rounded-md border border-border px-4 py-4">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">
              Generate an agent snippet for join flows.
            </span>
            <HintIcon text="Creates an agent-only invite (10m) and renders a copy-ready snippet." />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => inviteMutation.mutate()}
              disabled={inviteMutation.isPending}
            >
              {inviteMutation.isPending
                ? "Generating..."
                : "Generate agent snippet"}
            </Button>
          </div>
          {inviteError && (
            <p className="text-sm text-destructive">{inviteError}</p>
          )}
          {inviteSnippet && (
            <div className="rounded-md border border-border bg-muted/30 p-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-muted-foreground">
                  Agent Snippet
                </div>
                {snippetCopied && (
                  <span
                    key={snippetCopyDelightId}
                    className="flex items-center gap-1 text-xs text-green-600 animate-pulse"
                  >
                    <Check className="h-3 w-3" />
                    Copied
                  </span>
                )}
              </div>
              <div className="mt-1 space-y-1.5">
                <textarea
                  className="h-[28rem] w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs outline-none"
                  value={inviteSnippet}
                  readOnly
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(inviteSnippet);
                        setSnippetCopied(true);
                        setSnippetCopyDelightId((prev) => prev + 1);
                        setTimeout(() => setSnippetCopied(false), 2000);
                      } catch {
                        /* clipboard may not be available */
                      }
                    }}
                  >
                    {snippetCopied ? "Copied snippet" : "Copy snippet"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Company Data */}
      <div className="space-y-3">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Company Data
        </div>
        <Link
          to="/export"
          className="flex items-center justify-between rounded-md border border-border p-3 hover:bg-muted/50 transition-colors"
        >
          <div>
            <p className="text-sm font-medium">Export Company</p>
            <p className="text-xs text-muted-foreground">
              Package this company into a portable bundle.
            </p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>
      </div>

      {/* Danger Zone */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-destructive uppercase tracking-wide">
          Danger Zone
        </div>
        <div className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-4">
          <p className="text-sm text-muted-foreground">
            Archive this company to hide it from the sidebar. This persists in
            the database.
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={
                archiveMutation.isPending ||
                selectedCompany.status === "archived"
              }
              onClick={() => setArchiveCompanyConfirmOpen(true)}
            >
              {archiveMutation.isPending
                ? "Archiving..."
                : selectedCompany.status === "archived"
                  ? "Already archived"
                  : "Archive company"}
            </Button>
            {archiveMutation.isError && (
              <span className="text-xs text-destructive">
                {archiveMutation.error instanceof Error
                  ? archiveMutation.error.message
                  : "Failed to archive company"}
              </span>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={archiveCompanyConfirmOpen}
        onOpenChange={setArchiveCompanyConfirmOpen}
        title={selectedCompany ? `Archive company "${selectedCompany.name}"?` : "Archive company?"}
        description="It will be hidden from the sidebar."
        confirmLabel="Archive"
        onConfirm={() => {
          if (!selectedCompanyId) return;
          const nextCompanyId =
            companies.find(
              (company) =>
                company.id !== selectedCompanyId &&
                company.status !== "archived"
            )?.id ?? null;
          archiveMutation.mutate({
            companyId: selectedCompanyId,
            nextCompanyId,
          });
          setArchiveCompanyConfirmOpen(false);
        }}
      />
    </div>
  );
}

// ─── Budget Section ───────────────────────────────────────────────────
function BudgetSection() {
  const { selectedCompanyId } = useCompany();

  const [preset, setPreset] = useState<DatePreset>("mtd");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [newPolicyOpen, setNewPolicyOpen] = useState(false);

  const { from, to } = useMemo(() => {
    if (preset === "custom") {
      return {
        from: customFrom ? new Date(customFrom).toISOString() : "",
        to: customTo
          ? new Date(customTo + "T23:59:59.999Z").toISOString()
          : "",
      };
    }
    return computeRange(preset);
  }, [preset, customFrom, customTo]);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.costs(
      selectedCompanyId!,
      from || undefined,
      to || undefined
    ),
    queryFn: async () => {
      const [summary, byAgent, byProject] = await Promise.all([
        costsApi.summary(selectedCompanyId!, from || undefined, to || undefined),
        costsApi.byAgent(selectedCompanyId!, from || undefined, to || undefined),
        costsApi.byProject(
          selectedCompanyId!,
          from || undefined,
          to || undefined
        ),
      ]);
      return { summary, byAgent, byProject };
    },
    enabled: !!selectedCompanyId,
  });

  const { data: agentConfig } = useQuery({
    queryKey: queryKeys.agentConfig(selectedCompanyId!),
    queryFn: () => internalAgentApi.getConfig(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: budgetOverview, refetch: refetchOverview } = useQuery({
    queryKey: ["budgets", "overview", selectedCompanyId],
    queryFn: () => budgetsApi.overview(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const resolveIncident = useMutation({
    mutationFn: ({ incidentId, input }: { incidentId: string; input: ResolveBudgetIncidentInput }) =>
      budgetsApi.resolveIncident(selectedCompanyId!, incidentId, input),
    onSuccess: () => { refetchOverview(); },
  });

  if (!selectedCompanyId) {
    return (
      <EmptyState
        icon={DollarSign}
        message="Select a company to view budget."
      />
    );
  }

  if (isLoading) {
    return <PageSkeleton variant="costs" />;
  }

  const presetKeys: DatePreset[] = [
    "mtd",
    "7d",
    "30d",
    "ytd",
    "all",
    "custom",
  ];

  return (
    <div className="space-y-6">
      {/* Cross-link to full Budget page (primary entry point for finance analytics) */}
      <div className="flex flex-wrap items-stretch gap-3">
        <Link
          to="../budget"
          className="group flex-1 min-w-[260px] flex items-center justify-between gap-3 rounded-md border border-primary/40 bg-primary/5 px-4 py-3 hover:bg-primary/10 hover:border-primary/60 transition-colors"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium">Open full Budget page</p>
            <p className="text-xs text-muted-foreground">
              Breakdown, budgets, quotas, and the finance ledger in one place. This tab shows a quick summary.
            </p>
          </div>
          <ArrowRight className="h-4 w-4 text-primary group-hover:translate-x-0.5 transition-transform shrink-0" />
        </Link>
        <Button
          variant="outline"
          className="shrink-0 self-center"
          onClick={() => setNewPolicyOpen(true)}
        >
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          New Budget Policy
        </Button>
      </div>

      <CreateBudgetPolicyDialog
        open={newPolicyOpen}
        onOpenChange={setNewPolicyOpen}
        onCreated={() => refetchOverview()}
      />

      {/* Date range selector */}
      <div className="flex flex-wrap items-center gap-2">
        {presetKeys.map((p) => (
          <Button
            key={p}
            variant={preset === p ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setPreset(p)}
          >
            {PRESET_LABELS[p]}
          </Button>
        ))}
        {preset === "custom" && (
          <div className="flex items-center gap-2 ml-2">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
            />
            <span className="text-sm text-muted-foreground">to</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
            />
          </div>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {data && (
        <>
          {/* Summary card */}
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {PRESET_LABELS[preset]}
                </p>
                {data.summary.budgetCents > 0 && (
                  <p className="text-sm text-muted-foreground">
                    {data.summary.utilizationPercent}% utilized
                  </p>
                )}
              </div>
              <p className="text-2xl font-bold">
                {formatCents(
                  data.summary.spendCents +
                    (agentConfig?.spentMonthlyCents ?? 0),
                )}{" "}
                <span className="text-base font-normal text-muted-foreground">
                  {data.summary.budgetCents > 0
                    ? `/ ${formatCents(data.summary.budgetCents)}`
                    : "Unlimited budget"}
                </span>
              </p>
              {data.summary.budgetCents > 0 && (
                <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-[width,background-color] duration-150 ${
                      data.summary.utilizationPercent > 90
                        ? "bg-red-400"
                        : data.summary.utilizationPercent > 70
                          ? "bg-yellow-400"
                          : "bg-green-400"
                    }`}
                    style={{
                      width: `${Math.min(100, data.summary.utilizationPercent)}%`,
                    }}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* By Agent / By Project */}
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardContent className="p-4">
                <h3 className="text-sm font-semibold mb-3">By Agent</h3>
                {data.byAgent.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No cost events yet.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {data.byAgent.map((row) => (
                      <div
                        key={row.agentId}
                        className="flex items-start justify-between text-sm"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Identity
                            name={row.agentName ?? row.agentId}
                            size="sm"
                          />
                          {row.agentStatus === "terminated" && (
                            <StatusBadge status="terminated" />
                          )}
                        </div>
                        <div className="text-right shrink-0 ml-2">
                          <span className="font-medium block">
                            {formatCents(row.costCents)}
                          </span>
                          <span className="text-xs text-muted-foreground block">
                            in {formatTokens(row.inputTokens)} / out{" "}
                            {formatTokens(row.outputTokens)} tok
                          </span>
                          {(row.apiRunCount > 0 ||
                            row.subscriptionRunCount > 0) && (
                            <span className="text-xs text-muted-foreground block">
                              {/* apiRunCount includes 'api' and 'metered_api' variants */}
                              {row.apiRunCount > 0
                                ? `metered runs: ${row.apiRunCount}`
                                : null}
                              {row.apiRunCount > 0 &&
                              row.subscriptionRunCount > 0
                                ? " | "
                                : null}
                              {/* subscriptionRunCount includes 'subscription', 'subscription_included', 'subscription_overage' */}
                              {row.subscriptionRunCount > 0
                                ? `subscription runs: ${row.subscriptionRunCount} (${formatTokens(row.subscriptionInputTokens)} in / ${formatTokens(row.subscriptionOutputTokens)} out tok)`
                                : null}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {/* Commander */}
                {agentConfig && agentConfig.budgetMonthlyCents != null && (
                  <div className="mt-4 pt-4 border-t border-border">
                    <p className="text-xs font-medium text-muted-foreground mb-2">
                      Commander
                    </p>
                    <div className="flex items-center justify-between text-sm">
                      <span>AI Assistant</span>
                      <span>
                        {formatCents(agentConfig.spentMonthlyCents)} /{" "}
                        {formatCents(agentConfig.budgetMonthlyCents)}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden mt-1">
                      <div
                        className={`h-full rounded-full ${budgetProgressColor(
                          agentConfig.budgetMonthlyCents > 0
                            ? (agentConfig.spentMonthlyCents / agentConfig.budgetMonthlyCents) * 100
                            : 0,
                        )}`}
                        style={{
                          width: `${
                            agentConfig.budgetMonthlyCents > 0
                              ? Math.min(
                                  (agentConfig.spentMonthlyCents / agentConfig.budgetMonthlyCents) * 100,
                                  100,
                                )
                              : 0
                          }%`,
                        }}
                      />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <h3 className="text-sm font-semibold mb-3">By Project</h3>
                {data.byProject.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No project-attributed run costs yet.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {data.byProject.map((row) => (
                      <div
                        key={row.projectId ?? "na"}
                        className="flex items-center justify-between text-sm"
                      >
                        <span className="truncate">
                          {row.projectName ?? row.projectId ?? "Unattributed"}
                        </span>
                        <span className="font-medium">
                          {formatCents(row.costCents)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Open Budget Incidents */}
          {budgetOverview && budgetOverview.openIncidents.length > 0 && (
            <Card>
              <CardContent className="p-4 space-y-3">
                <h3 className="text-sm font-semibold">Open Incidents</h3>
                <div className="space-y-3">
                  {budgetOverview.openIncidents.map((incident) => (
                    <div key={incident.id} className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${incident.thresholdType === "hard_stop" ? "bg-red-500/10 text-red-400" : "bg-yellow-500/10 text-yellow-400"}`}>
                            {incident.thresholdType === "hard_stop" ? "Hard Stop" : "Warning"}
                          </span>
                          <span className="text-sm font-medium">{incident.scopeName ?? incident.scopeId}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          ${(incident.amountObservedCents / 100).toFixed(2)} observed / ${(incident.amountLimitCents / 100).toFixed(2)} limit
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Created {new Date(incident.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {incident.thresholdType === "hard_stop" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={resolveIncident.isPending}
                            onClick={() => {
                              const newAmount = window.prompt("New budget limit in dollars:", String(Math.round(incident.amountLimitCents / 100 * 1.5)));
                              if (!newAmount) return;
                              const parsed = parseFloat(newAmount);
                              if (isNaN(parsed) || parsed <= 0) { window.alert("Please enter a valid dollar amount."); return; }
                              resolveIncident.mutate({
                                incidentId: incident.id,
                                input: { action: "raise_and_resume", newAmountCents: Math.round(parsed * 100) },
                              });
                            }}
                          >
                            Raise &amp; Resume
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={resolveIncident.isPending}
                          onClick={() => resolveIncident.mutate({ incidentId: incident.id, input: { action: "dismiss" } })}
                        >
                          Dismiss
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ─── Activity Section ─────────────────────────────────────────────────
function IntegrationsSection() {
  const { selectedCompanyId } = useCompany();
  const queryClient = useQueryClient();
  const [newKeyName, setNewKeyName] = useState("");
  const [revealedToken, setRevealedToken] = useState<string | null>(null);

  const { data: status } = useQuery({
    queryKey: queryKeys.mcp.status(selectedCompanyId!),
    queryFn: () => mcpApi.status(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: keys } = useQuery({
    queryKey: queryKeys.mcp.keys(selectedCompanyId!),
    queryFn: () => mcpApi.listKeys(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: clients } = useQuery({
    queryKey: queryKeys.mcp.clients(selectedCompanyId!),
    queryFn: () => mcpApi.listClients(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const updateSettingsMutation = useMutation({
    mutationFn: (enabled: boolean) => mcpApi.updateSettings(selectedCompanyId!, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.mcp.status(selectedCompanyId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.detail(selectedCompanyId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
    },
  });

  const createKeyMutation = useMutation({
    mutationFn: (name: string) => mcpApi.createKey(selectedCompanyId!, name),
    onSuccess: (created) => {
      setNewKeyName("");
      setRevealedToken(created.token);
      queryClient.invalidateQueries({ queryKey: queryKeys.mcp.keys(selectedCompanyId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.mcp.status(selectedCompanyId!) });
    },
  });

  const revokeKeyMutation = useMutation({
    mutationFn: (keyId: string) => mcpApi.revokeKey(selectedCompanyId!, keyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.mcp.keys(selectedCompanyId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.mcp.status(selectedCompanyId!) });
    },
  });

  if (!selectedCompanyId) {
    return (
      <EmptyState
        icon={Puzzle}
        message="Select a company to configure integrations."
      />
    );
  }

  const enabled = status?.enabled ?? false;
  const endpointPath = status?.endpointPath ?? `/api/companies/${selectedCompanyId}/mcp`;

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          MCP Server
        </div>
        <div className="rounded-md border border-border px-4 py-4 space-y-4">
          <ToggleField
            label="Enable MCP server"
            hint="Allow external MCP clients to read scoped resources and use approved write tools."
            checked={enabled}
            onChange={(value) => updateSettingsMutation.mutate(value)}
          />
          <div className="grid gap-3 md:grid-cols-3">
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                  Status
                </div>
                <div className="text-sm font-medium">
                  {enabled ? "Enabled" : "Disabled"}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                  API Keys
                </div>
                <div className="text-sm font-medium">{status?.keyCount ?? 0}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                  Connected Clients
                </div>
                <div className="text-sm font-medium">
                  {status?.connectedClients ?? 0}
                </div>
              </CardContent>
            </Card>
          </div>
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Endpoint
            </div>
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm font-mono break-all">
              {window.location.origin}
              {endpointPath}
            </div>
          </div>
          {revealedToken && (
            <div className="space-y-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-3">
              <div className="text-sm font-medium">New API key</div>
              <div className="rounded-md border border-border bg-background px-3 py-2 font-mono text-xs break-all">
                {revealedToken}
              </div>
              <div className="text-xs text-muted-foreground">
                This token is only shown once.
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          API Key Management
        </div>
        <div className="rounded-md border border-border px-4 py-4 space-y-4">
          <div className="flex flex-col gap-3 md:flex-row">
            <input
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="Key name"
            />
            <Button
              size="sm"
              onClick={() => createKeyMutation.mutate(newKeyName.trim())}
              disabled={!newKeyName.trim() || createKeyMutation.isPending}
            >
              {createKeyMutation.isPending ? "Creating..." : "Create key"}
            </Button>
          </div>
          {createKeyMutation.isError && (
            <div className="text-sm text-destructive">
              {createKeyMutation.error instanceof Error
                ? createKeyMutation.error.message
                : "Failed to create key"}
            </div>
          )}
          {(keys ?? []).length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No MCP API keys created yet.
            </div>
          ) : (
            <div className="space-y-2">
              {(keys ?? []).map((key) => (
                <div
                  key={key.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{key.name}</div>
                    <div className="text-xs text-muted-foreground">
                      Created {new Date(key.createdAt).toLocaleString()}
                      {key.lastUsedAt
                        ? ` • Last used ${new Date(key.lastUsedAt).toLocaleString()}`
                        : " • Never used"}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => revokeKeyMutation.mutate(key.id)}
                    disabled={revokeKeyMutation.isPending || !!key.revokedAt}
                  >
                    {key.revokedAt ? "Revoked" : "Revoke"}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Connected MCP Clients
        </div>
        <div className="rounded-md border border-border px-4 py-4 space-y-2">
          {(clients ?? []).length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No MCP clients have connected yet.
            </div>
          ) : (
            (clients ?? []).map((client) => (
              <div
                key={client.id}
                className="rounded-md border border-border px-3 py-3"
              >
                <div className="text-sm font-medium">
                  {client.clientName ?? "Unknown client"}
                  {client.clientVersion ? ` ${client.clientVersion}` : ""}
                </div>
                <div className="text-xs text-muted-foreground">
                  Last seen {new Date(client.lastSeenAt).toLocaleString()}
                  {client.lastMethod ? ` • ${client.lastMethod}` : ""}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          GitHub
        </div>
        <GitHubIntegrationCard />
      </div>
    </div>
  );
}

function ActivitySection() {
  const { selectedCompanyId } = useCompany();
  const [filter, setFilter] = useState("all");

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.activity(selectedCompanyId!),
    queryFn: () => activityApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: issues } = useQuery({
    queryKey: queryKeys.issues.list(selectedCompanyId!),
    queryFn: () => issuesApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: projects } = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: goals } = useQuery({
    queryKey: queryKeys.goals.list(selectedCompanyId!),
    queryFn: () => goalsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const a of agents ?? []) map.set(a.id, a);
    return map;
  }, [agents]);

  const entityNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of issues ?? [])
      map.set(`issue:${i.id}`, i.identifier ?? i.id.slice(0, 8));
    for (const a of agents ?? []) map.set(`agent:${a.id}`, a.name);
    for (const p of projects ?? []) map.set(`project:${p.id}`, p.name);
    for (const g of goals ?? []) map.set(`goal:${g.id}`, g.title);
    return map;
  }, [issues, agents, projects, goals]);

  const entityTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of issues ?? []) map.set(`issue:${i.id}`, i.title);
    return map;
  }, [issues]);

  if (!selectedCompanyId) {
    return (
      <EmptyState
        icon={History}
        message="Select a company to view activity."
      />
    );
  }

  if (isLoading) {
    return <PageSkeleton variant="list" />;
  }

  const filtered =
    data && filter !== "all"
      ? data.filter((e) => e.entityType === filter)
      : data;

  const entityTypes = data
    ? [...new Set(data.map((e) => e.entityType))].sort()
    : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-[140px] h-8 text-xs">
            <SelectValue placeholder="Filter by type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {entityTypes.map((type) => (
              <SelectItem key={type} value={type}>
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {filtered && filtered.length === 0 && (
        <EmptyState icon={History} message="No activity yet." />
      )}

      {filtered && filtered.length > 0 && (
        <div className="border border-border divide-y divide-border">
          {filtered.map((event) => (
            <ActivityRow
              key={event.id}
              event={event}
              agentMap={agentMap}
              entityNameMap={entityNameMap}
              entityTitleMap={entityTitleMap}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Plugins Section ─────────────────────────────────────────────────
function PluginsSection() {
  const { selectedCompanyId } = useCompany();
  const queryClient = useQueryClient();

  const { data: companyPlugins, isLoading } = useQuery({
    queryKey: queryKeys.plugins.companySettings(selectedCompanyId!),
    queryFn: () => pluginsApi.listCompanySettings(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const toggleMutation = useMutation({
    mutationFn: ({ pluginId, enabled }: { pluginId: string; enabled: boolean }) =>
      pluginsApi.updateCompanyPluginSetting(selectedCompanyId!, pluginId, { enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.plugins.companySettings(selectedCompanyId!) });
    },
  });

  if (isLoading) {
    return <div className="text-sm text-muted-foreground py-4">Loading plugins...</div>;
  }

  if (!companyPlugins || companyPlugins.length === 0) {
    return (
      <div className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">Plugins</h2>
          <p className="text-sm text-muted-foreground">
            Manage which plugins are active for this company.
          </p>
        </div>
        <Card>
          <CardContent className="py-8 text-center">
            <Puzzle className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm font-medium">No plugins installed</p>
            <p className="text-xs text-muted-foreground mt-1">
              Plugins are installed at the instance level. Go to Instance Settings to install plugins.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Plugins</h2>
        <p className="text-sm text-muted-foreground">
          Enable or disable plugins for this company. Disabled plugins won't contribute UI, tools, or jobs.
        </p>
      </div>
      <div className="space-y-3">
        {companyPlugins.map((plugin: CompanyPluginSetting) => (
          <Card key={plugin.pluginId} className={plugin.enabled ? "" : "opacity-60"}>
            <CardContent className="py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Puzzle className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm font-semibold truncate">{plugin.displayName}</span>
                    <span className="text-xs text-muted-foreground">v{plugin.version}</span>
                    {plugin.categories.map((cat) => (
                      <span
                        key={cat}
                        className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                      >
                        {cat}
                      </span>
                    ))}
                  </div>
                  {plugin.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2">{plugin.description}</p>
                  )}
                  {plugin.lastError && (
                    <p className="text-xs text-destructive mt-1">{plugin.lastError}</p>
                  )}
                </div>
                <button
                  type="button"
                  aria-label={`${plugin.enabled ? "Disable" : "Enable"} ${plugin.displayName}`}
                  disabled={toggleMutation.isPending}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                    plugin.enabled ? "bg-green-600" : "bg-muted"
                  }`}
                  onClick={() =>
                    toggleMutation.mutate({ pluginId: plugin.pluginId, enabled: !plugin.enabled })
                  }
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                      plugin.enabled ? "translate-x-4.5" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─── Main SettingsPage ────────────────────────────────────────────────
export function SettingsPage() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const { selectedCompany } = useCompany();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") ?? "general";

  const handleTabChange = useCallback(
    (value: string) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", value);
        return next;
      });
    },
    [setSearchParams],
  );

  useEffect(() => {
    setBreadcrumbs([
      { label: selectedCompany?.name ?? "Company", href: "/home" },
      { label: "Settings" },
    ]);
  }, [setBreadcrumbs, selectedCompany?.name]);

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center gap-2">
        <Settings className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Settings</h1>
      </div>

      <Link
        to="commander"
        className="flex items-center justify-between rounded-md border border-border p-3 hover:bg-muted/50 transition-colors"
      >
        <div>
          <p className="text-sm font-medium">Commander</p>
          <p className="text-xs text-muted-foreground">Configure the Commander, capabilities, and budget</p>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </Link>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <PageTabBar
          items={SETTINGS_TABS}
          value={activeTab}
          onValueChange={handleTabChange}
        />

        <TabsContent value="general">
          <GeneralSection />
        </TabsContent>

        <TabsContent value="llm">
          <LLMProvidersSection />
        </TabsContent>

        <TabsContent value="budget">
          <BudgetSection />
        </TabsContent>

        <TabsContent value="activity">
          <ActivitySection />
        </TabsContent>

        <TabsContent value="integrations">
          <IntegrationsSection />
        </TabsContent>

        <TabsContent value="plugins">
          <PluginsSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
