import { useMemo, useState } from "react";
import { CloudDownload, Plus } from "lucide-react";
import type { CompanySecret } from "@armyofagents/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { secretsApi, type CreateSecretInput, type CreateSecretProviderConfigInput } from "@/api/secrets";
import { Button } from "@/components/ui/button";
import { queryKeys } from "@/lib/queryKeys";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { AddSecretDialog } from "./AddSecretDialog";
import { RotateSecretDialog } from "./RotateSecretDialog";
import { SecretAuditTab } from "./SecretAuditTab";
import { SecretBindingsTab } from "./SecretBindingsTab";
import { SecretEmptyState } from "./SecretEmptyState";
import { SecretInventoryTab } from "./SecretInventoryTab";
import { SecretVaultProvidersTab } from "./SecretVaultProvidersTab";

const TABS = [
  { id: "inventory", label: "Inventory" },
  { id: "bindings", label: "Bindings" },
  { id: "vaults", label: "Vault providers" },
  { id: "audit", label: "Audit" },
] as const;
type SecretsTab = (typeof TABS)[number]["id"];

interface SecretsWorkspaceProps {
  companyId: string;
}

export function SecretsWorkspace({ companyId }: SecretsWorkspaceProps) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<SecretsTab>("inventory");
  const [selectedSecretId, setSelectedSecretId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [rotateTarget, setRotateTarget] = useState<CompanySecret | null>(null);
  const secretsQuery = useQuery({
    queryKey: queryKeys.secrets.list(companyId),
    queryFn: () => secretsApi.list(companyId),
  });
  const providersQuery = useQuery({
    queryKey: queryKeys.secrets.providers(companyId),
    queryFn: () => secretsApi.providers(companyId),
  });
  const providerConfigsQuery = useQuery({
    queryKey: queryKeys.secrets.providerConfigs(companyId),
    queryFn: () => secretsApi.providerConfigs.list(companyId),
  });
  const rotateBindingsQuery = useQuery({
    queryKey: rotateTarget ? queryKeys.secrets.bindings(rotateTarget.id) : ["secret-bindings", "__none__"],
    queryFn: () => secretsApi.bindings.list(rotateTarget!.id),
    enabled: Boolean(rotateTarget),
  });

  const selectedSecret = useMemo<CompanySecret | null>(() => {
    const secrets = secretsQuery.data ?? [];
    return secrets.find((secret) => secret.id === selectedSecretId) ?? secrets[0] ?? null;
  }, [secretsQuery.data, selectedSecretId]);

  const bindingsQuery = useQuery({
    queryKey: selectedSecret ? queryKeys.secrets.bindings(selectedSecret.id) : ["secret-bindings", "__none__"],
    queryFn: () => secretsApi.bindings.list(selectedSecret!.id),
    enabled: Boolean(selectedSecret && activeTab === "bindings"),
  });
  const accessEventsQuery = useQuery({
    queryKey: selectedSecret ? queryKeys.secrets.accessEvents(selectedSecret.id) : ["secret-access-events", "__none__"],
    queryFn: () => secretsApi.accessEvents(selectedSecret!.id),
    enabled: Boolean(selectedSecret && activeTab === "audit"),
  });

  const createSecret = useMutation({
    mutationFn: (input: CreateSecretInput) => secretsApi.create(companyId, input),
    onSuccess: (created) => {
      setSelectedSecretId(created.id);
      setAddOpen(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.secrets.list(companyId) });
    },
  });

  const createProviderConfig = useMutation({
    mutationFn: (input: CreateSecretProviderConfigInput) => secretsApi.providerConfigs.create(companyId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.secrets.providerConfigs(companyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.secrets.providers(companyId) });
      toast.success("Vault saved");
    },
    onError: (err) => {
      toast.error("Vault save failed", { description: err instanceof Error ? err.message : undefined });
    },
  });

  const checkProviderConfig = useMutation({
    mutationFn: (id: string) => secretsApi.providerConfigs.check(id),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.secrets.providerConfigs(companyId) });
      toast.success("Vault checked", { description: result.message ?? result.status });
    },
    onError: (err) => {
      toast.error("Vault check failed", { description: err instanceof Error ? err.message : undefined });
    },
  });

  const rotateSecret = useMutation({
    mutationFn: ({ id, value }: { id: string; value: string }) => secretsApi.rotate(id, { value }),
    onSuccess: () => {
      setRotateTarget(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.secrets.list(companyId) });
    },
  });

  const secrets = secretsQuery.data ?? [];
  const providerConfigs = providerConfigsQuery.data ?? [];
  const errorMessage = secretsQuery.error instanceof Error ? secretsQuery.error.message : null;
  const createErrorMessage = createSecret.error instanceof Error ? createSecret.error.message : null;
  const rotateErrorMessage = rotateSecret.error instanceof Error ? rotateSecret.error.message : null;
  const createProviderErrorMessage =
    createProviderConfig.error instanceof Error ? createProviderConfig.error.message : null;

  function renderSelectedSecretRequiredTab(tab: Exclude<SecretsTab, "inventory" | "vaults">) {
    if (!selectedSecret) {
      return (
        <section className="rounded-md border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          Select a secret to view {tab === "bindings" ? "bindings" : "audit events"}.
        </section>
      );
    }

    if (tab === "bindings") {
      return <SecretBindingsTab bindings={bindingsQuery.data ?? []} secrets={secrets} />;
    }

    return <SecretAuditTab events={accessEventsQuery.data ?? []} />;
  }

  return (
    <div>
      <div className="border-b border-border px-8 pb-3 pt-6">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/60">
          Settings - Operations
        </div>
        <div className="mt-1 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <h2 className="text-[1.4rem] font-bold tracking-tight">
              Secrets<span className="text-brand">.</span>
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Credentials and secret references used by agents, environments, departments, and integrations.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" variant="outline" size="sm">
              <CloudDownload className="size-3.5" />
              Import
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                createSecret.reset();
                setAddOpen(true);
              }}
            >
              <Plus className="size-3.5" />
              Add secret
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-4 p-8">
        <div
          role="tablist"
          aria-label="Secrets sections"
          className="inline-flex max-w-full flex-wrap gap-1 rounded-md border border-border bg-card p-1"
        >
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={cn(
                "h-[26px] rounded-[5px] px-2.5 text-xs font-semibold text-muted-foreground transition-colors",
                activeTab === tab.id && "bg-accent text-foreground",
              )}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {secretsQuery.isLoading ? (
          <div className="rounded-md border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
            Loading secrets...
          </div>
        ) : secretsQuery.isError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            <p>Failed to load secrets. Please refresh and try again.</p>
            {errorMessage && <p className="mt-1 text-xs text-destructive/80">{errorMessage}</p>}
          </div>
        ) : activeTab === "inventory" && secrets.length === 0 ? (
          <SecretEmptyState />
        ) : activeTab === "inventory" ? (
          <SecretInventoryTab
            secrets={secrets}
            selectedSecret={selectedSecret}
            onSelectSecret={setSelectedSecretId}
            onRotate={(secret) => {
              rotateSecret.reset();
              setRotateTarget(secret);
            }}
          />
        ) : activeTab === "bindings" ? (
          renderSelectedSecretRequiredTab("bindings")
        ) : activeTab === "vaults" ? (
          <SecretVaultProvidersTab
            providers={providersQuery.data ?? []}
            providerConfigs={providerConfigs}
            onCreateAwsVault={(input) => createProviderConfig.mutateAsync(input)}
            onCheckVault={(id) => checkProviderConfig.mutateAsync(id)}
            createErrorMessage={createProviderErrorMessage}
            checkingVaultId={checkProviderConfig.variables ?? null}
          />
        ) : activeTab === "audit" ? (
          renderSelectedSecretRequiredTab("audit")
        ) : (
          null
        )}
      </div>

      <AddSecretDialog
        open={addOpen}
        onOpenChange={(open) => {
          if (!open) createSecret.reset();
          setAddOpen(open);
        }}
        providerConfigs={providerConfigs}
        errorMessage={createErrorMessage}
        onSubmit={(input) => createSecret.mutateAsync(input)}
      />
      <RotateSecretDialog
        open={Boolean(rotateTarget)}
        onOpenChange={(open) => {
          if (!open) setRotateTarget(null);
        }}
        secret={rotateTarget}
        impactedBindingCount={rotateBindingsQuery.data?.length ?? 0}
        errorMessage={rotateErrorMessage}
        onSubmit={({ value }) => {
          if (!rotateTarget) return;
          return rotateSecret.mutateAsync({ id: rotateTarget.id, value });
        }}
      />
    </div>
  );
}
