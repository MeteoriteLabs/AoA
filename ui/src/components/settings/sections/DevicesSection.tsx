import { useQuery } from "@tanstack/react-query";
import { HardDrive, Laptop, RefreshCw, Server, Cloud } from "lucide-react";
import { useCompany } from "@/context/CompanyContext";
import { desktopDevicesApi, type DesktopDevice } from "@/api/desktop-devices";
import { isForbidden } from "@/api/client";
import { queryKeys } from "@/lib/queryKeys";
import { timeAgo } from "@/lib/timeAgo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// M1.1 — a READ-ONLY device inventory. Lists the org's connected devices from the
// existing `listDesktopDevices` projection (seven allowlisted fields). There is no
// enroll / connect / rotate / revoke here: device mutation is a follow-up once the
// desktop installer path is live (DSK-00 keeps it CI-disabled). Do not add a write.
//
// Org-scoped and org-admin gated: the read is `GET /organizations/:orgId/desktop-devices`,
// mounted inside the distributed-execution flag block, so it 404s when that flag is off
// (identical handling to OperationsSection's worker list). A 403 renders the
// access-required state; any other error renders the generic failure state.

// The four `workers.status` values (workers_status_check), mapped to operator-facing
// labels — the same vocabulary OperationsSection uses for the worker column.
const STATUS_LABELS: Record<string, string> = {
  enrolled: "Enrolled",
  active: "Active",
  draining: "Draining",
  revoked: "Revoked",
};

function statusTone(status: string): string {
  switch (status) {
    case "active":
      return "border-emerald-500/35 bg-emerald-500/8 text-emerald-100";
    case "draining":
      return "border-amber-500/40 bg-amber-500/8 text-amber-200";
    case "revoked":
      return "border-red-500/40 bg-red-500/8 text-red-200";
    default:
      // enrolled + any unrecognised status
      return "border-border bg-card text-muted-foreground";
  }
}

function StatusPill({ status }: { status: string }) {
  const label = STATUS_LABELS[status] ?? status;
  return (
    <span
      className={cn(
        "shrink-0 rounded-sm border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em]",
        statusTone(status),
      )}
    >
      {label}
    </span>
  );
}

function relative(iso: string | null): string {
  if (!iso) return "never";
  try {
    return timeAgo(iso);
  } catch {
    return iso;
  }
}

function DeviceRow({ device }: { device: DesktopDevice }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <HardDrive className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{device.label}</span>
            <StatusPill status={device.status} />
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            <span className="font-mono">{device.targetSlug}</span>
            {" · "}
            gen {device.deviceGeneration}
            {" · enrolled "}
            {relative(device.enrolledAt)}
            {" · last seen "}
            {relative(device.lastSeenAt)}
          </div>
        </div>
      </div>
    </div>
  );
}

export function DevicesSection() {
  const { selectedCompanyId, selectedCompany } = useCompany();
  const organizationId = selectedCompany?.organizationId ?? null;
  const enabled = !!organizationId;

  const devicesQuery = useQuery({
    queryKey: enabled ? queryKeys.desktopDevices.list(organizationId!) : ["desktopDevices", "disabled"],
    queryFn: () => desktopDevicesApi.list(organizationId!),
    enabled,
    retry: false,
  });

  if (!selectedCompanyId) {
    return (
      <div className="p-8">
        <p className="text-sm text-muted-foreground">Select a company to view connected devices.</p>
      </div>
    );
  }

  if (!enabled) {
    // A company with no organization context resolved yet — the read is org-scoped,
    // so there is nothing to fetch. Mirror the guard OperationsSection uses.
    return (
      <div className="p-8">
        <p className="text-sm text-muted-foreground">
          This company is not linked to an organization yet, so there are no connected devices to show.
        </p>
      </div>
    );
  }

  const devices = devicesQuery.data ?? [];
  const forbidden = isForbidden(devicesQuery.error);

  return (
    <>
      {/* Section header — matches the sibling EnvironmentsSection chrome. */}
      <div className="border-b border-border px-8 pt-6 pb-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/60">
          Settings · Operations
        </div>
        <div className="mt-1 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-[1.4rem] font-bold tracking-tight">
              Connected devices<span className="text-brand">.</span>
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              The device enrolments connected to this organization for agent execution — each row is
              one enrolment, not necessarily a distinct machine. Read-only: this lists what has
              connected; it does not enroll, rename, or revoke devices.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => devicesQuery.refetch()}
            disabled={devicesQuery.isFetching}
          >
            <RefreshCw className={cn("mr-1.5 size-3.5", devicesQuery.isFetching && "animate-spin")} />
            {devicesQuery.isFetching ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </div>

      <div className="p-8">
        {/* The three login contexts a device can present. Descriptive only — the read
            exposes no context kind, so this orients the operator without claiming data. */}
        <div className="mb-6 grid gap-2 sm:grid-cols-3">
          {[
            { icon: Laptop, label: "Local desktop machine" },
            { icon: Server, label: "Installed server" },
            { icon: Cloud, label: "Cloud sandbox" },
          ].map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground"
            >
              <Icon className="size-4 shrink-0 text-muted-foreground/70" aria-hidden />
              <span className="truncate">{label}</span>
            </div>
          ))}
        </div>

        {devicesQuery.isLoading ? (
          <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            Loading connected devices…
          </div>
        ) : forbidden ? (
          <div className="rounded-md border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
            Connected devices are only visible to organization owners and admins.
          </div>
        ) : devicesQuery.isError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            Failed to load connected devices. Please refresh and try again.
          </div>
        ) : devices.length === 0 ? (
          /* Empty state */
          <div className="rounded-lg border border-border bg-card py-12 text-center">
            <HardDrive className="mx-auto mb-3 h-8 w-8 text-muted-foreground/30" aria-hidden />
            <p className="text-sm font-medium text-foreground">No devices connected yet</p>
            <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
              Devices appear here once they enrol to this organization for agent execution.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border-soft rounded-lg border border-border bg-card">
            {devices.map((device) => (
              <DeviceRow key={device.deviceId} device={device} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
