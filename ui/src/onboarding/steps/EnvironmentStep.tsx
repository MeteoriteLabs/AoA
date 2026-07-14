import { useEffect, useState } from "react";
import type { StepProps } from "../registry";
import { filesystemApi } from "../../api/filesystem";
import { api, ApiError } from "../../api/client";
import { advanceOnboarding } from "../../api/onboarding";
import { Button } from "@/components/ui/button";

type ProbeBody = {
  probe?: { summary?: string; checks?: { message?: string; status?: string }[] };
};

/** Pull the most precise reason out of a 422 (probe-blocked) response. */
function reasonFromError(err: unknown): string {
  if (err instanceof ApiError && err.status === 422) {
    const body = err.body as ProbeBody | null;
    const failed = body?.probe?.checks?.find((c) => c.status === "failed")?.message;
    return (
      body?.probe?.summary ??
      failed ??
      "Could not verify this folder. Pick another path or check permissions, then retry."
    );
  }
  return err instanceof Error
    ? err.message
    : "Could not verify this folder. Pick another path or check permissions, then retry.";
}

/**
 * "Set up your environment" step (Stage C / order 3, revA R13). Registers this
 * machine as a local environment and BLOCKS on a real read/create/delete probe
 * — a 422 keeps the founder on the step with the reason. On success it advances
 * ENVIRONMENT_READY on the org layer (the FlowEngine is read-only; steps own
 * their advance) and completes.
 */
export function EnvironmentStep({ ctx, onComplete }: StepProps) {
  const [rootFolder, setRootFolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    filesystemApi
      .home()
      .then(({ homePath }) => {
        if (cancelled) return;
        const sep = homePath.includes("\\") ? "\\" : "/";
        setRootFolder(`${homePath}${sep}AoA`);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async () => {
    if (!ctx.companyId || !rootFolder.trim()) {
      setError("Please enter a folder path.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // 422 = probe blocked → surface the reason and keep the user here.
      await api.post(`/companies/${ctx.companyId}/onboarding/environment`, {
        rootFolder: rootFolder.trim(),
      });
      await advanceOnboarding({
        companyId: ctx.companyId,
        journey: ctx.journey,
        requestedState: "ENVIRONMENT_READY",
      });
      onComplete();
    } catch (e) {
      setError(reasonFromError(e));
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md py-10">
      <h1 className="text-xl font-semibold">Set up your environment</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        AoA registers this machine and verifies it can read and write here. This is where
        department workspaces and agent files live.
      </p>
      <label className="mt-6 mb-1 block text-xs text-muted-foreground">Root folder</label>
      <input
        className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm font-mono outline-none focus:ring-1 focus:ring-ring"
        value={rootFolder}
        onChange={(e) => setRootFolder(e.target.value)}
      />
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      <Button className="mt-4 w-full" onClick={() => void submit()} disabled={busy || !rootFolder.trim()}>
        {busy ? "Verifying…" : "Verify & continue"}
      </Button>
    </div>
  );
}
