import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "@/lib/router";
import { useCompany } from "@/context/CompanyContext";
import type { OnboardingJourney, OnboardingState } from "@armyofagents/shared";
import { authApi } from "../api/auth";
import { queryKeys } from "../lib/queryKeys";
import { onboardingApi } from "../api/onboarding";
import { FlowEngine } from "../onboarding/FlowEngine";
import { ONBOARDING_STEPS } from "../onboarding/steps";
import { OrgStep } from "../onboarding/steps/OrgStep";

/**
 * Terminal state for the invited journey. The real JoinOrg step (request +
 * approval handshake) is deferred; until it lands, an invited user who reaches
 * the end of the built steps sees this instead of being navigated to "/" — which
 * the index gate would re-resolve as `invited` and route straight back here,
 * an infinite loop.
 */
function InvitedPendingPage() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-xl font-semibold">Request sent</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Your request to join is awaiting approval from an admin. We'll let you in as soon as it's
        approved — you can close this tab and check back later.
      </p>
    </div>
  );
}

/**
 * The onboarding route (Stage B / B7). Wires the FlowEngine with the real
 * session user, the currently-selected company (the org layer; null = the user
 * layer), and the real progress API. Steps own their own advance; the engine
 * only reads + resolves.
 */
export function OnboardingFlowPage({ journey }: { journey: OnboardingJourney }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { selectedCompanyId } = useCompany();
  const [invitedDone, setInvitedDone] = useState(false);
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

  // "Create another organization" (?new=1). A returning founder funnelled to
  // bare /onboarding binds to their already-complete company, so the engine
  // resolves no step and bounces them to the Lobby — a dead end. Drive the
  // org-create step DIRECTLY on the user layer (companyId=null); its RB1
  // handshake selects the new company, then we resume that company's layer via a
  // clean /onboarding (dropping ?new so it can't re-fire). Going through the
  // engine with a pinned-null companyId would instead loop: OrgStep advances on
  // the NEW company while the engine re-reads the still-empty user layer.
  if (journey === "founder" && searchParams.get("new") === "1") {
    const orgCtx = {
      userId,
      companyId: null,
      journey,
      completedStates: ["AUTHENTICATED", "PROFILE_SET"] as OnboardingState[],
    };
    return (
      <OrgStep
        ctx={orgCtx}
        onComplete={() => navigate("/onboarding", { replace: true })}
        onBack={() => navigate("/", { replace: true })}
      />
    );
  }

  if (journey === "invited" && invitedDone) {
    return <InvitedPendingPage />;
  }

  return (
    <FlowEngine
      userId={userId}
      companyId={journey === "invited" ? null : (selectedCompanyId ?? null)}
      journey={journey}
      api={onboardingApi}
      registry={ONBOARDING_STEPS}
      onBack={() => navigate("/", { replace: true })}
      onFinished={() =>
        journey === "invited" ? setInvitedDone(true) : navigate("/", { replace: true })
      }
    />
  );
}
