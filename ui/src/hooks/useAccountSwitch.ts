import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router";
import { authApi } from "@/api/auth";
import { useCompany } from "@/context/CompanyContext";

const CHALLENGE_CANCEL_TIMEOUT_MS = 5_000;

async function cancelChallengesWithinTimeout() {
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
    try {
      await cancelChallengesWithinTimeout();
      await queryClient.cancelQueries();
      await authApi.signOut();
      resetCompanySelection();
      queryClient.clear();
      navigate("/auth", { replace: true });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not switch accounts."
      );
      setIsSwitching(false);
    }
  }, [isSwitching, navigate, queryClient, resetCompanySelection]);

  return { switchAccount, isSwitching, error };
}
