import { useState } from "react";
import type { StepProps } from "../registry";
import { saveUserProfile } from "../../api/userProfile";
import { advanceOnboarding } from "../../api/onboarding";
import { Button } from "@/components/ui/button";

/**
 * "Your profile" step (Stage C / C3). Writes the global user_profiles record,
 * then advances PROFILE_SET on the user layer (companyId is null here) and
 * calls onComplete so the engine re-reads and moves on. Name required; the rest
 * (avatar, social links, title) is optional and deferrable.
 */
export function ProfileStep({ ctx, onComplete }: StepProps) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) {
      setError("Please enter your name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveUserProfile({ displayName: name.trim() });
      await advanceOnboarding({ companyId: ctx.companyId, journey: ctx.journey, requestedState: "PROFILE_SET" });
      onComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save your profile.");
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md py-10">
      <h1 className="text-xl font-semibold">Your profile</h1>
      <p className="mt-1 text-sm text-muted-foreground">Tell your team who you are.</p>
      <label className="mt-6 mb-1 block text-xs text-muted-foreground">Name</label>
      <input
        className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      <Button className="mt-4 w-full" onClick={() => void submit()} disabled={busy}>
        {busy ? "Saving…" : "Continue"}
      </Button>
    </div>
  );
}
