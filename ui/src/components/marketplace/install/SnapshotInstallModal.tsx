import { useState, useEffect } from "react";
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
import { CompanyPicker } from "./CompanyPicker";
import { DepartmentPicker } from "./DepartmentPicker";
import { CascadeTreePreview } from "./CascadeTreePreview";
import { useCompany } from "@/context/CompanyContext";
import { useInstallOperation } from "@/hooks/useInstallOperation";
import { useOperationStatus } from "@/hooks/useOperationStatus";
import { useResolvePlan } from "@/hooks/useResolvePlan";
import { useInstallToast } from "../toast/useInstallToast";

export interface SnapshotInstallModalProps {
  item: CatalogItem; // type='skill' | 'agent' | 'team'
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Modal for snapshot installs (skill/agent/team) — requires company + dept picker.
 * For team type, additionally fetches + renders the cascade tree preview.
 */
export function SnapshotInstallModal({ item, open, onOpenChange }: SnapshotInstallModalProps) {
  const { selectedCompanyId, companies } = useCompany();
  const [companyId, setCompanyId] = useState<string | null>(selectedCompanyId);
  const [deptId, setDeptId] = useState<string | null>(null);
  const [pendingOpId, setPendingOpId] = useState<string | null>(null);
  const [pendingToastId, setPendingToastId] = useState<number | null>(null);

  // Auto-pick when only 1 active company exists
  useEffect(() => {
    if (!companyId) {
      const active = companies.filter((c) => c.status !== "archived");
      if (active.length === 1) setCompanyId(active[0].id);
    }
  }, [companyId, companies]);

  // Reset dept when company changes
  useEffect(() => {
    setDeptId(null);
  }, [companyId]);

  const installMutation = useInstallOperation({ companyId: companyId ?? "" });
  const { show, update } = useInstallToast();

  // For team: fetch resolve plan to show cascade
  const isTeam = item.type === "team";
  const { data: plan } = useResolvePlan({
    companyId: isTeam ? companyId : null,
    catalogItemId: isTeam ? item.id : null,
  });

  const { data: opStatus } = useOperationStatus({
    companyId,
    operationId: pendingOpId,
  });

  useEffect(() => {
    if (!opStatus || pendingToastId === null) return;
    if (opStatus.status === "success") {
      update(pendingToastId, { status: "success", message: `Installed ${item.name}` });
      setPendingOpId(null);
      setPendingToastId(null);
    } else if (opStatus.status === "requested") {
      update(pendingToastId, { status: "success", message: `Request submitted — a founder will review ${item.name}` });
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

  // Skills don't require a department — only agent/team installs do.
  const needsDept = item.type === "agent" || item.type === "team";
  const canInstall = !!companyId && (!needsDept || !!deptId);

  const handleInstall = async () => {
    if (!canInstall || !companyId) return;
    const toastId = show({ status: "installing", message: `Installing ${item.name}…` });
    setPendingToastId(toastId);
    onOpenChange(false);
    try {
      const result = await installMutation.mutateAsync({
        catalogItemId: item.id,
        ...(needsDept && deptId ? { targetDepartmentId: deptId } : {}),
      });
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
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Install {item.name}</DialogTitle>
          <DialogDescription>{item.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <TrustBadge tier={item.trust.tier} />
            <Badge variant="outline" className="text-xs">v{item.version}</Badge>
            <Badge variant="secondary" className="text-xs">{item.type}</Badge>
          </div>

          <CompanyPicker value={companyId} onChange={setCompanyId} />
          {needsDept && <DepartmentPicker companyId={companyId} value={deptId} onChange={setDeptId} />}

          {isTeam && plan && plan.steps.length > 1 && <CascadeTreePreview plan={plan} />}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleInstall} disabled={!canInstall || installMutation.isPending}>
            {installMutation.isPending ? "Starting install…" : "Install"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
