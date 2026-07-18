import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "@/lib/router";
import { useCompany } from "@/context/CompanyContext";
import type { OnboardingJourney, OnboardingState } from "@armyofagents/shared";
import { authApi } from "../api/auth";
import { queryKeys } from "../lib/queryKeys";
import { advanceOnboarding, getOnboardingProgress, onboardingApi } from "../api/onboarding";
import { FlowEngine } from "../onboarding/FlowEngine";
import { ConstellationBg } from "../onboarding/motion";
import { ONBOARDING_STEPS } from "../onboarding/steps";
import { OrgStep } from "../onboarding/steps/OrgStep";
import { InvitedJoinTerminal } from "../onboarding/InvitedJoinTerminal";

/**
 * The onboarding route (Stage B / B7). Wires the FlowEngine with the real
 * session user, the currently-selected company (the org layer; null = the user
 * layer), and the real progress API. Steps own their own advance; the engine
 * only reads + resolves.
 */
export function OnboardingFlowPage({ journey }: { journey: OnboardingJourney }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const { selectedCompanyId } = useCompany();
  const [invitedDone, setInvitedDone] = useState(false);
  const isNewFounderOrganization =
    journey === "founder" && searchParams.get("new") === "1";
  const { data: session, isLoading } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    retry: false,
  });
  const userId = session?.user?.id;
  const profileProgressQuery = useQuery({
    queryKey: ["onboarding", "progress", "user-layer", userId],
    queryFn: async () => {
      const progress = await getOnboardingProgress(null);
      if (progress?.completedStates.includes("PROFILE_SET")) return progress;
      return advanceOnboarding({
        companyId: null,
        journey: "founder",
        requestedState: "PROFILE_SET",
      });
    },
    enabled: Boolean(userId && isNewFounderOrganization),
    retry: false,
  });

  if (isLoading || (isNewFounderOrganization && profileProgressQuery.isLoading)) {
    return (
      <div className="onboarding-dark flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-dim">Loading…</p>
      </div>
    );
  }

  if (!userId) {
    navigate("/auth", { replace: true });
    return null;
  }

  if (isNewFounderOrganization && profileProgressQuery.error) {
    return (
      <div className="onboarding-dark flex min-h-screen items-center justify-center bg-background px-6">
        <p className="text-sm text-destructive">
          {profileProgressQuery.error instanceof Error
            ? profileProgressQuery.error.message
            : "Failed to prepare organization setup"}
        </p>
      </div>
    );
  }

  // "Create another organization" (?new=1). A returning founder funnelled to
  // bare /onboarding binds to their already-complete company, so the engine
  // resolves no step and bounces them to the Lobby — a dead end. Drive the
  // org-create step DIRECTLY on the user layer (companyId=null); its RB1
  // handshake selects the new company, then we resume that company's layer via a
  // clean /onboarding (dropping ?new so it can't re-fire). Going through the
  // engine with a pinned-null companyId would instead loop: OrgStep advances on
  // the NEW company while the engine re-reads the still-empty user layer.
  if (isNewFounderOrganization) {
    const orgCtx = {
      userId,
      companyId: null,
      journey,
      completedStates: ["AUTHENTICATED", "PROFILE_SET"] as OnboardingState[],
    };
    return (
      <div className="onboarding-dark relative min-h-screen w-full overflow-hidden bg-background text-foreground">
        <ConstellationBg />
        <div className="relative z-10 flex min-h-screen items-center justify-center px-6 py-8">
          <OrgStep
            ctx={orgCtx}
            onComplete={() => navigate("/onboarding", { replace: true })}
            onBack={() => navigate("/", { replace: true })}
          />
        </div>
      </div>
    );
  }

  if (journey === "invited" && invitedDone) {
    return <InvitedJoinTerminal />;
  }

  return (
    <FlowEngine
      userId={userId}
      companyId={journey === "invited" ? null : (selectedCompanyId ?? null)}
      journey={journey}
      api={onboardingApi}
      registry={ONBOARDING_STEPS}
      onBack={() => navigate("/", { replace: true })}
      onFinished={() => {
        if (journey === "invited") {
          setInvitedDone(true);
          return;
        }
        // The index gate must resolve the post-setup membership state from the
        // server. Its cached pre-setup `founder` result would otherwise redirect
        // back into onboarding before the background refetch completes.
        queryClient.removeQueries({ queryKey: ["onboarding", "journey"], exact: true });
        navigate("/", { replace: true });
      }}
    />
  );
}
