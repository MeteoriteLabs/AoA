import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
import type { CatalogItem, PluginCapability } from "@armyofagents/shared";
import { PLUGIN_CAPABILITIES } from "@armyofagents/shared";
import { TrustBadge } from "../TrustBadge";
import { CapabilityConsentStep } from "./CapabilityConsentStep.js";
import { useCompany } from "@/context/CompanyContext";
import { useInstallOperation } from "@/hooks/useInstallOperation";
import { useOperationStatus } from "@/hooks/useOperationStatus";
import { useInstallToast } from "../toast/useInstallToast";
import { queryKeys } from "@/lib/queryKeys";

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

  const queryClient = useQueryClient();
  const installMutation = useInstallOperation({ companyId: installCompanyId ?? "" });
  const { show, update } = useInstallToast();
  const [pendingOpId, setPendingOpId] = useState<string | null>(null);
  const [pendingToastId, setPendingToastId] = useState<number | null>(null);

  // Derive PluginCapability[] from the catalog item's capability objects
  const capabilities = (item.capabilities ?? [])
    .map((c) => c.id)
    .filter((id): id is PluginCapability =>
      (PLUGIN_CAPABILITIES as readonly string[]).includes(id)
    );
  const [capabilitiesAgreed, setCapabilitiesAgreed] = useState(capabilities.length === 0);

  // Reset consent whenever the user switches to a different plugin (modal stays mounted)
  useEffect(() => {
    setCapabilitiesAgreed((item.capabilities ?? []).length === 0);
  }, [item.id]);

  // Capture the timestamp when this modal instance opened.
  const openedAt = useRef<Date>(new Date());
  useEffect(() => {
    if (open) openedAt.current = new Date();
  }, [open]);

  const { data: opStatus } = useOperationStatus({
    companyId: installCompanyId,
    operationId: pendingOpId,
    startedAfter: openedAt.current,
  });

  // React to terminal status — update toast and clear tracking state
  useEffect(() => {
    if (!opStatus || pendingToastId === null || pendingToastId < 1) return;
    if (opStatus.status === "success") {
      update(pendingToastId, { status: "success", message: `Installed ${item.name}` });
      queryClient.invalidateQueries({ queryKey: queryKeys.plugins.all });
      setPendingOpId(null);
      setPendingToastId(null);
    } else if (opStatus.status === "requested") {
      update(pendingToastId, { status: "success", message: `Request submitted — a founder will review ${item.name}` });
      queryClient.invalidateQueries({ queryKey: queryKeys.plugins.all });
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
  }, [opStatus, pendingToastId, update, item.name, queryClient]);

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
      <DialogContent className="sm:max-w-lg">
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

          <CapabilityConsentStep
            pluginName={item.name}
            capabilities={capabilities}
            agreed={capabilitiesAgreed}
            onAgreedChange={setCapabilitiesAgreed}
          />

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
            disabled={installMutation.isPending || !installCompanyId || !capabilitiesAgreed}
          >
            {installMutation.isPending ? "Starting install…" : "Install"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
