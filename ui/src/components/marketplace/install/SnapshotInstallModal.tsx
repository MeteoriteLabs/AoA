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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle } from "lucide-react";
import type { CatalogItem } from "@armyofagents/shared";
import type { InstallPlan, InstallRequest } from "@/api/marketplace";
import { TrustBadge } from "../TrustBadge";
import { CompanyPicker } from "./CompanyPicker";
import { DepartmentPicker } from "./DepartmentPicker";
import { CascadeTreePreview } from "./CascadeTreePreview";
import { useCompany } from "@/context/CompanyContext";
import { useInstallOperation } from "@/hooks/useInstallOperation";
import { useResolvePlan } from "@/hooks/useResolvePlan";
import { useInstallToast } from "../toast/useInstallToast";
import { renderRuntimeRequires } from "@/lib/marketplace-constants";

type AgentRole = NonNullable<InstallRequest["role"]>;

const AGENT_ROLE_LABELS: Record<AgentRole, string> = {
  cxo: "CXO",
  lead: "Lead",
  general: "General",
};

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
  const [agentRole, setAgentRole] = useState<AgentRole | null>(null);
  const [agentAdapterType, setAgentAdapterType] = useState<string | null>(null);

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
  const isAgent = item.type === "agent";
  const shouldResolvePlan = isTeam || isAgent;
  const { data: plan } = useResolvePlan({
    companyId: shouldResolvePlan ? companyId : null,
    catalogItemId: shouldResolvePlan ? item.id : null,
  });

  useEffect(() => {
    if (!isAgent || !plan?.agentInstall) return;
    setAgentRole((current) => current ?? plan.agentInstall!.suggestedRole);
    setAgentAdapterType((current) => current ?? plan.agentInstall!.suggestedAdapterType);
  }, [isAgent, plan]);

  const needsDept = item.type === "agent" || item.type === "team";
  const canInstall =
    !!companyId &&
    (!needsDept || !!deptId) &&
    (!isAgent || (!!plan?.agentInstall && !!agentRole && !!agentAdapterType));

  const handleInstall = async () => {
    if (!canInstall || !companyId) return;
    const toastId = show({ status: "installing", message: `Installing ${item.name}...` });
    onOpenChange(false);
    try {
      const result = await installMutation.mutateAsync({
        catalogItemId: item.id,
        ...(needsDept && deptId ? { targetDepartmentId: deptId } : {}),
        ...(isAgent && agentRole ? { role: agentRole } : {}),
        ...(isAgent && agentAdapterType ? { adapterType: agentAdapterType } : {}),
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

          {isAgent && plan?.agentInstall && (
            <AgentInstallSettings
              role={agentRole}
              adapterType={agentAdapterType}
              plan={plan}
              onRoleChange={setAgentRole}
              onAdapterTypeChange={setAgentAdapterType}
            />
          )}

          {shouldResolvePlan && plan && plan.steps.length > 1 && (
            <CascadeTreePreview plan={plan} subject={item.type} />
          )}
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

function AgentInstallSettings({
  role,
  adapterType,
  plan,
  onRoleChange,
  onAdapterTypeChange,
}: {
  role: AgentRole | null;
  adapterType: string | null;
  plan: InstallPlan;
  onRoleChange: (role: AgentRole) => void;
  onAdapterTypeChange: (adapterType: string) => void;
}) {
  const agentInstall = plan.agentInstall;
  if (!agentInstall) return null;

  const availableAdapters = new Set(agentInstall.availableAdapterTypes);
  const adapterOptions = agentInstall.supportedAdapterTypes.length > 0
    ? agentInstall.supportedAdapterTypes
    : agentInstall.availableAdapterTypes;

  return (
    <div className="space-y-3 rounded-md border border-border bg-card-2 p-3">
      <div>
        <h4 className="text-sm font-medium">Agent settings</h4>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="agent-role" className="mb-1 block text-sm font-medium">
            Role
          </label>
          <Select value={role ?? agentInstall.suggestedRole} onValueChange={(next) => onRoleChange(next as AgentRole)}>
            <SelectTrigger id="agent-role">
              <SelectValue placeholder="Select role" />
            </SelectTrigger>
            <SelectContent>
              {agentInstall.supportedRoles.map((supportedRole) => (
                <SelectItem key={supportedRole} value={supportedRole}>
                  {AGENT_ROLE_LABELS[supportedRole]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label htmlFor="agent-adapter" className="mb-1 block text-sm font-medium">
            Adapter
          </label>
          <Select value={adapterType ?? agentInstall.suggestedAdapterType} onValueChange={onAdapterTypeChange}>
            <SelectTrigger id="agent-adapter">
              <SelectValue placeholder="Select adapter" />
            </SelectTrigger>
            <SelectContent>
              {adapterOptions.map((option) => (
                <SelectItem
                  key={option}
                  value={option}
                  disabled={availableAdapters.size > 0 && !availableAdapters.has(option)}
                >
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {agentInstall.setupRequired && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div className="space-y-1">
              <p className="font-medium">Setup required after install</p>
              <ul className="list-disc space-y-1 pl-4">
                {agentInstall.setupRequirements.map((requirement) => (
                  <li key={`${requirement.kind}:${requirement.key}`}>
                    <span className="font-medium">{requirement.label ?? requirement.key}</span>
                    <span> - {requirement.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {agentInstall.warnings.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {agentInstall.warnings.join(" ")}
        </div>
      )}
    </div>
  );
}
