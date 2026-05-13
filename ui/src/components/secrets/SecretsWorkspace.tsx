import { useMemo, useState } from "react";
import { CloudDownload, Plus } from "lucide-react";
import type { CompanySecret } from "@armyofagents/shared";
import { useQuery } from "@tanstack/react-query";
import { secretsApi } from "@/api/secrets";
import { Button } from "@/components/ui/button";
import { queryKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import { SecretEmptyState } from "./SecretEmptyState";
import { SecretInventoryTab } from "./SecretInventoryTab";

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
  const [activeTab, setActiveTab] = useState<SecretsTab>("inventory");
  const [selectedSecretId, setSelectedSecretId] = useState<string | null>(null);
  const secretsQuery = useQuery({
    queryKey: queryKeys.secrets.list(companyId),
    queryFn: () => secretsApi.list(companyId),
  });

  const secrets = secretsQuery.data ?? [];
  const selectedSecret = useMemo<CompanySecret | null>(
    () => secrets.find((secret) => secret.id === selectedSecretId) ?? secrets[0] ?? null,
    [secrets, selectedSecretId],
  );
  const errorMessage = secretsQuery.error instanceof Error ? secretsQuery.error.message : null;

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
            <Button type="button" size="sm">
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
        ) : secrets.length === 0 ? (
          <SecretEmptyState />
        ) : activeTab === "inventory" ? (
          <SecretInventoryTab
            secrets={secrets}
            selectedSecret={selectedSecret}
            onSelectSecret={setSelectedSecretId}
            onRotate={() => undefined}
          />
        ) : (
          <section className="rounded-md border border-border bg-card p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {TABS.find((tab) => tab.id === activeTab)?.label}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              This settings tab will be wired in a later task. Inventory is available now.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
