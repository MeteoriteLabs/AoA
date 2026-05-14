import { useEffect, useState } from "react";
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
import { AlertTriangle } from "lucide-react";
import type { CatalogItem } from "@armyofagents/shared";
import { TrustBadge } from "../TrustBadge";
import { CompanyPicker } from "./CompanyPicker";
import { DepartmentPicker } from "./DepartmentPicker";
import { CascadeTreePreview } from "./CascadeTreePreview";
import { useCompany } from "@/context/CompanyContext";
import { useInstallOperation } from "@/hooks/useInstallOperation";
import { useResolvePlan } from "@/hooks/useResolvePlan";
import { useInstallToast } from "../toast/useInstallToast";
import { renderRuntimeRequires } from "@/lib/marketplace-constants";

export interface SnapshotInstallModalProps {
  item: CatalogItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Modal for snapshot installs (skill/agent/team). The global install toast
 * provider owns operation polling so the toast can resolve after route changes.
 */
export function SnapshotInstallModal({ item, open, onOpenChange }: SnapshotInstallModalProps) {
  const { selectedCompanyId, companies } = useCompany();
  const [companyId, setCompanyId] = useState<string | null>(selectedCompanyId);
  const [deptId, setDeptId] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) {
      const active = companies.filter((c) => c.status !== "archived");
      if (active.length === 1) setCompanyId(active[0].id);
    }
  }, [companyId, companies]);

  useEffect(() => {
    setDeptId(null);
  }, [companyId]);

  const installMutation = useInstallOperation({ companyId: companyId ?? "" });
  const { show, update, trackOperation } = useInstallToast();

  const isTeam = item.type === "team";
  const { data: plan } = useResolvePlan({
    companyId: isTeam ? companyId : null,
    catalogItemId: isTeam ? item.id : null,
  });

  const needsDept = item.type === "agent" || item.type === "team";
  const canInstall = !!companyId && (!needsDept || !!deptId);

  const handleInstall = async () => {
    if (!canInstall || !companyId) return;
    const toastId = show({ status: "installing", message: `Installing ${item.name}...` });
    onOpenChange(false);
    try {
      const result = await installMutation.mutateAsync({
        catalogItemId: item.id,
        ...(needsDept && deptId ? { targetDepartmentId: deptId } : {}),
      });
      trackOperation({
        toastId,
        companyId,
        operationId: result.operationId,
        itemName: item.name,
        requestedMessage: `Request submitted - a founder will review ${item.name}`,
        invalidate: item.type === "skill" ? "companySkills" : undefined,
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
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Install {item.name}</DialogTitle>
          <DialogDescription>{item.description}</DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <div className="flex items-center gap-2">
            <TrustBadge tier={item.trust.tier} />
            <Badge variant="outline" className="text-xs">v{item.version}</Badge>
            <Badge variant="secondary" className="text-xs">{item.type}</Badge>
          </div>

          {item.runtimeRequires && item.runtimeRequires.length > 0 && (
            <div
              data-testid="runtime-requires-banner"
              className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                Requires additional tooling:{" "}
                <strong>{renderRuntimeRequires(item.runtimeRequires)}</strong>.
                This skill may not work without those tools installed.
              </span>
            </div>
          )}

          <CompanyPicker value={companyId} onChange={setCompanyId} />
          {needsDept && <DepartmentPicker companyId={companyId} value={deptId} onChange={setDeptId} />}

          {isTeam && plan && plan.steps.length > 1 && <CascadeTreePreview plan={plan} />}
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleInstall} disabled={!canInstall || installMutation.isPending}>
            {installMutation.isPending ? "Starting install..." : "Install"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
