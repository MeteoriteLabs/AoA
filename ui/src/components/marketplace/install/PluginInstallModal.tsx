import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { CatalogItem } from "@armyofagents/shared";
import { TrustBadge } from "../TrustBadge";
import { useCompany } from "@/context/CompanyContext";
import { useInstallOperation } from "@/hooks/useInstallOperation";
import { useOperationStatus } from "@/hooks/useOperationStatus";
import { useInstallToast } from "../toast/useInstallToast";

export interface PluginInstallModalProps {
  item: CatalogItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Modal for plugin install — instance-scoped, no company picker.
 * Shows capabilities for review.
 *
 * Flow on Install click (per spec §6.6 + M3b.D8):
 *   1. Modal closes immediately
 *   2. Toast shows "Installing {name}…" with spinner
 *   3. Polling tracks operation status
 *   4. On success: toast updates to "Installed", auto-dismiss 3s
 *   5. On failure: toast updates with error message, auto-dismiss 3s
 *
 * Plugins are instance-scoped per M.2.D8 — installing under any company URL
 * produces an identical instance-wide plugin row.
 */
export function PluginInstallModal({ item, open, onOpenChange }: PluginInstallModalProps) {
  const { selectedCompanyId, companies } = useCompany();
  // Plugin install needs a companyId for the route URL even though it's instance-scoped.
  // Use selectedCompanyId or fallback to first non-archived company.
  const installCompanyId =
    selectedCompanyId ?? companies.find((c) => c.status !== "archived")?.id ?? null;

  const installMutation = useInstallOperation({ companyId: installCompanyId ?? "" });
  const { show, update } = useInstallToast();
  const [pendingOpId, setPendingOpId] = useState<string | null>(null);
  const [pendingToastId, setPendingToastId] = useState<number | null>(null);

  const { data: opStatus } = useOperationStatus({
    companyId: installCompanyId,
    operationId: pendingOpId,
  });

  // React to terminal status — update toast and clear tracking state
  useEffect(() => {
    if (!opStatus || pendingToastId === null) return;
    if (opStatus.status === "success") {
      update(pendingToastId, { status: "success", message: `Installed ${item.name}` });
      setPendingOpId(null);
      setPendingToastId(null);
    } else if (opStatus.status === "failure") {
      update(pendingToastId, {
        status: "failure",
        message: `Failed to install ${item.name}`,
        detail: opStatus.errorMessage ?? "Unknown error",
      });
      setPendingOpId(null);
      setPendingToastId(null);
    }
  }, [opStatus, pendingToastId, update, item.name]);

  const handleInstall = async () => {
    if (!installCompanyId) return;
    const toastId = show({ status: "installing", message: `Installing ${item.name}…` });
    setPendingToastId(toastId);
    onOpenChange(false); // close modal immediately
    try {
      const result = await installMutation.mutateAsync({ catalogItemId: item.id });
      setPendingOpId(result.operationId);
    } catch (err) {
      update(toastId, {
        status: "failure",
        message: `Failed to start install`,
        detail: err instanceof Error ? err.message : String(err),
      });
      setPendingToastId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Install {item.name}</DialogTitle>
          <DialogDescription>{item.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <TrustBadge tier={item.trust.tier} />
            <Badge variant="outline" className="text-xs">
              v{item.version}
            </Badge>
            <Badge variant="secondary" className="text-xs">
              Instance-wide
            </Badge>
          </div>

          {item.capabilities && item.capabilities.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-2">This plugin will have access to:</h4>
              <ul className="space-y-1 text-sm max-h-60 overflow-y-auto">
                {item.capabilities.map((cap) => (
                  <li key={cap.id} className="flex items-start gap-2">
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded shrink-0">
                      {cap.id}
                    </code>
                    <span className="text-muted-foreground">{cap.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Plugins are installed instance-wide and available to all companies.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleInstall}
            disabled={installMutation.isPending || !installCompanyId}
          >
            {installMutation.isPending ? "Starting install…" : "Install"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
