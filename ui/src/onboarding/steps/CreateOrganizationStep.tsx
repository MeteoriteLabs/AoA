import { useState } from "react";
import type { StepProps } from "../registry";
import { organizationsApi } from "../../api/organizations";
import { Button } from "@/components/ui/button";
import { Reveal } from "../motion";
import { FIELD, GradientText, LABEL, StepCard, StepHeading, StepShell } from "./shared";

/**
 * "Create your organization" step (Phase 2 Task 3/12) — the TENANT step,
 * ordered immediately before the (renamed) company step in the founder
 * sequence. Creates the Organization (the multi-tenant account that will own
 * one or more Companies + billing) and stores its id on the onboarding
 * context (`ctx.setOrganizationId`) for the following company step, which
 * forwards it into `createCompany`.
 *
 * Unlike every other spine step, this one does NOT call `advanceOnboarding` —
 * Organization membership is not modeled in the `onboarding_progress` state
 * machine (that machine is per-company; an Organization exists above the
 * company layer, see Phase 2 Task 9's org-first journey resolver). Its
 * registry `isComplete` instead reads `ctx.organizationId` directly (see
 * `steps/index.ts`). This is a known limitation: `organizationId` lives only
 * in FlowEngine's in-memory state, so a hard reload between this step and
 * company creation currently re-prompts for a new organization rather than
 * resuming — closing that gap (e.g. by consulting the caller's
 * organizationMemberships server-side) is tracked as a follow-up, not part
 * of this UI-cluster task.
 */
export function CreateOrganizationStep({ ctx, onComplete }: StepProps) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) {
      setError("Please enter a name for your organization.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const org = await organizationsApi.create({ name: name.trim() });
      ctx.setOrganizationId?.(org.id);
      onComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create your organization.");
      setBusy(false);
    }
  };

  return (
    <StepShell>
      <Reveal>
        <StepHeading
          title={
            <>
              Your <GradientText>organization</GradientText>
            </>
          }
          subtitle="Your organization is the account that owns your companies and billing. You can rename it later."
        />
      </Reveal>
      <Reveal delay={0.09}>
        <StepCard>
          <label className={LABEL} htmlFor="org-tenant-name">
            Organization name
          </label>
          <input
            id="org-tenant-name"
            className={FIELD}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        </StepCard>
      </Reveal>
      <Reveal delay={0.18}>
        <Button className="w-full" onClick={() => void submit()} disabled={busy}>
          {busy ? "Creating…" : "Continue"}
        </Button>
      </Reveal>
    </StepShell>
  );
}
