import { useEffect, useMemo, useState } from "react";
import type { StepProps } from "../registry";
import { getUserProfile, saveUserProfile } from "../../api/userProfile";
import { advanceOnboarding } from "../../api/onboarding";
import { HUMAN_TITLE_OPTIONS, getTimezoneOptions } from "@/lib/human-profile-constants";
import { Button } from "@/components/ui/button";

const FIELD =
  "w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring";

/**
 * Shared Human Operating Profile step (spec §6). Journey-agnostic; wired for
 * the INVITED journey now (supersedes the bare ProfileStep there — founder
 * wiring is a later follow-up). Writes the GLOBAL user profile — the company
 * record is materialized by the approval transaction (spec §7). Name + Title +
 * Timezone are required (spec decision 1); Bio + Social links are optional.
 */
export function HumanProfileStep({ ctx, onComplete }: StepProps) {
  const timezoneOptions = useMemo(() => getTimezoneOptions(), []);
  const detected = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
    } catch {
      return "";
    }
  }, []);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [timezone, setTimezone] = useState("");
  const [bio, setBio] = useState("");
  const [links, setLinks] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefill from the existing global profile — Name arrives from Google via the
  // auth-synced profile (spec §5: "Name is prefilled"); a returning user
  // resumes their saved values. Precedence: typed value > saved profile value >
  // browser-detected (timezone only). User-typed values are never overwritten.
  useEffect(() => {
    let cancelled = false;
    void getUserProfile()
      .then((p) => {
        if (cancelled) return;
        if (!p) {
          setTimezone((v) => v || detected);
          return;
        }
        setName((v) => v || p.displayName || "");
        setTitle((v) => v || p.title || "");
        setBio((v) => v || p.bio || "");
        setTimezone((v) => v || p.timezone || detected);
      })
      .catch(() => {
        if (!cancelled) setTimezone((v) => v || detected);
      });
    return () => {
      cancelled = true;
    };
  }, [detected]);

  const canSubmit = Boolean(name.trim() && title && timezone) && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await saveUserProfile({
        displayName: name.trim(),
        title,
        timezone,
        bio: bio.trim() || null,
        socialLinks: links
          .map((url) => url.trim())
          .filter(Boolean)
          .map((url) => ({ type: "website", label: null, url })),
      });
      await advanceOnboarding({
        companyId: ctx.companyId,
        journey: ctx.journey,
        requestedState: "PROFILE_SET",
      });
      onComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save your profile.");
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md py-10">
      <h1 className="text-xl font-semibold">Set up your profile</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        This is how your team — and its agents — will know you.
      </p>

      <label className="mt-6 mb-1 block text-xs text-muted-foreground" htmlFor="hp-name">
        Name
      </label>
      <input id="hp-name" aria-label="Name" className={FIELD} value={name} onChange={(e) => setName(e.target.value)} autoFocus />

      <label className="mt-3 mb-1 block text-xs text-muted-foreground" htmlFor="hp-title">
        Title
      </label>
      <select id="hp-title" aria-label="Title" className={FIELD} value={title} onChange={(e) => setTitle(e.target.value)}>
        <option value="">Select a title…</option>
        {HUMAN_TITLE_OPTIONS.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>

      <label className="mt-3 mb-1 block text-xs text-muted-foreground" htmlFor="hp-tz">
        Timezone
      </label>
      <select id="hp-tz" aria-label="Timezone" className={FIELD} value={timezone} onChange={(e) => setTimezone(e.target.value)}>
        <option value="">Select a timezone…</option>
        {timezoneOptions.map((tz) => (
          <option key={tz} value={tz}>
            {tz}
          </option>
        ))}
      </select>

      <label className="mt-3 mb-1 block text-xs text-muted-foreground" htmlFor="hp-bio">
        Short bio (optional)
      </label>
      <textarea id="hp-bio" aria-label="Short bio (optional)" className={FIELD} rows={2} value={bio} onChange={(e) => setBio(e.target.value)} />

      <div className="mt-3">
        <span className="mb-1 block text-xs text-muted-foreground">Social links (optional)</span>
        {links.map((url, i) => (
          <input
            key={i}
            aria-label={`Social link ${i + 1}`}
            className={`${FIELD} mt-1`}
            placeholder="https://…"
            value={url}
            onChange={(e) => setLinks((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))}
          />
        ))}
        <button
          type="button"
          className="mt-1 text-xs text-muted-foreground underline"
          onClick={() => setLinks((prev) => [...prev, ""])}
        >
          + Add link
        </button>
      </div>

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      <Button className="mt-4 w-full" onClick={() => void submit()} disabled={!canSubmit}>
        {busy ? "Saving…" : "Continue"}
      </Button>
    </div>
  );
}
