import { useCallback, useState } from "react";
import { useNavigate } from "@/lib/router";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Settings } from "lucide-react";
import type { PatchInstanceGeneralSettings } from "@paperclipai/shared";
import { PluginManager } from "./PluginManager";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PageTabBar } from "@/components/PageTabBar";
import { PrivacyTab } from "@/components/settings/PrivacyTab";
import { BackupsTab } from "@/components/settings/BackupsTab";
import { HeartbeatsTab } from "@/components/settings/HeartbeatsTab";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { queryKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";

const TABS = [
  { value: "general", label: "General" },
  { value: "privacy", label: "Privacy" },
  { value: "backups", label: "Backups" },
  { value: "heartbeats", label: "Heartbeats" },
  { value: "experimental", label: "Experimental" },
  { value: "plugins", label: "Plugins" },
];

export function InstanceSettingsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") ?? "general";
  const [actionError, setActionError] = useState<string | null>(null);

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

  // ── General settings ──────────────────────────────────────────────────────

  const generalQuery = useQuery({
    queryKey: queryKeys.instanceSettings.general,
    queryFn: () => instanceSettingsApi.getGeneral(),
  });

  const generalMutation = useMutation({
    mutationFn: async (patch: PatchInstanceGeneralSettings) =>
      instanceSettingsApi.updateGeneral(patch),
    onSuccess: async () => {
      setActionError(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.instanceSettings.general });
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : "Failed to update general settings.");
    },
  });

  // ── Experimental settings ─────────────────────────────────────────────────

  const experimentalQuery = useQuery({
    queryKey: queryKeys.instanceSettings.experimental,
    queryFn: () => instanceSettingsApi.getExperimental(),
  });

  const experimentalMutation = useMutation({
    mutationFn: async (patch: { enableIsolatedWorkspaces?: boolean; autoRestartDevServerWhenIdle?: boolean }) =>
      instanceSettingsApi.updateExperimental(patch),
    onSuccess: async () => {
      setActionError(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.instanceSettings.experimental });
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : "Failed to update experimental settings.");
    },
  });

  const censorUsernameInLogs = generalQuery.data?.censorUsernameInLogs === true;
  const keyboardShortcuts = generalQuery.data?.keyboardShortcuts === true;
  const enableIsolatedWorkspaces = experimentalQuery.data?.enableIsolatedWorkspaces === true;
  const autoRestartDevServerWhenIdle = experimentalQuery.data?.autoRestartDevServerWhenIdle === true;

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      {/* Minimal header matching Lobby style */}
      <header className="flex items-center gap-3 px-6 h-14 shrink-0 border-b border-border">
        <button
          type="button"
          onClick={() => navigate("/")}
          className="flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          aria-label="Back to Lobby"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-2">
          <Settings className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-bold tracking-tight text-foreground">Instance Settings</span>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl px-6 py-8 space-y-6">
          {actionError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {actionError}
            </div>
          )}

          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <PageTabBar items={TABS} value={activeTab} onValueChange={handleTabChange} />

            {/* ── General tab ──────────────────────────────────────────── */}
            <TabsContent value="general" className="mt-6 space-y-4">
              <div className="space-y-1">
                <h2 className="text-base font-semibold">General</h2>
                <p className="text-sm text-muted-foreground">
                  Instance-wide defaults that affect how operator-visible logs are displayed and how
                  teammates interact with the app.
                </p>
              </div>

              {generalQuery.isLoading ? (
                <div className="text-sm text-muted-foreground">Loading...</div>
              ) : generalQuery.error ? (
                <div className="text-sm text-destructive">Failed to load general settings.</div>
              ) : (
                <>
                  <ToggleCard
                    title="Censor username in logs"
                    description="Hide the username segment in home-directory paths and similar operator-visible log output. Standalone username mentions outside of paths are not yet masked in the live transcript view."
                    checked={censorUsernameInLogs}
                    disabled={generalMutation.isPending}
                    onToggle={() =>
                      generalMutation.mutate({ censorUsernameInLogs: !censorUsernameInLogs })
                    }
                  />
                  <ToggleCard
                    title="Keyboard shortcuts"
                    description="Enable app-wide keyboard shortcuts, including inbox navigation and global shortcuts like creating a task or toggling panels. Off by default. Individual key bindings are read-only for now."
                    checked={keyboardShortcuts}
                    disabled={generalMutation.isPending}
                    onToggle={() =>
                      generalMutation.mutate({ keyboardShortcuts: !keyboardShortcuts })
                    }
                  />
                </>
              )}
            </TabsContent>

            {/* ── Privacy tab ──────────────────────────────────────────── */}
            <TabsContent value="privacy" className="mt-6">
              <PrivacyTab
                settings={generalQuery.data}
                isLoading={generalQuery.isLoading}
                error={generalQuery.error}
                isSaving={generalMutation.isPending}
                onChange={(patch) => generalMutation.mutate(patch)}
              />
            </TabsContent>

            {/* ── Backups tab ──────────────────────────────────────────── */}
            <TabsContent value="backups" className="mt-6">
              <BackupsTab
                settings={generalQuery.data}
                isLoading={generalQuery.isLoading}
                error={generalQuery.error}
                isSaving={generalMutation.isPending}
                onChange={(patch) => generalMutation.mutate(patch)}
              />
            </TabsContent>

            {/* ── Heartbeats tab ───────────────────────────────────────── */}
            <TabsContent value="heartbeats" className="mt-6">
              <HeartbeatsTab />
            </TabsContent>

            {/* ── Experimental tab ─────────────────────────────────────── */}
            <TabsContent value="experimental" className="mt-6 space-y-4">
              <div className="space-y-1">
                <h2 className="text-base font-semibold">Experimental</h2>
                <p className="text-sm text-muted-foreground">
                  Opt into features that are still being evaluated before they become default behavior.
                </p>
              </div>

              {experimentalQuery.isLoading ? (
                <div className="text-sm text-muted-foreground">Loading...</div>
              ) : experimentalQuery.error ? (
                <div className="text-sm text-destructive">Failed to load experimental settings.</div>
              ) : (
                <>
                  <ToggleCard
                    title="Enable Isolated Workspaces"
                    description="Show execution workspace controls in project configuration and allow isolated workspace behavior for new and existing issue runs."
                    checked={enableIsolatedWorkspaces}
                    disabled={experimentalMutation.isPending}
                    onToggle={() => experimentalMutation.mutate({ enableIsolatedWorkspaces: !enableIsolatedWorkspaces })}
                  />
                  <ToggleCard
                    title="Auto-Restart Dev Server When Idle"
                    description="In pnpm dev:once, wait for all queued and running local agent runs to finish, then restart the server automatically when backend changes or migrations make the current boot stale."
                    checked={autoRestartDevServerWhenIdle}
                    disabled={experimentalMutation.isPending}
                    onToggle={() => experimentalMutation.mutate({ autoRestartDevServerWhenIdle: !autoRestartDevServerWhenIdle })}
                  />
                </>
              )}
            </TabsContent>

            {/* ── Plugins tab ─────────────────────────────────────────── */}
            <TabsContent value="plugins" className="mt-6">
              <PluginManager />
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}

// ── Reusable toggle card ──────────────────────────────────────────────────────

function ToggleCard({
  title,
  description,
  checked,
  disabled,
  onToggle,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1.5">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
        </div>
        <button
          type="button"
          data-slot="toggle"
          aria-label={`Toggle ${title}`}
          disabled={disabled}
          className={cn(
            "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60",
            checked ? "bg-green-600" : "bg-muted",
          )}
          onClick={onToggle}
        >
          <span
            className={cn(
              "inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform",
              checked ? "translate-x-4.5" : "translate-x-0.5",
            )}
          />
        </button>
      </div>
    </section>
  );
}
