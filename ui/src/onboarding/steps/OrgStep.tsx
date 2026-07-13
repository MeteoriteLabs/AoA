import { useRef, useState } from "react";
import type { StepProps } from "../registry";
import { useCompany } from "../../context/CompanyContext";
import { advanceOnboarding } from "../../api/onboarding";
import {
  clearPendingOrganization,
  readPendingOrganization,
  writePendingOrganization,
  type PendingOrganization,
} from "../pendingOrganization";
import { Button } from "@/components/ui/button";

/**
 * "Create your organization" step (Stage C / order 2). Creates the company via
 * the CompanyContext primitive — which invalidates the companies query AND sets
 * it as the selected company (the RB1 handshake: the selectedCompanyId change
 * reloads the FlowEngine from the user layer to the NEW org's layer). The
 * advance therefore targets the NEW companyId, not ctx.companyId (still null
 * here). Name only — mission/vision are captured later. `ensureProgress` already
 * seeds the org layer from the user layer, so the PROFILE_SET dependency holds.
 */
export function OrgStep({ ctx, onComplete }: StepProps) {
  const { createCompany } = useCompany();
  const [pendingAtMount] = useState(() => readPendingOrganization(ctx.userId));
  const [name, setName] = useState(pendingAtMount?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The durable recovery hint closes both retry windows: createdRef handles a
  // same-mount retry, while localStorage survives a reload/tab close between the
  // company POST and the onboarding PATCH. A selected org-layer company is also
  // safe to reuse when resuming an interrupted flow.
  const createdRef = useRef<PendingOrganization | null>(pendingAtMount);

  const submit = async () => {
    const resumableCompany =
      createdRef.current ??
      (ctx.companyId ? { id: ctx.companyId, name: name.trim() } : null);
    if (!resumableCompany && !name.trim()) {
      setError("Please enter a name for your organization.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const company = resumableCompany ?? (await createCompany({ name: name.trim() }));
      createdRef.current = company;
      writePendingOrganization(ctx.userId, company);
      await advanceOnboarding({
        companyId: company.id,
        journey: ctx.journey,
        requestedState: "ORGANIZATION_CREATED",
      });
      clearPendingOrganization(ctx.userId);
      onComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create your organization.");
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md py-10">
      <h1 className="text-xl font-semibold">Create your organization</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        This is your company's control room. You can change the name later.
      </p>
      <label className="mt-6 mb-1 block text-xs text-muted-foreground">Organization name</label>
      <input
        className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      <Button className="mt-4 w-full" onClick={() => void submit()} disabled={busy}>
        {busy ? "Creating…" : "Continue"}
      </Button>
    </div>
  );
}
