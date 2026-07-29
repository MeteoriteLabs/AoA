import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { authApi } from "@/api/auth";
import { queryKeys } from "@/lib/queryKeys";
import { useSessionEpoch } from "@/lib/sessionEpoch";
import { LiveUpdatesProvider } from "./LiveUpdatesProvider";

/**
 * Remount the live-update transport whenever the authenticated principal or
 * explicit session epoch changes. Remounting closes the prior socket and drops
 * its callbacks before another account can render.
 */
export function IdentityScopedLiveUpdates({
  children,
}: {
  children: ReactNode;
}) {
  const sessionQuery = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    retry: false,
  });
  const epoch = useSessionEpoch();
  const identityKey = sessionQuery.isLoading
    ? "loading"
    : sessionQuery.data?.user.id ?? "local";

  return (
    <LiveUpdatesProvider key={`${identityKey}:${epoch}`}>
      {children}
    </LiveUpdatesProvider>
  );
}
