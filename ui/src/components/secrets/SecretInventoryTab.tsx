import { useMemo, useState } from "react";
import { EyeOff, KeyRound, RefreshCw } from "lucide-react";
import type { CompanySecret } from "@armyofagents/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatSecretDate, modeLabel, providerLabel } from "./secret-ui";

interface SecretInventoryTabProps {
  secrets: CompanySecret[];
  selectedSecret: CompanySecret | null;
  onSelectSecret(id: string): void;
  onRotate?(secret: CompanySecret): void;
}

function statusLabel(status: CompanySecret["status"]): string {
  if (status === "disabled") return "Disabled";
  if (status === "archived") return "Archived";
  return "Active";
}

function statusClassName(status: CompanySecret["status"]): string {
  if (status === "active") return "border-emerald-500/35 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
  if (status === "disabled") return "border-amber-500/35 bg-amber-500/10 text-amber-600 dark:text-amber-400";
  return "border-muted-foreground/30 bg-muted text-muted-foreground";
}

function includesQuery(secret: CompanySecret, query: string): boolean {
  if (!query) return true;
  const searchable = [
    secret.name,
    secret.key,
    secret.description,
    secret.externalRef,
    providerLabel(secret.provider),
    modeLabel(secret.managedMode),
    secret.status,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return searchable.includes(query);
}

export function SecretInventoryTab({
  secrets,
  selectedSecret,
  onSelectSecret,
  onRotate,
}: SecretInventoryTabProps) {
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim().toLowerCase();
  const filteredSecrets = useMemo(
    () => secrets.filter((secret) => includesQuery(secret, normalizedSearch)),
    [normalizedSearch, secrets],
  );
  const visibleSelectedSecret =
    selectedSecret && filteredSecrets.some((secret) => secret.id === selectedSecret.id) ? selectedSecret : null;
  const canRotateSelectedSecret =
    Boolean(onRotate) && visibleSelectedSecret?.managedMode === "aoa_managed";

  return (
    <div className="grid min-h-[420px] gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(320px,1.05fr)]">
      <section className="min-w-0 rounded-md border border-border bg-card">
        <div className="border-b border-border p-3">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name, key, department"
            aria-label="Search secrets"
            className="h-9"
          />
        </div>

        {filteredSecrets.length === 0 ? (
          <div className="flex min-h-[280px] flex-col items-center justify-center px-6 py-10 text-center">
            <KeyRound className="mb-3 size-8 text-muted-foreground/40" />
            <h3 className="text-sm font-semibold">No secrets match your search</h3>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              Try another name, key, department, provider, or status.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filteredSecrets.map((secret) => (
              <button
                key={secret.id}
                type="button"
                aria-current={visibleSelectedSecret?.id === secret.id ? "true" : undefined}
                onClick={() => onSelectSecret(secret.id)}
                className={cn(
                  "block w-full px-4 py-3 text-left transition-colors hover:bg-accent/50",
                  visibleSelectedSecret?.id === secret.id && "bg-accent",
                )}
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-foreground">{secret.name}</div>
                    <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                      {secret.key ?? "No key assigned"}
                    </div>
                  </div>
                  <Badge variant="outline" className={cn("shrink-0 text-[10px]", statusClassName(secret.status))}>
                    {statusLabel(secret.status)}
                  </Badge>
                </div>
                {secret.description && (
                  <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{secret.description}</p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <span>{providerLabel(secret.provider)}</span>
                  <span aria-hidden="true">/</span>
                  <span>Last read {formatSecretDate(secret.lastResolvedAt)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="min-w-0 rounded-md border border-border bg-card">
        {visibleSelectedSecret ? (
          <div className="flex h-full flex-col">
            <div className="border-b border-border p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-base font-semibold">{visibleSelectedSecret.name}</h3>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <EyeOff className="size-3.5" />
                    <span>Value hidden after save</span>
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className={cn("shrink-0 text-[10px]", statusClassName(visibleSelectedSecret.status))}
                >
                  {statusLabel(visibleSelectedSecret.status)}
                </Badge>
              </div>
              {canRotateSelectedSecret && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => onRotate?.(visibleSelectedSecret)}>
                    <RefreshCw className="size-3.5" />
                    Rotate
                  </Button>
                </div>
              )}
            </div>

            <dl className="grid gap-3 p-4 text-sm sm:grid-cols-2">
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">Key</dt>
                <dd className="mt-1 truncate font-mono text-xs">{visibleSelectedSecret.key ?? "Not assigned"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Provider</dt>
                <dd className="mt-1">{providerLabel(visibleSelectedSecret.provider)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Managed mode</dt>
                <dd className="mt-1">{modeLabel(visibleSelectedSecret.managedMode)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Version</dt>
                <dd className="mt-1">v{visibleSelectedSecret.latestVersion}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Last read</dt>
                <dd className="mt-1">{formatSecretDate(visibleSelectedSecret.lastResolvedAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Last rotated</dt>
                <dd className="mt-1">{formatSecretDate(visibleSelectedSecret.lastRotatedAt)}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">Status</dt>
                <dd className="mt-1">{statusLabel(visibleSelectedSecret.status)}</dd>
              </div>
              {visibleSelectedSecret.description && (
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">Description</dt>
                  <dd className="mt-1 text-muted-foreground">{visibleSelectedSecret.description}</dd>
                </div>
              )}
              {visibleSelectedSecret.externalRef && (
                <div className="min-w-0 sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">External reference</dt>
                  <dd className="mt-1 truncate font-mono text-xs">{visibleSelectedSecret.externalRef}</dd>
                </div>
              )}
            </dl>
          </div>
        ) : (
          <div className="flex min-h-[320px] flex-col items-center justify-center px-6 py-10 text-center">
            <EyeOff className="mb-3 size-8 text-muted-foreground/40" />
            <h3 className="text-sm font-semibold">Select a secret</h3>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              Choose a row from the inventory to inspect metadata. Secret values are never revealed here.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
