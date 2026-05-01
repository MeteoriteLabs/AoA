import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { marketplaceApi, type InstallOperation } from "@/api/marketplace";

const POLL_INTERVAL_MS = 2000;

export interface UseOperationStatusOpts {
  companyId: string | null;
  operationId: string | null;
}

/**
 * Poll an install operation's status until terminal (success/failure).
 * Refetches every 2s while pending/running. Stops via refetchInterval=false on terminal.
 */
export function useOperationStatus(
  opts: UseOperationStatusOpts,
): UseQueryResult<InstallOperation, Error> {
  const { companyId, operationId } = opts;
  return useQuery({
    queryKey: ["marketplace", "operation", companyId, operationId] as const,
    queryFn: () => marketplaceApi.getOperation(companyId!, operationId!),
    enabled: !!companyId && !!operationId,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return POLL_INTERVAL_MS;
      if (data.status === "success" || data.status === "failure") return false;
      return POLL_INTERVAL_MS;
    },
  });
}
