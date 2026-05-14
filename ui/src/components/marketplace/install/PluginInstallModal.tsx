import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogBody,
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
import { useInstallToast } from "../toast/useInstallToast";

export interface PluginInstallModalProps {
  item: CatalogItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Modal for plugin install, instance-scoped, no company picker.
 * Shows capabilities for review.
 *
 * Flow on Install click:
 *   1. Modal closes immediately
 *   2. Toast shows install progress with spinner
 *   3. Global toast provider tracks operation status
 *   4. On terminal status, toast updates and auto-dismisses
 *
 * Plugins are instance-scoped; installing under any company URL produces an
 * identical instance-wide plugin row.
 */
export function PluginInstallModal({ item, open, onOpenChange }: PluginInstallModalProps) {
  const { selectedCompanyId, companies } = useCompany();
  const installCompanyId =
    selectedCompanyId ?? companies.find((c) => c.status !== "archived")?.id ?? null;

  const installMutation = useInstallOperation({ companyId: installCompanyId ?? "" });
  const { show, update, trackOperation } = useInstallToast();

  const capabilities = (item.capabilities ?? [])
    .map((c) => c.id)
    .filter((id): id is PluginCapability =>
      (PLUGIN_CAPABILITIES as readonly string[]).includes(id),
    );
  const [capabilitiesAgreed, setCapabilitiesAgreed] = useState(capabilities.length === 0);

  useEffect(() => {
    setCapabilitiesAgreed(capabilities.length === 0);
  }, [item.id, capabilities.length]);

  const openedAt = useRef<Date>(new Date());
  useEffect(() => {
    if (open) openedAt.current = new Date();
  }, [open]);

  const handleInstall = async () => {
    if (!installCompanyId) return;
    const toastId = show({ status: "installing", message: `Installing ${item.name}...` });
    onOpenChange(false);
    try {
      const result = await installMutation.mutateAsync({ catalogItemId: item.id });
      trackOperation({
        toastId,
        companyId: installCompanyId,
        operationId: result.operationId,
        itemName: item.name,
        requestedMessage: `Request submitted - a founder will review ${item.name}`,
        invalidate: "plugins",
        startedAfter: openedAt.current,
      });
    } catch (err) {
      update(toastId, {
        status: "failure",
        message: "Failed to start install",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Install {item.name}</DialogTitle>
          <DialogDescription>{item.description}</DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
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
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleInstall}
            disabled={installMutation.isPending || !installCompanyId || !capabilitiesAgreed}
          >
            {installMutation.isPending ? "Starting install..." : "Install"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
