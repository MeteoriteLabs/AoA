import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdapterEnvironmentTestResult } from "@armyofagents/shared";
import { useDialog } from "../context/DialogContext";
import { useCompany } from "../context/CompanyContext";
import { companiesApi } from "../api/companies";
import { goalsApi } from "../api/goals";
import { agentsApi } from "../api/agents";
import { issuesApi } from "../api/issues";
import { queryKeys } from "../lib/queryKeys";
import { Dialog, DialogPortal } from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "../lib/utils";
import { extractModelName, extractProviderIdWithFallback } from "../lib/model-utils";
import { getUIAdapter } from "../adapters";
import { defaultCreateValues } from "./agent-config-defaults";
import {
  DEFAULT_CODEX_LOCAL_BYPASS_APPROVALS_AND_SANDBOX,
  DEFAULT_CODEX_LOCAL_MODEL
} from "@armyofagents/adapter-codex-local";
import { DEFAULT_CURSOR_LOCAL_MODEL } from "@armyofagents/adapter-cursor-local";
import { AsciiArtAnimation } from "./AsciiArtAnimation";
import { ChoosePathButton } from "./PathInstructionsModal";
import { FolderBrowserDialog } from "./FolderBrowserDialog";
import { filesystemApi } from "../api/filesystem";
import { HintIcon } from "./agent-config-primitives";
import { OpenCodeLogoIcon } from "./OpenCodeLogoIcon";
import {
  Building2,
  Bot,
  Code,
  ListTodo,
  Rocket,
  ArrowLeft,
  ArrowRight,
  Terminal,
  Globe,
  Sparkles,
  MousePointer2,
  Check,
  Loader2,
  FolderOpen,
  ChevronDown,
  X,
  FileText,
  ArrowRightLeft,
} from "lucide-react";

/**
 * Phase 1 Phase E batch 2 (T20): wizard step count grew from 6 to 8 — the
 * Commander pick and Crew pick are inserted between root-folder (step 2)
 * and first-agent (was step 3, now step 5). Step numbers below correspond to:
 *   1 = company
 *   2 = root folder
 *   3 = Commander pick (NEW)
 *   4 = Crew pick (NEW)
 *   5 = first agent (was 3)
 *   6 = task (was 4)
 *   7 = discussions intro (was 5)
 *   8 = ready (was 6)
 */
type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
const TOTAL_STEPS = 8;
const STEP_AGENT = 5;
const STEP_TASK = 6;

/**
 * Phase 1 Phase E batch 2 (T20): provider → adapter mapping used to translate
 * the wizard's user-facing "Anthropic / OpenAI / Google / OpenCode" picks
 * into the canonical adapterType strings the server writes to
 * companies.commanderAdapterConfig + companies.crewAdapterConfig.
 */
type Provider = "anthropic" | "openai" | "google" | "opencode";
const PROVIDER_OPTIONS: Provider[] = ["anthropic", "openai", "google", "opencode"];
const PROVIDER_LABELS: Record<Provider, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI (Codex)",
  google: "Google (Gemini)",
  opencode: "OpenCode (multi-provider)",
};
export function providerToAdapter(provider: Provider): string {
  switch (provider) {
    case "anthropic":
      return "claude_local";
    case "openai":
      return "codex_local";
    case "google":
      return "gemini_local";
    case "opencode":
      return "opencode_local";
    default: {
      // Exhaustiveness guard — surfaces a compile error if a Provider is
      // added without a mapping. Throws at runtime as a safety net.
      const _exhaustive: never = provider;
      throw new Error(`Unknown provider: ${_exhaustive as string}`);
    }
  }
}

type AdapterType =
  | "claude_local"
  | "codex_local"
  | "opencode_local"
  | "cursor"
  | "hermes_local"
  | "gemini_local"
  | "process"
  | "http"
  | "openclaw";

const DEFAULT_TASK_DESCRIPTION = `Setup yourself as the Director. Your playbook files (AGENTS.md, HEARTBEAT.md, SOUL.md, TOOLS.md) have already been materialized into your instructions bundle under agents/director. Read all four to understand your role, responsibilities, and the heartbeat checklist.

For broader context on the system, see docs/start/core-concepts.md.

And after you've finished that, hire yourself a Founding Engineer agent`;

