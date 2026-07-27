import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router";
import { authApi } from "@/api/auth";
import { useCompany } from "@/context/CompanyContext";
import { advanceSessionEpoch } from "@/lib/sessionEpoch";

const CHALLENGE_CANCEL_TIMEOUT_MS = 5_000;

export async function cancelChallengesWithinTimeout() {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      authApi.cancelOwnLoginChallenges(),
      new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(
          () =>
            reject(
              new Error(
                "Could not cancel active provider sign-in. Retry before switching accounts."
              )
            ),
          CHALLENGE_CANCEL_TIMEOUT_MS
        );
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export function useAccountSwitch() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { resetCompanySelection } = useCompany();
  const [isSwitching, setIsSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const switchAccount = useCallback(async () => {
    if (isSwitching) return;
    setIsSwitching(true);
    setError(null);
    // Tear down identity-scoped sockets/subscriptions before any asynchronous
    // cleanup. A late account-A event must not land while sign-out is in flight.
    advanceSessionEpoch();
    let cleanupWarning: string | null = null;
    try {
      try {
        await cancelChallengesWithinTimeout();
      } catch (cause) {
        // Challenge cleanup is bounded and best-effort. The server owns login
        // finalization, so an unavailable cleanup endpoint must never trap a user
        // in the current account.
        cleanupWarning =
          cause instanceof Error
            ? cause.message
            : "Could not cancel active provider sign-in.";
      }
      await queryClient.cancelQueries();
      await authApi.signOut();
      resetCompanySelection();
      queryClient.clear();
      navigate("/auth", { replace: true });
    } catch (cause) {
      const signOutError =
        cause instanceof Error ? cause.message : "Could not switch accounts.";
      setError(
        cleanupWarning
          ? `${signOutError} Provider sign-in cleanup also failed: ${cleanupWarning}`
          : signOutError
      );
      setIsSwitching(false);
    }
  }, [isSwitching, navigate, queryClient, resetCompanySelection]);

  return { switchAccount, isSwitching, error };
}
