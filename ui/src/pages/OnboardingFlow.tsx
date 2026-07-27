import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "@/lib/router";
import { useCompany } from "@/context/CompanyContext";
import type { OnboardingJourney, OnboardingState } from "@armyofagents/shared";
import { authApi } from "../api/auth";
import { queryKeys } from "../lib/queryKeys";
import {
  advanceOnboarding,
  getOnboardingProgress,
  onboardingApi,
} from "../api/onboarding";
import { DarkShell, FlowEngine } from "../onboarding/FlowEngine";
import { ONBOARDING_STEPS } from "../onboarding/steps";
import { OrgStep } from "../onboarding/steps/OrgStep";
import { InvitedJoinTerminal } from "../onboarding/InvitedJoinTerminal";
import { FirstRunHome } from "../onboarding/FirstRunHome";
import { Button } from "../components/ui/button";
import { LogOut } from "lucide-react";
import { useAccountSwitch } from "../hooks/useAccountSwitch";

function AccountSwitchControl({
  onSwitch,
  isSwitching,
  error,
}: {
  onSwitch: () => void;
  isSwitching: boolean;
  error: string | null;
}) {
  return (
    <div className="fixed right-4 top-4 z-50 flex flex-col items-end gap-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="gap-1.5 text-dim hover:bg-white/5 hover:text-text"
        disabled={isSwitching}
        onClick={onSwitch}
      >
        <LogOut className="h-3.5 w-3.5" aria-hidden />
        {isSwitching ? "Signing out…" : "Switch account"}
      </Button>
      {error && (
        <p
          className="max-w-xs text-right text-xs text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The onboarding route (Stage B / B7). Wires the FlowEngine with the real
 * session user, the currently-selected company (the org layer; null = the user
 * layer), and the real progress API. Steps own their own advance; the engine
 * only reads + resolves.
 */
export function OnboardingFlowPage({
  journey,
}: {
  journey: OnboardingJourney;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const { selectedCompanyId } = useCompany();
  const accountSwitch = useAccountSwitch();
  const [invitedDone, setInvitedDone] = useState(false);
  // Founder: after the spine finishes, the persona fork + in-flight tail run
  // INLINE here (same dark flow) rather than on the dashboard — onboarding never
  // bleeds into the company pages. `spineDone` also covers resume: a returning
  // founder whose spine is already complete makes FlowEngine resolve no step and
  // fire onFinished immediately, dropping straight into the tail.
  const [spineDone, setSpineDone] = useState(false);
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

  if (
    isLoading ||
    (isNewFounderOrganization && profileProgressQuery.isLoading)
  ) {
    return (
      <div className="onboarding-dark flex min-h-screen items-center justify-center bg-background">
        <AccountSwitchControl
          onSwitch={() => void accountSwitch.switchAccount()}
          isSwitching={accountSwitch.isSwitching}
          error={accountSwitch.error}
        />
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
        <AccountSwitchControl
          onSwitch={() => void accountSwitch.switchAccount()}
          isSwitching={accountSwitch.isSwitching}
          error={accountSwitch.error}
        />
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
      <DarkShell>
        <AccountSwitchControl
          onSwitch={() => void accountSwitch.switchAccount()}
          isSwitching={accountSwitch.isSwitching}
          error={accountSwitch.error}
        />
        <div className="relative z-10 flex min-h-screen items-center justify-center px-6 py-8">
          <OrgStep
            ctx={orgCtx}
            onComplete={() => navigate("/onboarding", { replace: true })}
            onBack={() => navigate("/", { replace: true })}
          />
        </div>
      </DarkShell>
    );
  }

  if (journey === "invited" && invitedDone) {
    return (
      <>
        <AccountSwitchControl
          onSwitch={() => void accountSwitch.switchAccount()}
          isSwitching={accountSwitch.isSwitching}
          error={accountSwitch.error}
        />
        <InvitedJoinTerminal />
      </>
    );
  }

  // Founder tail: the spine is done — run the persona fork + in-flight tail
  // (departments → integrations → braindump → Librarian → agents → first job)
  // in the SAME dark flow. FirstRunHome writes firstRunCompleted at the end; on
  // completion we hand off to the Lobby (the returning-user home base). Guard on
  // selectedCompanyId — the org-create step selects it, and on resume the index
  // gate selects it before routing here; a brief null is just a loading frame.
  if (journey === "founder" && spineDone) {
    if (!selectedCompanyId) {
      return (
        <DarkShell>
          <AccountSwitchControl
            onSwitch={() => void accountSwitch.switchAccount()}
            isSwitching={accountSwitch.isSwitching}
            error={accountSwitch.error}
          />
          <div className="relative z-10 flex min-h-screen items-center justify-center px-6">
            <p className="text-sm text-dim">Loading…</p>
          </div>
        </DarkShell>
      );
    }
    return (
      <>
        <AccountSwitchControl
          onSwitch={() => void accountSwitch.switchAccount()}
          isSwitching={accountSwitch.isSwitching}
          error={accountSwitch.error}
        />
        <FirstRunHome
          companyId={selectedCompanyId}
          onComplete={() => {
            // Re-resolve the journey (now firstRunCompleted) so the index gate
            // doesn't bounce us back into onboarding, then hand off to the Lobby.
            queryClient.removeQueries({
              queryKey: queryKeys.onboarding.journey,
            });
            navigate("/", { replace: true });
          }}
        />
      </>
    );
  }

  return (
    <FlowEngine
      userId={userId}
      companyId={journey === "invited" ? null : selectedCompanyId ?? null}
      journey={journey}
      api={onboardingApi}
      registry={ONBOARDING_STEPS}
      onBack={() => navigate("/", { replace: true })}
      onSwitchAccount={() => void accountSwitch.switchAccount()}
      isSwitchingAccount={accountSwitch.isSwitching}
      switchAccountError={accountSwitch.error}
      onFinished={() => {
        if (journey === "invited") {
          setInvitedDone(true);
          return;
        }
        // Founder spine complete → hand off to the INLINE tail above (persona +
        // in-flight), NOT the dashboard. The tail owns the firstRunCompleted
        // write and the final navigation to the Lobby.
        setSpineDone(true);
      }}
    />
  );
}
