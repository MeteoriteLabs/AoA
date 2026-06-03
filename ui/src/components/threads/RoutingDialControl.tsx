import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { INBOUND_ROUTING_LEVELS } from "@armyofagents/shared";
import { internalAgentApi } from "../../api/internal-agent";

interface RoutingDialControlProps {
  companyId: string;
  canEdit?: boolean;
}

export function RoutingDialControl({ companyId, canEdit = true }: RoutingDialControlProps) {
  const queryClient = useQueryClient();
  const queryKey = ["internal-agent-config", companyId];

  const { data: config } = useQuery({
    queryKey,
    queryFn: () => internalAgentApi.getConfig(companyId),
    enabled: !!companyId,
    retry: false,
  });

  const mutation = useMutation({
    mutationFn: (level: string) =>
      internalAgentApi.updateConfig(companyId, { inboundRoutingLevel: level }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  const currentLevel = config?.inboundRoutingLevel ?? "off";
  const currentEntry = INBOUND_ROUTING_LEVELS.find((l) => l.value === currentLevel);
  const blurb = currentEntry?.blurb ?? "";

  return (
    <div className="flex items-center gap-2">
      <label
        htmlFor="routing-dial-select"
        className="text-xs font-medium text-muted-foreground whitespace-nowrap"
      >
        Auto-routing
      </label>
      <select
        id="routing-dial-select"
        data-testid="routing-dial"
        title={blurb}
        value={currentLevel}
        disabled={!canEdit || mutation.isPending}
        onChange={(e) => {
          if (e.target.value !== currentLevel) {
            mutation.mutate(e.target.value);
          }
        }}
        className="h-7 rounded-md border border-input bg-background px-2 py-0.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        {INBOUND_ROUTING_LEVELS.map((level) => (
          <option key={level.value} value={level.value}>
            {level.name}
          </option>
        ))}
      </select>
      {mutation.isError && (
        <span className="text-xs text-destructive">Failed to save</span>
      )}
    </div>
  );
}
