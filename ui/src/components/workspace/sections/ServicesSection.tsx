import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Play, Square, RotateCw, Server, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { executionWorkspacesApi } from "@/api/execution-workspaces";
import type { WorkspaceRuntimeService } from "@/api/execution-workspaces";
import { queryKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import type { ExecutionWorkspace } from "@paperclipai/shared";

interface ServicesSectionProps {
  workspace: ExecutionWorkspace;
}

type ServiceAction = "start" | "stop" | "restart";

function statusDotClass(status: string): string {
  switch (status) {
    case "running":
      return "bg-green-500";
    case "starting":
      return "bg-amber-500 animate-pulse";
    case "failed":
      return "bg-destructive";
    default:
      return "bg-muted-foreground/40";
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "running":
      return "Running";
    case "starting":
      return "Starting";
    case "failed":
      return "Failed";
    case "stopped":
      return "Stopped";
    default:
      return status;
  }
}

export function ServicesSection({ workspace }: ServicesSectionProps) {
  const queryClient = useQueryClient();
  const [pendingByService, setPendingByService] = useState<Record<string, ServiceAction | null>>({});
  const [errorByService, setErrorByService] = useState<Record<string, string | null>>({});

  const { data: services, isLoading } = useQuery({
    queryKey: queryKeys.executionWorkspaces.runtimeServices(workspace.id),
    queryFn: () => executionWorkspacesApi.runtimeServices(workspace.id),
    refetchInterval: 3000,
  });

  // Clear stale errors when a service transitions to "running" (e.g., external
  // fix or successful retry by another client). Without this the error would
  // linger until the user clicks an action on the row.
  useEffect(() => {
    if (!services) return;
    setErrorByService((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const s of services) {
        if (s.status === "running" && next[s.id]) {
          delete next[s.id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [services]);

  const invalidateAfterAction = () => {
    queryClient.invalidateQueries({
      queryKey: queryKeys.executionWorkspaces.runtimeServices(workspace.id),
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.executionWorkspaces.detail(workspace.id),
    });
  };

  const controlMutation = useMutation({
    mutationFn: ({ serviceId, action }: { serviceId: string; action: ServiceAction }) =>
      executionWorkspacesApi.controlRuntimeServices(workspace.id, action, {
        runtimeServiceId: serviceId,
      }),
    onSuccess: (_data, { serviceId }) => {
      setPendingByService((prev) => ({ ...prev, [serviceId]: null }));
      invalidateAfterAction();
    },
    onError: (err, { serviceId }) => {
      setPendingByService((prev) => ({ ...prev, [serviceId]: null }));
      const message = err instanceof Error ? err.message : "Action failed";
      setErrorByService((prev) => ({ ...prev, [serviceId]: message }));
    },
  });

  const handleAction = (serviceId: string, action: ServiceAction) => {
    setPendingByService((prev) => ({ ...prev, [serviceId]: action }));
    setErrorByService((prev) => ({ ...prev, [serviceId]: null }));
    controlMutation.mutate({ serviceId, action });
  };

  if (isLoading) {
    return (
      <div className="space-y-2 px-3" data-testid="section-services-body">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (!services || services.length === 0) {
    return (
      <div data-testid="section-services-body">
        <EmptyState
          icon={Server}
          message="No services configured"
          description="Configure dev servers in workspace settings."
        />
      </div>
    );
  }

  return (
    <div className="space-y-2 px-3" data-testid="section-services-body">
      {services.map((service: WorkspaceRuntimeService) => {
        const pendingAction = pendingByService[service.id] ?? null;
        const error = errorByService[service.id] ?? null;
        const isPending = pendingAction !== null;
        const isRunning = service.status === "running";
        const isStarting = service.status === "starting";

        return (
          <div
            key={service.id}
            className="flex flex-col gap-1 rounded-md border p-2"
            data-testid={`service-row-${service.id}`}
          >
            <div className="flex items-center gap-2">
              <div
                className={cn("h-2 w-2 rounded-full shrink-0", statusDotClass(service.status))}
                aria-label={statusLabel(service.status)}
                title={statusLabel(service.status)}
              />
              <span className="text-xs font-medium text-foreground truncate flex-1 min-w-0">
                {service.serviceName}
              </span>
              {service.port !== null && (
                <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                  :{service.port}
                </span>
              )}
              <div className="flex items-center gap-1 shrink-0 ml-auto">
                {isRunning && (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => handleAction(service.id, "stop")}
                      disabled={isPending}
                      title="Stop service"
                      aria-label={`Stop ${service.serviceName}`}
                      data-testid={`service-stop-${service.id}`}
                    >
                      <Square className="h-3 w-3" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => handleAction(service.id, "restart")}
                      disabled={isPending}
                      title="Restart service"
                      aria-label={`Restart ${service.serviceName}`}
                      data-testid={`service-restart-${service.id}`}
                    >
                      <RotateCw className="h-3 w-3" />
                    </Button>
                  </>
                )}
                {isStarting && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => handleAction(service.id, "stop")}
                    disabled
                    title="Stop service (starting…)"
                    aria-label={`Stop ${service.serviceName} (starting)`}
                    data-testid={`service-stop-${service.id}`}
                  >
                    <Square className="h-3 w-3" />
                  </Button>
                )}
                {!isRunning && !isStarting && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => handleAction(service.id, "start")}
                    disabled={isPending}
                    title="Start service"
                    aria-label={`Start ${service.serviceName}`}
                    data-testid={`service-start-${service.id}`}
                  >
                    <Play className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
            {service.url && (
              <a
                href={service.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors pl-4 truncate"
                data-testid={`service-url-${service.id}`}
              >
                <ExternalLink className="h-3 w-3 shrink-0" />
                <span className="truncate font-mono">{service.url}</span>
              </a>
            )}
            {error && (
              <div
                className="text-[10px] text-destructive pl-4"
                data-testid={`service-error-${service.id}`}
              >
                {error}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
