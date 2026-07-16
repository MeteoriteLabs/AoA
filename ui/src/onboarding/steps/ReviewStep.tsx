import { useEffect, useState } from "react";
import type { StepProps } from "../registry";
import { companiesApi } from "../../api/companies";
import { projectsApi } from "../../api/projects";
import { agentsApi } from "../../api/agents";
import { advanceOnboarding } from "../../api/onboarding";
import { Button } from "@/components/ui/button";

type Summary = { org?: string; dept?: string; agent?: string };

function Row({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value ?? "—"}</span>
    </div>
  );
}

/**
 * "You're set up" review step (Stage C / order 8). Summarizes what onboarding
 * created, then finishes: "Finish setup" advances SETUP_COMPLETE and calls
 * onComplete — the FlowEngine resolves no next step and onFinished lands the
 * founder in the Lobby (the hub "/"), so the CTA is honest about finishing
 * setup rather than promising a dashboard.
 */
export function ReviewStep({ ctx, onComplete }: StepProps) {
  const [summary, setSummary] = useState<Summary>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ctx.companyId) return;
    const cid = ctx.companyId;
    void (async () => {
      const [c, projects, agents] = await Promise.all([
        companiesApi.get(cid).catch(() => null),
        projectsApi.list(cid).catch(() => []),
        agentsApi.list(cid).catch(() => []),
      ]);
      setSummary({
        org: (c as { name?: string } | null)?.name,
        dept: (projects as { type?: string; name?: string }[]).find((p) => p.type === "department")?.name,
        agent: (agents as { kind?: string; name?: string }[]).find((a) => a.kind === "org")?.name,
      });
    })();
  }, [ctx.companyId]);

  const finish = async () => {
    if (!ctx.companyId) return;
    setBusy(true);
    setError(null);
    try {
      await advanceOnboarding({
        companyId: ctx.companyId,
        journey: ctx.journey,
        requestedState: "SETUP_COMPLETE",
      });
      onComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't finish setup. Please try again.");
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md py-10">
      <h1 className="text-xl font-semibold">You're set up</h1>
      <p className="mt-1 text-sm text-muted-foreground">Review your workspace, then dive in.</p>
      <div
        data-testid="review-summary"
        className="mt-6 divide-y divide-border rounded-md border border-border text-sm"
      >
        <Row label="Organization" value={summary.org} />
        <Row label="Environment" value="Local machine — verified" />
        <Row label="Commander" value="Configured & verified" />
        <Row label="Department" value={summary.dept} />
        <Row
          label="Agent"
          value={summary.agent ? `${summary.agent} → ${summary.dept ?? "department"}` : undefined}
        />
      </div>
      {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
      <Button className="mt-4 w-full" onClick={() => void finish()} disabled={busy}>
        Finish setup
      </Button>
    </div>
  );
}
