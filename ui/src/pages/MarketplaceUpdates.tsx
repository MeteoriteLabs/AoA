import { useState } from "react";
import { usePendingUpdates, useDismissUpdate } from "@/hooks/usePendingUpdates";
import { UpdateCard } from "@/components/marketplace/UpdateCard";
import { MarketplaceLayout } from "@/components/marketplace/MarketplaceLayout";
import { SnapshotUpdateModal } from "@/components/marketplace/SnapshotUpdateModal";
import { CheckCircle } from "lucide-react";
import type { PendingUpdate } from "@/api/marketplace";
import { useToast } from "@/context/ToastContext";
import { useCompany } from "@/context/CompanyContext";

const TYPE_LABELS: Record<string, string> = {
  skill: "Skills",
  agent: "Agents",
  team: "Teams",
  plugin: "Plugins",
};

export default function MarketplaceUpdates() {
  const { data: updates, isLoading } = usePendingUpdates();
  const dismiss = useDismissUpdate();
  const { pushToast } = useToast();
  const { selectedCompany } = useCompany();
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [reviewUpdate, setReviewUpdate] = useState<PendingUpdate | null>(null);

  if (isLoading) {
    return (
      <MarketplaceLayout breadcrumbs={[{ label: "Updates" }]} actions={undefined}>
        <div className="p-8 text-sm text-muted-foreground">Loading updates...</div>
      </MarketplaceLayout>
    );
  }

  const pending = (updates ?? []).filter(
    (u) => u.status === "pending" || u.status === "conflict",
  );

  const grouped = pending.reduce<Record<string, PendingUpdate[]>>((acc, u) => {
    if (!acc[u.itemType]) acc[u.itemType] = [];
    acc[u.itemType]!.push(u);
    return acc;
  }, {});

  if (pending.length === 0) {
    return (
      <MarketplaceLayout breadcrumbs={[{ label: "Updates" }]} actions={undefined}>
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <CheckCircle className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">All up to date</p>
          <p className="text-xs text-muted-foreground">
            No pending updates. Check back after the next catalog sync.
          </p>
        </div>
      </MarketplaceLayout>
    );
  }

  return (
    <>
      <MarketplaceLayout breadcrumbs={[{ label: "Updates" }]} actions={undefined}>
        <div className="space-y-6 max-w-3xl mx-auto">
          <div>
            <h1 className="text-lg font-semibold">Updates</h1>
            <p className="text-sm text-muted-foreground">
              Pending updates for installed catalog items
            </p>
          </div>
          {Object.entries(grouped).map(([type, items]) => (
            <div key={type}>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                {TYPE_LABELS[type] ?? type} &middot; {items.length}
              </h3>
              <div className="space-y-2">
                {items.map((update) => (
                  <UpdateCard
                    key={update.id}
                    update={update}
                    onDismiss={async () => {
                      setDismissingId(update.id);
                      try {
                        await dismiss.mutateAsync(update.id);
                      } catch (err) {
                        pushToast({ title: "Failed to dismiss update", body: err instanceof Error ? err.message : undefined, tone: "error" });
                      } finally {
                        setDismissingId(null);
                      }
                    }}
                    onReview={update.itemType !== "plugin" ? () => setReviewUpdate(update) : undefined}
                    isPending={dismissingId === update.id}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </MarketplaceLayout>
      {reviewUpdate && selectedCompany && (
        <SnapshotUpdateModal
          open
          onClose={() => setReviewUpdate(null)}
          companyId={selectedCompany.id}
          updateId={reviewUpdate.id}
          itemName={reviewUpdate.catalogItemName}
        />
      )}
    </>
  );
}
