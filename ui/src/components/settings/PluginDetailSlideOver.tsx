import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import type { InstalledPlugin } from "../../api/plugins.js";
import * as pluginsApi from "../../api/plugins.js";
import type { PendingUpdate } from "../../api/marketplace.js";
import { PluginConfigForm } from "./PluginConfigForm.js";
import { CapabilityDeltaModal } from "./CapabilityDeltaModal.js";

interface Props {
  companyId: string;
  plugin: InstalledPlugin;
  pendingUpdate: PendingUpdate | undefined;
  onClose: () => void;
}

type Tab = "overview" | "settings";

export function PluginDetailSlideOver({ companyId, plugin, pendingUpdate, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("overview");
  const [upgradeResult, setUpgradeResult] = useState<pluginsApi.UpgradeResult | null>(null);
  const queryClient = useQueryClient();

  const { data: config } = useQuery({
    queryKey: ["plugin-config", companyId, plugin.id],
    queryFn: () => pluginsApi.getPluginConfig(companyId, plugin.id),
    enabled: tab === "settings",
  });

  const upgradeMutation = useMutation({
    mutationFn: (version: string) => pluginsApi.upgradePlugin(companyId, plugin.id, version),
    onSuccess: (result) => {
      if (result.status === "ready") {
        queryClient.invalidateQueries({ queryKey: ["company-plugins", companyId] });
      } else {
        setUpgradeResult(result);
      }
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (enabled: boolean) => pluginsApi.patchPluginSettings(companyId, plugin.id, enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["company-plugins", companyId] }),
  });

  const statusColor: Record<string, string> = {
    ready: "text-green-400",
    error: "text-red-400",
    upgrade_pending: "text-indigo-400",
    disabled: "text-zinc-500",
    installed: "text-zinc-400",
  };

  return (
    <>
      {upgradeResult?.status === "upgrade_pending" && upgradeResult.delta && (
        <CapabilityDeltaModal
          companyId={companyId}
          pluginId={plugin.id}
          pluginName={plugin.manifest.displayName}
          fromVersion={plugin.version}
          toVersion={upgradeResult.version}
          delta={upgradeResult.delta}
          onApproved={() => {
            setUpgradeResult(null);
            queryClient.invalidateQueries({ queryKey: ["company-plugins", companyId] });
          }}
          onCancelled={() => setUpgradeResult(null)}
        />
      )}

      <div className="w-[360px] bg-zinc-900 border-l border-zinc-800 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 pt-4 pb-0 border-b border-zinc-800">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="text-xl">{plugin.categories.includes("notifications") ? "🔔" : "🔌"}</div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-zinc-100">{plugin.manifest.displayName}</span>
                  <span className="text-[9px] bg-indigo-950 border border-indigo-900 text-indigo-300 px-1.5 py-0.5 rounded-full">
                    Plugin
                  </span>
                </div>
                <div className="text-[10px] text-zinc-600 font-mono truncate max-w-[220px]">
                  {plugin.packageName}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-zinc-600 hover:text-zinc-400 p-1"
            >
              <X size={14} />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex">
            {(["overview", "settings"] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 text-xs capitalize border-b-2 transition-colors ${
                  tab === t
                    ? "text-zinc-100 border-indigo-500"
                    : "text-zinc-600 border-transparent hover:text-zinc-400"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {tab === "overview" ? (
            <div className="space-y-1">
              {/* Info rows */}
              {[
                { label: "Installed version", value: `v${plugin.version}` },
                {
                  label: "Latest in catalog",
                  value: pendingUpdate ? `v${pendingUpdate.latestVersion}` : `v${plugin.version} (current)`,
                  valueClass: pendingUpdate ? "text-amber-400" : undefined,
                },
                {
                  label: "Status",
                  value: plugin.status,
                  valueClass: statusColor[plugin.status] ?? "text-zinc-300",
                },
                {
                  label: "Installed",
                  value: new Date(plugin.installedAt).toLocaleDateString(),
                },
              ].map(({ label, value, valueClass }) => (
                <div
                  key={label}
                  className="flex justify-between items-center py-2 border-b border-zinc-800/60"
                >
                  <span className="text-xs text-zinc-500">{label}</span>
                  <span className={`text-xs font-medium ${valueClass ?? "text-zinc-300"}`}>
                    {value}
                  </span>
                </div>
              ))}

              {/* Upgrade banner */}
              {pendingUpdate && (
                <div className="bg-amber-950/20 border border-amber-900/40 rounded-lg p-3 mt-3">
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-xs font-bold text-amber-400">Update available</span>
                    <span className="text-[10px] text-zinc-600">
                      v{plugin.version} → v{pendingUpdate.latestVersion}
                    </span>
                  </div>
                  <p className="text-[10px] text-zinc-500 mb-2.5">
                    New version is available from the marketplace.
                  </p>
                  <button
                    type="button"
                    onClick={() => upgradeMutation.mutate(pendingUpdate.latestVersion)}
                    disabled={upgradeMutation.isPending}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-xs font-semibold py-1.5 rounded-md transition-colors"
                  >
                    {upgradeMutation.isPending ? "Upgrading…" : `Upgrade to v${pendingUpdate.latestVersion}`}
                  </button>
                  {upgradeMutation.isError && (
                    <p className="text-[10px] text-red-400 mt-1.5">
                      {upgradeMutation.error instanceof Error ? upgradeMutation.error.message : "Upgrade failed"}
                    </p>
                  )}
                </div>
              )}

              {/* Capabilities */}
              {plugin.manifest.capabilities.length > 0 && (
                <>
                  <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider mt-4 mb-2">
                    Capabilities
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {plugin.manifest.capabilities.map((cap) => (
                      <span
                        key={cap}
                        className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-500"
                      >
                        {cap}
                      </span>
                    ))}
                  </div>
                </>
              )}

              {/* Error */}
              {plugin.lastError && (
                <div className="mt-3 bg-red-950/20 border border-red-900/40 rounded-lg p-3">
                  <p className="text-[10px] font-semibold text-red-400 mb-1">Last error</p>
                  <p className="text-[10px] text-zinc-500 font-mono break-all">{plugin.lastError}</p>
                </div>
              )}

              {/* Actions */}
              <div className="mt-4 space-y-2">
                <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Actions</p>
                <button
                  type="button"
                  disabled={toggleMutation.isPending}
                  onClick={() => toggleMutation.mutate(!plugin.enabled)}
                  className="w-full text-left text-xs text-zinc-400 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-60 border border-zinc-700 rounded-lg px-3 py-2 transition-colors"
                >
                  {plugin.enabled ? "Disable for this company" : "Enable for this company"}
                </button>
              </div>
            </div>
          ) : (
            <PluginConfigForm
              companyId={companyId}
              pluginId={plugin.id}
              schema={plugin.manifest.instanceConfigSchema as any}
              initialValues={config?.configJson ?? plugin.configJson}
            />
          )}
        </div>
      </div>
    </>
  );
}
