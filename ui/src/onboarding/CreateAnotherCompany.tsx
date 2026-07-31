import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { OnboardingJourney, OnboardingState } from "@armyofagents/shared";
import { healthApi } from "../api/health";
import { organizationsApi } from "../api/organizations";
import { queryKeys } from "../lib/queryKeys";
import { OrgStep } from "./steps/OrgStep";
import { CreateOrganizationStep } from "./steps/CreateOrganizationStep";
import type { StepContext } from "./registry";
import { resolveCreateCompanyOrg } from "./resolveCreateCompanyOrg";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";

const BASE_COMPLETED: OnboardingState[] = ["AUTHENTICATED", "PROFILE_SET"];

/**
 * The standalone "create another company" surface (OnboardingFlow `?new=1`).
 * Fix 2 (design P1): in cloud_auth we must hand the company step an EXPLICIT
 * create-capable Organization id — the server 403s a >=2-org founder who omits
 * it and never guesses (companies.ts:50-54). We resolve it from the founder's
 * own org memberships: exactly one create-capable org -> auto-pick; zero ->
 * mint one via CreateOrganizationStep; >=2 -> a friendly message (no picker).
 * Self-hosted preserves the prior behavior: omit the id and let the server
 * derive DEFAULT_ORGANIZATION_ID (companies.ts:56).
 */
export function CreateAnotherCompany({
  userId,
  journey,
  onCompleteCompany,
  onBack,
}: {
  userId: string;
  journey: OnboardingJourney;
  onCompleteCompany: () => void;
  onBack: () => void;
}) {
  // Set once CreateOrganizationStep mints a fresh org (the zero-org branch); it
  // then overrides the resolver and drops us into the company step under it.
  const [chosenOrgId, setChosenOrgId] = useState<string | null>(null);

  const healthQuery = useQuery({
    queryKey: queryKeys.health,
    queryFn: () => healthApi.get(),
    retry: false,
  });
  const isCloud = healthQuery.data?.deploymentMode === "cloud_auth";

  const orgsQuery = useQuery({
    queryKey: queryKeys.organizations.list,
    queryFn: () => organizationsApi.list(),
    enabled: isCloud,
    retry: false,
  });

  const buildCtx = (organizationId: string | null): StepContext => ({
    userId,
    companyId: null,
    journey,
    completedStates: BASE_COMPLETED,
    organizationId,
    setOrganizationId: (id: string) => setChosenOrgId(id),
  });

  const loading = <p className="text-sm text-dim">Loading…</p>;

  if (healthQuery.isLoading) return loading;

  // Self-hosted (or health unresolved): preserve prior behavior — omit the org
  // id (null) so the server derives DEFAULT_ORGANIZATION_ID. No org lookup here.
  if (!isCloud) {
    return <OrgStep ctx={buildCtx(null)} onComplete={onCompleteCompany} onBack={onBack} />;
  }

  // cloud_auth: reuse a just-minted org if we took the zero-org branch.
  if (chosenOrgId) {
    return <OrgStep ctx={buildCtx(chosenOrgId)} onComplete={onCompleteCompany} onBack={onBack} />;
  }

  if (orgsQuery.isLoading) return loading;
  if (!orgsQuery.data) {
    return (
      <EmptyState
        title="Couldn't load your organizations"
        description="We couldn't reach your organizations just now. Go back and try again."
        action={
          <Button variant="secondary" onClick={onBack}>
            Back to your workspace
          </Button>
        }
      />
    );
  }

  const resolution = resolveCreateCompanyOrg(orgsQuery.data);
  if (resolution.kind === "org") {
    return (
      <OrgStep
        ctx={buildCtx(resolution.organizationId)}
        onComplete={onCompleteCompany}
        onBack={onBack}
      />
    );
  }
  if (resolution.kind === "needs-org") {
    // Zero create-capable orgs: mint one; setOrganizationId re-renders into the
    // company step under it. onComplete is a no-op — the state change drives it.
    return <CreateOrganizationStep ctx={buildCtx(null)} onComplete={() => {}} onBack={onBack} />;
  }
  // resolution.kind === "ambiguous" (>=2 create-capable orgs). A picker is a
  // deferred follow-up; a friendly message is sufficient for the beta.
  return (
    <EmptyState
      title="Pick an organization first"
      description="You can create companies in more than one organization. Open the organization you want this company under, then create it from there."
      action={
        <Button variant="secondary" onClick={onBack}>
          Back to your workspace
        </Button>
      }
    />
  );
}
