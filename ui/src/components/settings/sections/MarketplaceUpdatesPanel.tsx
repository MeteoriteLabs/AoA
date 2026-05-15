import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle } from "lucide-react";

import { ApiError } from "@/api/client";
import { marketplaceApi, type PendingUpdate } from "@/api/marketplace";
import { PageSkeleton } from "@/components/PageSkeleton";
import { SnapshotUpdateModal } from "@/components/marketplace/SnapshotUpdateModal";
import { UpdateCard } from "@/components/marketplace/UpdateCard";
import { CapabilityDeltaModal } from "@/components/settings/CapabilityDeltaModal";
import { useCompany } from "@/context/CompanyContext";
import { useToast } from "@/context/ToastContext";
import { useDismissUpdate, usePendingUpdates } from "@/hooks/usePendingUpdates";

const TYPE_LABELS: Record<string, string> = {
  skill: "Skills",
  agent: "Agents",
  team: "Teams",
  plugin: "Plugins",
};

export function MarketplaceUpdatesPanel() {
  const { selectedCompany } = useCompany();
  const { data: updates, isLoading } = usePendingUpdates();
  const dismiss = useDismissUpdate();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reviewUpdate, setReviewUpdate] = useState<PendingUpdate | null>(null);
  const [permissionUpdate, setPermissionUpdate] = useState<{
    update: PendingUpdate;
    pluginId: string;
    version: string;
    delta: string[];
  } | null>(null);

  const pending = useMemo(
    () =>
      (updates ?? []).filter(
        (update) => update.status === "pending" || update.status === "conflict",
      ),
    [updates],
  );

  const grouped = useMemo(
    () =>
      pending.reduce<Record<string, PendingUpdate[]>>((acc, update) => {
        if (!acc[update.itemType]) acc[update.itemType] = [];
        acc[update.itemType]!.push(update);
        return acc;
      }, {}),
    [pending],
  );

  const invalidateUpdates = async () => {
    if (!selectedCompany?.id) return;
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["marketplace", "updates", selectedCompany.id],
      }),
      queryClient.invalidateQueries({
        queryKey: ["marketplace-updates", selectedCompany.id],
      }),
      queryClient.invalidateQueries({
        queryKey: ["company-plugins", selectedCompany.id],
      }),
    ]);
  };

  const applyPluginUpdate = async (update: PendingUpdate) => {
    if (!selectedCompany?.id) return;
    setBusyId(update.id);
    try {
      const result = await marketplaceApi.applyUpdate(selectedCompany.id, update.id);
      await invalidateUpdates();
      if (result.status === "upgrade_pending" && result.pluginId && result.delta?.length) {
        setPermissionUpdate({
          update,
          pluginId: result.pluginId,
          version: result.version ?? update.latestVersion,
          delta: result.delta,
        });
        pushToast({
          title: "Plugin permissions need approval",
          body: `${update.catalogItemName} added new capabilities.`,
          tone: "info",
        });
        return;
      }
      pushToast({ title: `Updated ${update.catalogItemName}`, tone: "success" });
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        pushToast({
          title: "Only instance admins can update plugins",
          body: `Ask an instance admin to apply the ${update.catalogItemName} plugin update.`,
          tone: "error",
        });
        return;
      }
      pushToast({
        title: "Failed to apply update",
        body: err instanceof Error ? err.message : undefined,
        tone: "error",
      });
    } finally {
      setBusyId(null);
    }
  };

  const dismissPendingUpdate = async (update: PendingUpdate) => {
    setBusyId(update.id);
    try {
      await dismiss.mutateAsync(update.id);
      await invalidateUpdates();
    } catch (err) {
      pushToast({
        title: "Failed to dismiss update",
        body: err instanceof Error ? err.message : undefined,
        tone: "error",
      });
    } finally {
      setBusyId(null);
    }
  };

  if (isLoading) {
    return <PageSkeleton variant="list" />;
  }

  if (!selectedCompany) {
    return (
      <div className="space-y-3">
        <UpdatesHeader />
        <p className="text-sm text-muted-foreground">
          Select a company to review marketplace updates.
        </p>
      </div>
    );
  }

  if (pending.length === 0) {
    return (
      <div className="space-y-4">
        <UpdatesHeader />
        <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-border px-4 py-12 text-center">
          <CheckCircle className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">All marketplace items are up to date</p>
          <p className="max-w-md text-xs text-muted-foreground">
            Installed plugins, skills, agents, and teams will appear here when newer
            marketplace versions are available.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-6">
        <UpdatesHeader />
        {Object.entries(grouped).map(([type, items]) => (
          <section key={type} className="space-y-3">
            <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {TYPE_LABELS[type] ?? type} · {items.length}
            </h4>
            <div className="space-y-2">
              {items.map((update) => (
                <UpdateCard
                  key={update.id}
                  update={update}
                  isPending={busyId === update.id}
                  onApply={
                    update.itemType === "plugin"
                      ? () => applyPluginUpdate(update)
                      : undefined
                  }
                  onReview={
                    update.itemType !== "plugin"
                      ? () => setReviewUpdate(update)
                      : undefined
                  }
                  onDismiss={() => dismissPendingUpdate(update)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
      {reviewUpdate && (
        <SnapshotUpdateModal
          open
          onClose={() => setReviewUpdate(null)}
          companyId={selectedCompany.id}
          updateId={reviewUpdate.id}
          itemName={reviewUpdate.catalogItemName}
        />
      )}
      {permissionUpdate && selectedCompany && (
        <CapabilityDeltaModal
          companyId={selectedCompany.id}
          pluginId={permissionUpdate.pluginId}
          pluginName={permissionUpdate.update.catalogItemName}
          fromVersion={permissionUpdate.update.currentVersion}
          toVersion={permissionUpdate.version}
          delta={permissionUpdate.delta}
          onApproved={() => {
            setPermissionUpdate(null);
            void invalidateUpdates();
          }}
          onCancelled={() => {
            setPermissionUpdate(null);
            void invalidateUpdates();
          }}
        />
      )}
    </>
  );
}

function UpdatesHeader() {
  return (
    <div>
      <h3 className="text-base font-semibold">Marketplace updates</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Review pending updates for installed catalog items in this company.
      </p>
    </div>
  );
}
