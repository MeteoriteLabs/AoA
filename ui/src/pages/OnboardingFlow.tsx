import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router";
import { useCompany } from "@/context/CompanyContext";
import type { OnboardingJourney } from "@armyofagents/shared";
import { authApi } from "../api/auth";
import { queryKeys } from "../lib/queryKeys";
import { onboardingApi } from "../api/onboarding";
import { FlowEngine } from "../onboarding/FlowEngine";

/**
 * The onboarding route (Stage B / B7). Wires the FlowEngine with the real
 * session user, the currently-selected company (the org layer; null = the user
 * layer), and the real progress API. The registry is filled by Stage C — until
 * then the founder flow resolves to "complete".
 */
export function OnboardingFlowPage({ journey }: { journey: OnboardingJourney }) {
  const navigate = useNavigate();
  const { selectedCompanyId } = useCompany();
  const { data: session, isLoading } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    retry: false,
  });

  if (isLoading) {
    return <div className="mx-auto max-w-xl py-10 text-sm text-muted-foreground">Loading…</div>;
  }

  const userId = session?.user?.id;
  if (!userId) {
    navigate("/auth", { replace: true });
    return null;
  }

  return (
    <FlowEngine
      userId={userId}
      companyId={selectedCompanyId ?? null}
      journey={journey}
      api={onboardingApi}
      onFinished={() => navigate("/", { replace: true })}
    />
  );
}