export function OnboardingWizard() {
  const { onboardingOpen, onboardingOptions, closeOnboarding } = useDialog();
  const { selectedCompanyId, companies, setSelectedCompanyId } = useCompany();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const initialStep = onboardingOptions.initialStep ?? 1;
  const existingCompanyId = onboardingOptions.companyId;

  const [step, setStep] = useState<Step>(initialStep);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");

  // Step 1
  const [companyName, setCompanyName] = useState("");
  const [companyGoal, setCompanyGoal] = useState("");

  // Step 2 (root folder)
  const [rootFolder, setRootFolder] = useState("");
  const [folderBrowserOpen, setFolderBrowserOpen] = useState(false);
  const [suggestedRootFolder, setSuggestedRootFolder] = useState("");

  // Step 3 (Commander pick — NEW in Phase E batch 2 T20)
  const [commanderProvider, setCommanderProvider] = useState<Provider | "">("");
  const [commanderModel, setCommanderModel] = useState("");

  // Step 4 (Crew pick — NEW in Phase E batch 2 T20)
  const [crewProvider, setCrewProvider] = useState<Provider | "">("");
  const [crewModel, setCrewModel] = useState("");

  // Step 5 (first agent — was step 3)
  const [agentName, setAgentName] = useState("Director");
  const [adapterType, setAdapterType] = useState<AdapterType>("codex_local");
  const [cwd, setCwd] = useState("");
  const [cwdManuallyEdited, setCwdManuallyEdited] = useState(false);
  const [model, setModel] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");
  const [adapterEnvResult, setAdapterEnvResult] =
    useState<AdapterEnvironmentTestResult | null>(null);
  const [adapterEnvError, setAdapterEnvError] = useState<string | null>(null);
  const [adapterEnvLoading, setAdapterEnvLoading] = useState(false);
  const [forceUnsetAnthropicApiKey, setForceUnsetAnthropicApiKey] =
    useState(false);
  const [unsetAnthropicLoading, setUnsetAnthropicLoading] = useState(false);

  // Step 6 (task — was step 4)
  const [taskTitle, setTaskTitle] = useState("Review your Director playbook");
  const [taskDescription, setTaskDescription] = useState(
    DEFAULT_TASK_DESCRIPTION
  );

  // Auto-grow textarea for task description
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const autoResizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, []);

  // Created entity IDs — pre-populate from existing company when skipping step 1
  const [createdCompanyId, setCreatedCompanyId] = useState<string | null>(
    existingCompanyId ?? null
  );
  const [createdCompanyPrefix, setCreatedCompanyPrefix] = useState<
    string | null
  >(null);
  const [createdAgentId, setCreatedAgentId] = useState<string | null>(null);
  const [createdIssueRef, setCreatedIssueRef] = useState<string | null>(null);

  // Sync step and company when onboarding opens with options.
  // Keep this independent from company-list refreshes so Step 1 completion
  // doesn't get reset after creating a company.
  useEffect(() => {
    if (!onboardingOpen) return;
    const cId = onboardingOptions.companyId ?? null;
    setStep(onboardingOptions.initialStep ?? 1);
    setCreatedCompanyId(cId);
    setCreatedCompanyPrefix(null);
  }, [
    onboardingOpen,
    onboardingOptions.companyId,
    onboardingOptions.initialStep
  ]);

  // Backfill issue prefix for an existing company once companies are loaded.
  useEffect(() => {
    if (!onboardingOpen || !createdCompanyId || createdCompanyPrefix) return;
    const company = companies.find((c) => c.id === createdCompanyId);
    if (company) setCreatedCompanyPrefix(company.issuePrefix);
  }, [onboardingOpen, createdCompanyId, createdCompanyPrefix, companies]);

  // Auto-suggest agent cwd from rootFolder when entering agent step (step 5)
  useEffect(() => {
    if (step !== STEP_AGENT || !rootFolder || cwdManuallyEdited || cwd) return;
    const isLocal = ["claude_local", "codex_local", "opencode_local", "cursor", "hermes_local", "gemini_local"].includes(adapterType);
    if (!isLocal) return;
    const sep = rootFolder.includes("\\") ? "\\" : "/";
    const slug = agentName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "cxo";
    setCwd(`${rootFolder}${sep}agents${sep}${slug}`);
  }, [step, rootFolder, agentName, adapterType, cwdManuallyEdited, cwd]);

  // Resize textarea when step 6 (task) is shown or description changes
  useEffect(() => {
    if (step === STEP_TASK) autoResizeTextarea();
  }, [step, taskDescription, autoResizeTextarea]);

  const {
    data: adapterModels,
    error: adapterModelsError,
    isLoading: adapterModelsLoading,
    isFetching: adapterModelsFetching,
  } = useQuery({
    queryKey:
      createdCompanyId
        ? queryKeys.agents.adapterModels(createdCompanyId, adapterType)
        : ["agents", "none", "adapter-models", adapterType],
    queryFn: () => agentsApi.adapterModels(createdCompanyId!, adapterType),
    enabled: Boolean(createdCompanyId) && onboardingOpen && step === STEP_AGENT
  });
  const isLocalAdapter =
    adapterType === "claude_local" || adapterType === "codex_local" || adapterType === "opencode_local" || adapterType === "cursor";
  const effectiveAdapterCommand =
    command.trim() ||
    (adapterType === "codex_local"
      ? "codex"
      : adapterType === "cursor"
        ? "agent"
        : adapterType === "opencode_local"
          ? "opencode"
          : "claude");

  useEffect(() => {
    if (step !== STEP_AGENT) return;
    setAdapterEnvResult(null);
    setAdapterEnvError(null);
  }, [step, adapterType, cwd, model, command, args, url]);

  const selectedModel = (adapterModels ?? []).find((m) => m.id === model);
  const hasAnthropicApiKeyOverrideCheck =
    adapterEnvResult?.checks.some(
      (check) =>
        check.code === "claude_anthropic_api_key_overrides_subscription"
    ) ?? false;
  const shouldSuggestUnsetAnthropicApiKey =
    adapterType === "claude_local" &&
    adapterEnvResult?.status === "fail" &&
    hasAnthropicApiKeyOverrideCheck;
  const filteredModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    return (adapterModels ?? []).filter((entry) => {
      if (!query) return true;
      const provider = extractProviderIdWithFallback(entry.id, "");
      return (
        entry.id.toLowerCase().includes(query) ||
        entry.label.toLowerCase().includes(query) ||
        provider.toLowerCase().includes(query)
      );
    });
  }, [adapterModels, modelSearch]);
  const groupedModels = useMemo(() => {
    if (adapterType !== "opencode_local") {
      return [
        {
          provider: "models",
          entries: [...filteredModels].sort((a, b) => a.id.localeCompare(b.id)),
        },
      ];
    }
    const groups = new Map<string, Array<{ id: string; label: string }>>();
    for (const entry of filteredModels) {
      const provider = extractProviderIdWithFallback(entry.id);
      const bucket = groups.get(provider) ?? [];
      bucket.push(entry);
      groups.set(provider, bucket);
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([provider, entries]) => ({
        provider,
        entries: [...entries].sort((a, b) => a.id.localeCompare(b.id)),
      }));
  }, [filteredModels, adapterType]);

  function reset() {
    setStep(1);
    setLoading(false);
    setError(null);
    setCompanyName("");
    setCompanyGoal("");
    setCommanderProvider("");
    setCommanderModel("");
    setCrewProvider("");
    setCrewModel("");
    setAgentName("Director");
    setAdapterType("claude_local");
    setCwd("");
    setCwdManuallyEdited(false);
    setModel("");
    setCommand("");
    setArgs("");
    setUrl("");
    setAdapterEnvResult(null);
    setAdapterEnvError(null);
    setAdapterEnvLoading(false);
    setForceUnsetAnthropicApiKey(false);
    setUnsetAnthropicLoading(false);
    setTaskTitle("Review your Director playbook");
    setTaskDescription(DEFAULT_TASK_DESCRIPTION);
    setRootFolder("");
    setFolderBrowserOpen(false);
    setSuggestedRootFolder("");
    setCreatedCompanyId(null);
    setCreatedCompanyPrefix(null);
    setCreatedAgentId(null);
    setCreatedIssueRef(null);
  }

  function handleClose() {
    reset();
    closeOnboarding();
  }

  function buildAdapterConfig(): Record<string, unknown> {
    const adapter = getUIAdapter(adapterType);
    const config = adapter.buildAdapterConfig({
      ...defaultCreateValues,
      adapterType,
      cwd,
      model:
        adapterType === "codex_local"
          ? model || DEFAULT_CODEX_LOCAL_MODEL
          : adapterType === "cursor"
            ? model || DEFAULT_CURSOR_LOCAL_MODEL
          : model,
      command,
      args,
      url,
      dangerouslySkipPermissions: adapterType === "claude_local",
      dangerouslyBypassSandbox:
        adapterType === "codex_local"
          ? DEFAULT_CODEX_LOCAL_BYPASS_APPROVALS_AND_SANDBOX
          : defaultCreateValues.dangerouslyBypassSandbox
    });
    if (adapterType === "claude_local" && forceUnsetAnthropicApiKey) {
      const env =
        typeof config.env === "object" &&
        config.env !== null &&
        !Array.isArray(config.env)
          ? { ...(config.env as Record<string, unknown>) }
          : {};
      env.ANTHROPIC_API_KEY = { type: "plain", value: "" };
      config.env = env;
    }
    return config;
  }

  async function runAdapterEnvironmentTest(
    adapterConfigOverride?: Record<string, unknown>
  ): Promise<AdapterEnvironmentTestResult | null> {
    if (!createdCompanyId) {
      setAdapterEnvError(
        "Create or select a company before testing adapter environment."
      );
      return null;
    }
    setAdapterEnvLoading(true);
    setAdapterEnvError(null);
    try {
      const result = await agentsApi.testEnvironment(
        createdCompanyId,
        adapterType,
        {
          adapterConfig: adapterConfigOverride ?? buildAdapterConfig()
        }
      );
      setAdapterEnvResult(result);
      return result;
    } catch (err) {
      setAdapterEnvError(
        err instanceof Error ? err.message : "Adapter environment test failed"
      );
      return null;
    } finally {
      setAdapterEnvLoading(false);
    }
  }

  async function handleStep1Next() {
    // Phase E batch 2 (T20): company creation deferred until Step 4 (Crew)
    // so that the POST can include both commanderAdapterConfig and
    // crewAdapterConfig in the same request. Step 1 just suggests a root
    // folder and advances locally — no server round-trips.
    setError(null);
    try {
      const { homePath } = await filesystemApi.home();
      const slug = companyName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const sep = homePath.includes("\\") ? "\\" : "/";
      const suggested = `${homePath}${sep}AoA${sep}${slug}`;
      setSuggestedRootFolder(suggested);
      setRootFolder(suggested);
    } catch {
      // Fallback if filesystem API fails — user can type a path manually.
      setSuggestedRootFolder("");
    }
    setStep(2);
  }

  async function handleStep2Next() {
    // Phase E batch 2 (T20): no server-side write yet. Root folder is held
    // locally and saved alongside company create + commander/crew configs in
    // the Step 4 Next handler. Advance directly to the Commander pick.
    if (!rootFolder.trim()) return;
    setError(null);
    setStep(3);
  }

  function handleStep3Next() {
    // Phase E batch 2 (T20): Commander pick. No server-side write — just
    // advance to the Crew pick step. Disabled-until-valid in the footer.
    if (!commanderProvider || !commanderModel) return;
    setError(null);
    setStep(4);
  }

  async function handleStep4Next() {
    // Phase E batch 2 (T20): Crew pick + final company creation. This is the
    // single POST /companies that carries name + description + commander +
    // crew configs. We then PATCH rootFolder and (optionally) create the
    // company goal, mirroring the legacy Step 1/2 behavior in one flush.
    if (!crewProvider || !crewModel) return;
    setLoading(true);
    setError(null);
    try {
      const company = await companiesApi.create({
        name: companyName.trim(),
        commanderAdapterConfig: {
          adapter: providerToAdapter(commanderProvider as Provider),
          model: commanderModel.trim(),
        },
        crewAdapterConfig: {
          default: {
            adapter: providerToAdapter(crewProvider as Provider),
            model: crewModel.trim(),
          },
        },
      });
      setCreatedCompanyId(company.id);
      setCreatedCompanyPrefix(company.issuePrefix);
      setSelectedCompanyId(company.id);
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });

      if (companyGoal.trim()) {
        await goalsApi.create(company.id, {
          title: companyGoal.trim(),
          level: "company",
          status: "active",
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.goals.list(company.id),
        });
      }

      // Materialize the root folder and persist it on the company row.
      try {
        await filesystemApi.mkdir(rootFolder.trim());
      } catch {
        // Non-fatal — server will retry on agent create.
      }
      await companiesApi.update(company.id, { rootFolder: rootFolder.trim() });
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });

      setStep(STEP_AGENT);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create company");
    } finally {
      setLoading(false);
    }
  }

  async function handleStep5Next() {
    if (!createdCompanyId) return;
    setLoading(true);
    setError(null);
    try {
      if (adapterType === "opencode_local") {
        const selectedModelId = model.trim();
        if (!selectedModelId) {
          setError("OpenCode requires an explicit model in provider/model format.");
          return;
        }
        if (adapterModelsError) {
          setError(
            adapterModelsError instanceof Error
              ? adapterModelsError.message
              : "Failed to load OpenCode models.",
          );
          return;
        }
        if (adapterModelsLoading || adapterModelsFetching) {
          setError("OpenCode models are still loading. Please wait and try again.");
          return;
        }
        const discoveredModels = adapterModels ?? [];
        if (!discoveredModels.some((entry) => entry.id === selectedModelId)) {
          setError(
            discoveredModels.length === 0
              ? "No OpenCode models discovered. Run `opencode models` and authenticate providers."
              : `Configured OpenCode model is unavailable: ${selectedModelId}`,
          );
          return;
        }
      }

      if (isLocalAdapter) {
        const result = adapterEnvResult ?? (await runAdapterEnvironmentTest());
        if (!result) return;
      }

      // Default agent cwd to company root folder if not manually set
      const agentCwd = cwd.trim() || (rootFolder ? `${rootFolder}${rootFolder.includes("\\") ? "\\" : "/"}agents${rootFolder.includes("\\") ? "\\" : "/"}${agentName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : "");

      const agent = await agentsApi.create(createdCompanyId, {
        name: agentName.trim(),
        // First-onboarded agent in a brand-new company is the apex CXO
        // (Chief of Staff). Was `"ceo"` before the role-enum cleanup.
        role: "cxo",
        adapterType,
        adapterConfig: { ...buildAdapterConfig(), ...(agentCwd ? { cwd: agentCwd } : {}) },
        runtimeConfig: {
          heartbeat: {
            enabled: true,
            intervalSec: 3600,
            wakeOnDemand: true,
            cooldownSec: 10,
            maxConcurrentRuns: 1
          }
        }
      });
      setCreatedAgentId(agent.id);
      queryClient.invalidateQueries({
        queryKey: queryKeys.agents.list(createdCompanyId)
      });

      // Auto-create agent workspace dir
      if (agentCwd) {
        filesystemApi.mkdir(agentCwd).catch(() => {});
      }

      setStep(STEP_TASK);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create agent");
    } finally {
      setLoading(false);
    }
  }

  async function handleUnsetAnthropicApiKey() {
    if (!createdCompanyId || unsetAnthropicLoading) return;
    setUnsetAnthropicLoading(true);
    setError(null);
    setAdapterEnvError(null);
    setForceUnsetAnthropicApiKey(true);

    const configWithUnset = (() => {
      const config = buildAdapterConfig();
      const env =
        typeof config.env === "object" &&
        config.env !== null &&
        !Array.isArray(config.env)
          ? { ...(config.env as Record<string, unknown>) }
          : {};
      env.ANTHROPIC_API_KEY = { type: "plain", value: "" };
      config.env = env;
      return config;
    })();

    try {
      if (createdAgentId) {
        await agentsApi.update(
          createdAgentId,
          { adapterConfig: configWithUnset },
          createdCompanyId
        );
        queryClient.invalidateQueries({
          queryKey: queryKeys.agents.list(createdCompanyId)
        });
      }

      const result = await runAdapterEnvironmentTest(configWithUnset);
      if (result?.status === "fail") {
        setError(
          "Retried with ANTHROPIC_API_KEY unset in adapter config, but the environment test is still failing."
        );
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to unset ANTHROPIC_API_KEY and retry."
      );
    } finally {
      setUnsetAnthropicLoading(false);
    }
  }

  async function handleStep6Next() {
    if (!createdCompanyId || !createdAgentId) return;
    setLoading(true);
    setError(null);
    try {
      const issue = await issuesApi.create(createdCompanyId, {
        title: taskTitle.trim(),
        ...(taskDescription.trim()
          ? { description: taskDescription.trim() }
          : {}),
        assigneeAgentId: createdAgentId,
        status: "todo"
      });
      setCreatedIssueRef(issue.identifier ?? issue.id);
      queryClient.invalidateQueries({
        queryKey: queryKeys.issues.list(createdCompanyId)
      });
      setStep(7);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task");
    } finally {
      setLoading(false);
    }
  }

  async function handleLaunch() {
    if (!createdAgentId) return;
    setLoading(true);
    setError(null);
    setLoading(false);
    reset();
    closeOnboarding();
    if (createdCompanyPrefix && createdIssueRef) {
      navigate(`/${createdCompanyPrefix}/issues/${createdIssueRef}`);
      return;
    }
    if (createdCompanyPrefix) {
      navigate(`/${createdCompanyPrefix}/home`);
      return;
    }
    navigate("/home");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (step === 1 && companyName.trim()) handleStep1Next();
      else if (step === 2 && rootFolder.trim()) handleStep2Next();
      else if (step === 3 && commanderProvider && commanderModel)
        handleStep3Next();
      else if (step === 4 && crewProvider && crewModel) handleStep4Next();
      else if (step === STEP_AGENT && agentName.trim()) handleStep5Next();
      else if (step === STEP_TASK && taskTitle.trim()) handleStep6Next();
      else if (step === 7) setStep(8);
      else if (step === 8) handleLaunch();
    }
  }

  if (!onboardingOpen) return null;

  return (
    <Dialog
      open={onboardingOpen}
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
    >
      <DialogPortal>
        {/* Plain div instead of DialogOverlay — Radix's overlay wraps in
            RemoveScroll which blocks wheel events on our custom (non-DialogContent)
            scroll container. A plain div preserves the background without scroll-locking. */}
        <div className="fixed inset-0 z-50 bg-background" />
        <div className="fixed inset-0 z-50 flex" onKeyDown={handleKeyDown}>
          {/* Close button */}
          <button
            onClick={handleClose}
            className="absolute top-4 left-4 z-10 rounded-sm p-1.5 text-muted-foreground/60 hover:text-foreground transition-colors"
          >
            <X className="h-5 w-5" />
            <span className="sr-only">Close</span>
          </button>

          {/* Left half — form */}
          <div className="w-full md:w-1/2 flex flex-col overflow-y-auto">
            <div className="w-full max-w-md mx-auto my-auto px-8 py-12 shrink-0">
              {/* Progress indicators */}
              <div className="flex items-center gap-2 mb-8">
                <Sparkles className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Get Started</span>
                <span className="text-sm text-muted-foreground/60">
                  Step {step} of {TOTAL_STEPS}
                </span>
                <div className="flex items-center gap-1.5 ml-auto">
                  {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((s) => (
                    <div
                      key={s}
                      className={cn(
                        "h-1.5 w-4 rounded-full transition-colors",
                        s < step
                          ? "bg-green-500"
                          : s === step
                            ? "bg-foreground"
                            : "bg-muted"
                      )}
                    />
                  ))}
                </div>
              </div>

              {/* Step content */}
              {step === 1 && (
                <div className="space-y-5">
                  <div className="flex items-center gap-3 mb-1">
                    <div className="bg-muted/50 p-2">
                      <Building2 className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <h3 className="font-medium">Name your company</h3>
                      <p className="text-xs text-muted-foreground">
                        This is the organization your agents will work for.
                      </p>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">
                      Company name
                    </label>
                    <input
                      className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                      placeholder="Acme Corp"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">
                      Mission / goal (optional)
                    </label>
                    <textarea
                      className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50 resize-none min-h-[60px]"
                      placeholder="What is this company trying to achieve?"
                      value={companyGoal}
                      onChange={(e) => setCompanyGoal(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-5">
                  <div className="flex items-center gap-3 mb-1">
                    <div className="bg-muted/50 p-2">
                      <FolderOpen className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <h3 className="font-medium">Set up workspace root</h3>
                      <p className="text-xs text-muted-foreground">
                        This is where AoA stores department workspaces and agent files.
                      </p>
                    </div>
                  </div>
                  {suggestedRootFolder && (
                    <div className="rounded-md border border-border p-3 space-y-2">
                      <p className="text-xs text-muted-foreground">Suggested location:</p>
                      <p className="font-mono text-xs bg-muted/50 px-2 py-1.5 rounded truncate">
                        {suggestedRootFolder}
                      </p>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant={rootFolder === suggestedRootFolder ? "default" : "secondary"}
                          onClick={() => setRootFolder(suggestedRootFolder)}
                          className="text-xs"
                        >
                          <Check className="h-3 w-3 mr-1" />
                          Use this
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setFolderBrowserOpen(true)}
                          className="text-xs"
                        >
                          <FolderOpen className="h-3 w-3 mr-1" />
                          Browse...
                        </Button>
                      </div>
                    </div>
                  )}
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">
                      Root folder path
                    </label>
                    <div className="flex gap-1.5">
                      <input
                        className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm font-mono outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                        placeholder="/path/to/company/workspace"
                        value={rootFolder}
                        onChange={(e) => setRootFolder(e.target.value)}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setFolderBrowserOpen(true)}
                      >
                        Browse
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1.5">
                      The folder will be created automatically if it doesn't exist.
                    </p>
                  </div>
                  <FolderBrowserDialog
                    open={folderBrowserOpen}
                    onClose={() => setFolderBrowserOpen(false)}
                    onSelect={(path) => setRootFolder(path)}
                    title="Select Workspace Root"
                    description="Choose where AoA should store company files"
                    initialPath={rootFolder || suggestedRootFolder || undefined}
                  />
                </div>
              )}

              {/* Phase E batch 2 (T20): Step 3 — Commander pick.
                  Drives companies.commanderAdapterConfig at create time.
                  Free-form model text input — the agent-step model dropdown
                  (which needs a live `adapterModels` query) cannot run here
                  because the company doesn't exist yet. */}
              {step === 3 && (
                <div className="space-y-5">
                  <div className="flex items-center gap-3 mb-1">
                    <div className="bg-muted/50 p-2">
                      <Sparkles className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <h3 className="font-medium">Choose your Commander</h3>
                      <p className="text-xs text-muted-foreground">
                        Commander is your personal AI assistant. Used for chat
                        and orchestration.
                      </p>
                    </div>
                  </div>
                  <div>
                    <label
                      className="text-xs text-muted-foreground mb-1 block"
                      htmlFor="commander-provider"
                    >
                      Provider
                    </label>
                    <select
                      id="commander-provider"
                      data-testid="commander-provider"
                      className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                      value={commanderProvider}
                      onChange={(e) =>
                        setCommanderProvider(e.target.value as Provider | "")
                      }
                    >
                      <option value="">Select a provider…</option>
                      {PROVIDER_OPTIONS.map((p) => (
                        <option key={p} value={p}>
                          {PROVIDER_LABELS[p]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label
                      className="text-xs text-muted-foreground mb-1 block"
                      htmlFor="commander-model"
                    >
                      Model
                    </label>
                    <input
                      id="commander-model"
                      data-testid="commander-model"
                      className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                      placeholder="e.g. claude-sonnet-4-6"
                      value={commanderModel}
                      onChange={(e) => setCommanderModel(e.target.value)}
                    />
                    <p className="text-[11px] text-muted-foreground mt-1.5">
                      You can change the model later in Settings → Commander.
                    </p>
                  </div>
                </div>
              )}

              {/* Phase E batch 2 (T20): Step 4 — Crew pick.
                  Drives companies.crewAdapterConfig.default at create time.
                  Applies to all 7 crew agents; per-agent overrides live in
                  Settings → Agents after onboarding. */}
              {step === 4 && (
                <div className="space-y-5">
                  <div className="flex items-center gap-3 mb-1">
                    <div className="bg-muted/50 p-2">
                      <Bot className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <h3 className="font-medium">Choose your Crew</h3>
                      <p className="text-xs text-muted-foreground">
                        This adapter+model applies to all 7 crew agents
                        (Adjutant, Scout, Engineer, Navigator, Planner,
                        Dispatcher, Memory Keeper). You can override per-agent
                        in Settings → Agents later.
                      </p>
                    </div>
                  </div>
                  <div>
                    <label
                      className="text-xs text-muted-foreground mb-1 block"
                      htmlFor="crew-provider"
                    >
                      Provider
                    </label>
                    <select
                      id="crew-provider"
                      data-testid="crew-provider"
                      className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                      value={crewProvider}
                      onChange={(e) =>
                        setCrewProvider(e.target.value as Provider | "")
                      }
                    >
                      <option value="">Select a provider…</option>
                      {PROVIDER_OPTIONS.map((p) => (
                        <option key={p} value={p}>
                          {PROVIDER_LABELS[p]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label
                      className="text-xs text-muted-foreground mb-1 block"
                      htmlFor="crew-model"
                    >
                      Model
                    </label>
                    <input
                      id="crew-model"
                      data-testid="crew-model"
                      className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                      placeholder="e.g. gpt-5.3-codex"
                      value={crewModel}
                      onChange={(e) => setCrewModel(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {step === STEP_AGENT && (
                <div className="space-y-5">
                  <div className="flex items-center gap-3 mb-1">
                    <div className="bg-muted/50 p-2">
                      <Bot className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <h3 className="font-medium">Create your first agent</h3>
                      <p className="text-xs text-muted-foreground">
                        Choose how this agent will run tasks.
                      </p>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">
                      Agent name
                    </label>
                    <input
                      className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                      placeholder="Director"
                      value={agentName}
                      onChange={(e) => setAgentName(e.target.value)}
                      autoFocus
                    />
                  </div>

                  {/* Adapter type radio cards */}
                  <div>
                    <label className="text-xs text-muted-foreground mb-2 block">
                      Adapter type
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        {
                          value: "claude_local" as const,
                          label: "Claude Code",
                          icon: Sparkles,
                          desc: "Local Claude agent",
                          recommended: true
                        },
                        {
                          value: "codex_local" as const,
                          label: "Codex",
                          icon: Code,
                          desc: "Local Codex agent",
                          recommended: true
                        },
                        {
                          value: "opencode_local" as const,
                          label: "OpenCode",
                          icon: OpenCodeLogoIcon,
                          desc: "Local multi-provider agent"
                        },
                        {
                          value: "openclaw" as const,
                          label: "OpenClaw",
                          icon: Bot,
                          desc: "Notify OpenClaw webhook",
                          comingSoon: true
                        },
                        {
                          value: "cursor" as const,
                          label: "Cursor",
                          icon: MousePointer2,
                          desc: "Local Cursor agent"
                        },
                        {
                          value: "process" as const,
                          label: "Shell Command",
                          icon: Terminal,
                          desc: "Run a process",
                          comingSoon: true
                        },
                        {
                          value: "http" as const,
                          label: "HTTP Webhook",
                          icon: Globe,
                          desc: "Call an endpoint",
                          comingSoon: true
                        }
                      ].map((opt) => (
                        <button
                          key={opt.value}
                          disabled={!!opt.comingSoon}
                          className={cn(
                            "flex flex-col items-center gap-1.5 rounded-md border p-3 text-xs transition-colors relative",
                            opt.comingSoon
                              ? "border-border opacity-40 cursor-not-allowed"
                              : adapterType === opt.value
                                ? "border-foreground bg-accent"
                                : "border-border hover:bg-accent/50"
                          )}
                          onClick={() => {
                            if (opt.comingSoon) return;
                            const nextType = opt.value as AdapterType;
                            setAdapterType(nextType);
                            if (nextType === "codex_local" && !model) {
                              setModel(DEFAULT_CODEX_LOCAL_MODEL);
                            } else if (nextType === "cursor" && !model) {
                              setModel(DEFAULT_CURSOR_LOCAL_MODEL);
                            }
                            if (nextType === "opencode_local") {
                              if (!model.includes("/")) {
                                setModel("");
                              }
                              return;
                            }
                            setModel("");
                          }}
                        >
                          {opt.recommended && (
                            <span className="absolute -top-1.5 -right-1.5 bg-green-500 text-white text-[9px] font-semibold px-1.5 py-0.5 rounded-full leading-none">
                              Recommended
                            </span>
                          )}
                          <opt.icon className="h-4 w-4" />
                          <span className="font-medium">{opt.label}</span>
                          <span className="text-muted-foreground text-[10px]">
                            {opt.comingSoon ? "Coming soon" : opt.desc}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Conditional adapter fields */}
                  {(adapterType === "claude_local" ||
                    adapterType === "codex_local" ||
                    adapterType === "opencode_local" ||
                    adapterType === "cursor") && (
                    <div className="space-y-3">
                      <div>
                        <div className="flex items-center gap-1.5 mb-1">
                          <label className="text-xs text-muted-foreground">
                            Working directory
                          </label>
                          <HintIcon text="AoA works best if you create a new folder for your agents to keep their memories and stay organized. Create a new folder and put the path here." />
                        </div>
                        <div className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5">
                          <FolderOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <input
                            className="w-full bg-transparent outline-none text-sm font-mono placeholder:text-muted-foreground/50"
                            placeholder="/path/to/project"
                            value={cwd}
                            onChange={(e) => { setCwd(e.target.value); setCwdManuallyEdited(true); }}
                          />
                          <ChoosePathButton />
                        </div>
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">
                          Model
                        </label>
                        <Popover
                          open={modelOpen}
                          onOpenChange={(next) => {
                            setModelOpen(next);
                            if (!next) setModelSearch("");
                          }}
                        >
                          <PopoverTrigger asChild>
                            <button className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm hover:bg-accent/50 transition-colors w-full justify-between">
                              <span
                                className={cn(
                                  !model && "text-muted-foreground"
                                )}
                              >
                                {selectedModel
                                  ? selectedModel.label
                                  : model ||
                                    (adapterType === "opencode_local"
                                      ? "Select model (required)"
                                      : "Default")}
                              </span>
                              <ChevronDown className="h-3 w-3 text-muted-foreground" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent
                            className="w-[var(--radix-popover-trigger-width)] p-1"
                            align="start"
                          >
                            <input
                              className="w-full px-2 py-1.5 text-xs bg-transparent outline-none border-b border-border mb-1 placeholder:text-muted-foreground/50"
                              placeholder="Search models..."
                              value={modelSearch}
                              onChange={(e) => setModelSearch(e.target.value)}
                              autoFocus
                            />
                            {adapterType !== "opencode_local" && (
                              <button
                                className={cn(
                                  "flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-accent/50",
                                  !model && "bg-accent"
                                )}
                                onClick={() => {
                                  setModel("");
                                  setModelOpen(false);
                                }}
                              >
                                  Default
                                </button>
                            )}
                            <div className="max-h-[240px] overflow-y-auto">
                              {groupedModels.map((group) => (
                                <div key={group.provider} className="mb-1 last:mb-0">
                                  {adapterType === "opencode_local" && (
                                    <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                                      {group.provider} ({group.entries.length})
                                    </div>
                                  )}
                                  {group.entries.map((m) => (
                                    <button
                                      key={m.id}
                                      className={cn(
                                        "flex items-center w-full px-2 py-1.5 text-sm rounded hover:bg-accent/50",
                                        m.id === model && "bg-accent"
                                      )}
                                      onClick={() => {
                                        setModel(m.id);
                                        setModelOpen(false);
                                      }}
                                    >
                                      <span className="block w-full text-left truncate" title={m.id}>
                                        {adapterType === "opencode_local" ? extractModelName(m.id) : m.label}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              ))}
                            </div>
                            {filteredModels.length === 0 && (
                              <p className="px-2 py-1.5 text-xs text-muted-foreground">
                                No models discovered.
                              </p>
                            )}
                          </PopoverContent>
                        </Popover>
                      </div>
                    </div>
                  )}

                  {isLocalAdapter && (
                    <div className="space-y-2 rounded-md border border-border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-medium">
                            Adapter environment check
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            Runs a live probe that asks the adapter CLI to
                            respond with hello.
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2.5 text-xs"
                          disabled={adapterEnvLoading}
                          onClick={() => void runAdapterEnvironmentTest()}
                        >
                          {adapterEnvLoading ? "Testing..." : "Test now"}
                        </Button>
                      </div>

                      {adapterEnvError && (
                        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-[11px] text-destructive">
                          {adapterEnvError}
                        </div>
                      )}

                      {adapterEnvResult && (
                        <AdapterEnvironmentResult result={adapterEnvResult} />
                      )}

                      {shouldSuggestUnsetAnthropicApiKey && (
                        <div className="rounded-md border border-amber-300/60 bg-amber-50/40 px-2.5 py-2 space-y-2">
                          <p className="text-[11px] text-amber-900/90 leading-relaxed">
                            Claude failed while <span className="font-mono">ANTHROPIC_API_KEY</span> is set.
                            You can clear it in this Director adapter config and retry the probe.
                          </p>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2.5 text-xs"
                            disabled={adapterEnvLoading || unsetAnthropicLoading}
                            onClick={() => void handleUnsetAnthropicApiKey()}
                          >
                            {unsetAnthropicLoading ? "Retrying..." : "Unset ANTHROPIC_API_KEY"}
                          </Button>
                        </div>
                      )}

                      <div className="rounded-md border border-border/70 bg-muted/20 px-2.5 py-2 text-[11px] space-y-1.5">
                        <p className="font-medium">Manual debug</p>
                        <p className="text-muted-foreground font-mono break-all">
                          {adapterType === "cursor"
                            ? `${effectiveAdapterCommand} -p --mode ask --output-format json \"Respond with hello.\"`
                            : adapterType === "codex_local"
                            ? `${effectiveAdapterCommand} exec --json -`
                            : adapterType === "opencode_local"
                              ? `${effectiveAdapterCommand} run --format json "Respond with hello."`
                            : `${effectiveAdapterCommand} --print - --output-format stream-json --verbose`}
                        </p>
                        <p className="text-muted-foreground">
                          Prompt:{" "}
                          <span className="font-mono">Respond with hello.</span>
                        </p>
                        {adapterType === "cursor" || adapterType === "codex_local" || adapterType === "opencode_local" ? (
                          <p className="text-muted-foreground">
                            If auth fails, set{" "}
                            <span className="font-mono">
                              {adapterType === "cursor" ? "CURSOR_API_KEY" : "OPENAI_API_KEY"}
                            </span>{" "}
                            in
                            env or run{" "}
                            <span className="font-mono">
                              {adapterType === "cursor"
                                ? "agent login"
                                : adapterType === "codex_local"
                                  ? "codex login"
                                  : "opencode auth login"}
                            </span>.
                          </p>
                        ) : (
                          <p className="text-muted-foreground">
                            If login is required, run{" "}
                            <span className="font-mono">claude login</span> and
                            retry.
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {adapterType === "process" && (
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">
                          Command
                        </label>
                        <input
                          className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm font-mono outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                          placeholder="e.g. node, python"
                          value={command}
                          onChange={(e) => setCommand(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">
                          Args (comma-separated)
                        </label>
                        <input
                          className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm font-mono outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                          placeholder="e.g. script.js, --flag"
                          value={args}
                          onChange={(e) => setArgs(e.target.value)}
                        />
                      </div>
                    </div>
                  )}

                  {(adapterType === "http" || adapterType === "openclaw") && (
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">
                        Webhook URL
                      </label>
                      <input
                        className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm font-mono outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                        placeholder="https://..."
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                      />
                    </div>
                  )}
                </div>
              )}

              {step === STEP_TASK && (
                <div className="space-y-5">
                  <div className="flex items-center gap-3 mb-1">
                    <div className="bg-muted/50 p-2">
                      <ListTodo className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <h3 className="font-medium">Give it something to do</h3>
                      <p className="text-xs text-muted-foreground">
                        Give your agent a small task to start with — a bug fix,
                        a research question, writing a script.
                      </p>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">
                      Task title
                    </label>
                    <input
                      className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                      placeholder="e.g. Research competitor pricing"
                      value={taskTitle}
                      onChange={(e) => setTaskTitle(e.target.value)}
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">
                      Description (optional)
                    </label>
                    <textarea
                      ref={textareaRef}
                      className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50 resize-none min-h-[120px] max-h-[300px] overflow-y-auto"
                      placeholder="Add more detail about what the agent should do..."
                      value={taskDescription}
                      onChange={(e) => setTaskDescription(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {step === 7 && (
                <div className="space-y-5">
                  <div className="flex items-center gap-3 mb-1">
                    <div className="bg-muted/50 p-2">
                      <FileText className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <h3 className="font-medium">Discussions</h3>
                      <p className="text-xs text-muted-foreground">
                        The primary way to feed work into your agents.
                      </p>
                    </div>
                  </div>

                  <div className="bg-muted/30 rounded-md border border-border px-4 py-3 space-y-3 text-sm">
                    <div>
                      <p className="font-medium mb-1">What's a Discussion?</p>
                      <p className="text-muted-foreground text-xs leading-relaxed">
                        Paste meeting notes, research findings, or ideas. The AI
                        extracts decisions, tasks, and insights — creating a
                        Discussion you review and refine before your agents start
                        work.
                      </p>
                    </div>
                    <div>
                      <p className="font-medium mb-1">How it flows</p>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono flex-wrap">
                        <span className="rounded bg-muted px-1.5 py-0.5">Paste / Write</span>
                        <ArrowRightLeft className="h-3 w-3 shrink-0" />
                        <span className="rounded bg-muted px-1.5 py-0.5">AI Extract</span>
                        <ArrowRightLeft className="h-3 w-3 shrink-0" />
                        <span className="rounded bg-muted px-1.5 py-0.5">Discussion</span>
                        <ArrowRightLeft className="h-3 w-3 shrink-0" />
                        <span className="rounded bg-muted px-1.5 py-0.5">Approve</span>
                        <ArrowRightLeft className="h-3 w-3 shrink-0" />
                        <span className="rounded bg-blue-100 dark:bg-blue-900/30 px-1.5 py-0.5 text-blue-700 dark:text-blue-300">Tasks + Memory</span>
                      </div>
                    </div>
                    <div>
                      <p className="font-medium mb-1">Why this matters</p>
                      <p className="text-muted-foreground text-xs leading-relaxed">
                        Direct task creation works for quick one-offs (you just
                        did one!). But Discussions let you dump raw information and
                        let the AI structure it — extracting multiple tasks,
                        decisions, and context in one go.
                      </p>
                    </div>
                  </div>

                  <div className="rounded-md border border-border/60 bg-muted/10 px-3 py-2">
                    <p className="text-xs text-muted-foreground">
                      You can create your first Discussion anytime from the{" "}
                      <span className="font-medium text-foreground">+ Discussion</span>{" "}
                      button in the sidebar. For now, let's finish setup.
                    </p>
                  </div>
                </div>
              )}

              {step === 8 && (
                <div className="space-y-5">
                  <div className="flex items-center gap-3 mb-1">
                    <div className="bg-muted/50 p-2">
                      <Rocket className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <h3 className="font-medium">Ready to launch</h3>
                      <p className="text-xs text-muted-foreground">
                        Everything is set up. Your assigned task already woke
                        the agent, so you can jump straight to the issue.
                      </p>
                    </div>
                  </div>
                  <div className="border border-border divide-y divide-border">
                    <div className="flex items-center gap-3 px-3 py-2.5">
                      <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {companyName}
                        </p>
                        <p className="text-xs text-muted-foreground">Company</p>
                      </div>
                      <Check className="h-4 w-4 text-green-500 shrink-0" />
                    </div>
                    <div className="flex items-center gap-3 px-3 py-2.5">
                      <Bot className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {agentName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {getUIAdapter(adapterType).label}
                        </p>
                      </div>
                      <Check className="h-4 w-4 text-green-500 shrink-0" />
                    </div>
                    <div className="flex items-center gap-3 px-3 py-2.5">
                      <ListTodo className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {taskTitle}
                        </p>
                        <p className="text-xs text-muted-foreground">Task</p>
                      </div>
                      <Check className="h-4 w-4 text-green-500 shrink-0" />
                    </div>
                  </div>
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="mt-3">
                  <p className="text-xs text-destructive">{error}</p>
                </div>
              )}

              {/* Footer navigation */}
              <div className="flex items-center justify-between mt-8">
                <div>
                  {step > 1 && step > (onboardingOptions.initialStep ?? 1) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setStep((step - 1) as Step)}
                      disabled={loading}
                    >
                      <ArrowLeft className="h-3.5 w-3.5 mr-1" />
                      Back
                    </Button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {step === 1 && (
                    <Button
                      size="sm"
                      data-testid="step1-next"
                      disabled={!companyName.trim() || loading}
                      onClick={handleStep1Next}
                    >
                      {loading ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                      ) : (
                        <ArrowRight className="h-3.5 w-3.5 mr-1" />
                      )}
                      {loading ? "Creating..." : "Next"}
                    </Button>
                  )}
                  {step === 2 && (
                    <Button
                      size="sm"
                      data-testid="step2-next"
                      disabled={!rootFolder.trim() || loading}
                      onClick={handleStep2Next}
                    >
                      {loading ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                      ) : (
                        <ArrowRight className="h-3.5 w-3.5 mr-1" />
                      )}
                      {loading ? "Setting up..." : "Next"}
                    </Button>
                  )}
                  {/* Phase E batch 2 (T20): step 3 = Commander pick. */}
                  {step === 3 && (
                    <Button
                      size="sm"
                      data-testid="step3-next"
                      disabled={!commanderProvider || !commanderModel.trim() || loading}
                      onClick={handleStep3Next}
                    >
                      <ArrowRight className="h-3.5 w-3.5 mr-1" />
                      Next
                    </Button>
                  )}
                  {/* Phase E batch 2 (T20): step 4 = Crew pick.
                      This is the step that actually POSTs /companies — the
                      "Creating..." spinner sits here, not step 1, since
                      company creation was deferred to carry both adapter
                      configs in a single request. */}
                  {step === 4 && (
                    <Button
                      size="sm"
                      data-testid="step4-next"
                      disabled={!crewProvider || !crewModel.trim() || loading}
                      onClick={handleStep4Next}
                    >
                      {loading ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                      ) : (
                        <ArrowRight className="h-3.5 w-3.5 mr-1" />
                      )}
                      {loading ? "Creating company..." : "Next"}
                    </Button>
                  )}
                  {step === STEP_AGENT && (
                    <Button
                      size="sm"
                      data-testid="step5-next"
                      disabled={
                        !agentName.trim() || loading || adapterEnvLoading
                      }
                      onClick={handleStep5Next}
                    >
                      {loading ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                      ) : (
                        <ArrowRight className="h-3.5 w-3.5 mr-1" />
                      )}
                      {loading ? "Creating..." : "Next"}
                    </Button>
                  )}
                  {step === STEP_TASK && (
                    <Button
                      size="sm"
                      data-testid="step6-next"
                      disabled={!taskTitle.trim() || loading}
                      onClick={handleStep6Next}
                    >
                      {loading ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                      ) : (
                        <ArrowRight className="h-3.5 w-3.5 mr-1" />
                      )}
                      {loading ? "Creating..." : "Next"}
                    </Button>
                  )}
                  {step === 7 && (
                    <Button size="sm" data-testid="step7-next" onClick={() => setStep(8)}>
                      <ArrowRight className="h-3.5 w-3.5 mr-1" />
                      Next
                    </Button>
                  )}
                  {step === 8 && (
                    <Button
                      size="sm"
                      data-testid="step8-launch"
                      disabled={loading}
                      onClick={handleLaunch}
                    >
                      {loading ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                      ) : (
                        <ArrowRight className="h-3.5 w-3.5 mr-1" />
                      )}
                      {loading ? "Opening..." : "Open Task"}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Right half — ASCII art (hidden on mobile) */}
          <div className="hidden md:block w-1/2 overflow-hidden">
            <AsciiArtAnimation />
          </div>
        </div>
      </DialogPortal>
    </Dialog>
  );
}

function AdapterEnvironmentResult({
  result
}: {
  result: AdapterEnvironmentTestResult;
}) {
  const statusLabel =
    result.status === "pass"
      ? "Passed"
      : result.status === "warn"
        ? "Warnings"
        : "Failed";
  const statusClass =
    result.status === "pass"
      ? "text-green-700 dark:text-green-300 border-green-300 dark:border-green-500/40 bg-green-50 dark:bg-green-500/10"
      : result.status === "warn"
        ? "text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10"
        : "text-red-700 dark:text-red-300 border-red-300 dark:border-red-500/40 bg-red-50 dark:bg-red-500/10";

  return (
    <div className={`rounded-md border px-2.5 py-2 text-[11px] ${statusClass}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{statusLabel}</span>
        <span className="opacity-80">
          {new Date(result.testedAt).toLocaleTimeString()}
        </span>
      </div>
      <div className="mt-1.5 space-y-1">
        {result.checks.map((check, idx) => (
          <div
            key={`${check.code}-${idx}`}
            className="leading-relaxed break-words"
          >
            <span className="font-medium uppercase tracking-wide opacity-80">
              {check.level}
            </span>
            <span className="mx-1 opacity-60">·</span>
            <span>{check.message}</span>
            {check.detail && (
              <span className="block opacity-75 break-all">
                ({check.detail})
              </span>
            )}
            {check.hint && (
              <span className="block opacity-90 break-words">
                Hint: {check.hint}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
