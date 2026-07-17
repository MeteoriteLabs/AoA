import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import type { StepProps } from "../registry";
import { getUserProfile, saveUserProfile } from "../../api/userProfile";
import { advanceOnboarding } from "../../api/onboarding";
import { teamApi } from "../../api/team";
import { HUMAN_TITLE_OPTIONS, getTimezoneOptions } from "@/lib/human-profile-constants";
import { Button } from "@/components/ui/button";

const FIELD =
  "w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring";

/**
 * Shared Human Operating Profile step (spec §6). Journey-agnostic and wired
 * for BOTH journeys (founder + invited) — it superseded and replaced the bare
 * name-only ProfileStep. Runs on the user layer (companyId may be null):
 * writes the GLOBAL user profile only — the company record is materialized
 * later (invited: the approval transaction, spec §7; founder: lazily).
 * Name + Title + Timezone are required (spec decision 1); Bio + Social links
 * are optional.
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
        // Restore saved social links so a returning user who revisits this
        // completed step and clicks Continue does NOT overwrite them with []
        // (silent data loss). The `prev.length ? prev :` guard preserves any
        // rows the user already typed during the async load — mirroring the
        // `(v) => v || …` precedence the scalar fields above use.
        setLinks((prev) => (prev.length ? prev : (p.socialLinks ?? []).map((l) => l.url)));
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
    // Built once and shared by BOTH the global save and the company-profile
    // sync below, so the two writes can never diverge.
    const socialLinks = links
      .map((url) => url.trim())
      .filter(Boolean)
      .map((url) => ({
        type: "website" as const,
        label: null,
        // Approval-time seeding validates with z.string().url() — a
        // schemeless paste (linkedin.com/in/ada) would silently vanish
        // from the company profile. Default to https.
        url: /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`,
      }));
    const profile = {
      displayName: name.trim(),
      title,
      timezone,
      bio: bio.trim() || null,
      socialLinks,
    };
    try {
      await saveUserProfile(profile);
      // Revisit path only: the central Back navigation can return the founder
      // to this step AFTER company-create with ctx.companyId set. The company-
      // scoped profile was materialized once at company-create and is otherwise
      // never refreshed, so title/bio/timezone/social edits made on the revisit
      // would stay stale on the Team page. Sync them to the member's OWN company
      // profile. The per-member PATCH permits self-edits for any role (route
      // authz: actorUserId === userId skips the founder/admin gate), so an
      // invited (non-founder) revisit cannot 403 here. On the first pass
      // (companyId null) nothing runs — the create-time materialize handles it.
      // This is an idempotent UPSERT, so it never conflicts with that seed.
      // Surfaced (not best-effort) because the user is actively editing and a
      // failure otherwise loses their edits silently, exactly as saveUserProfile
      // failures are surfaced.
      if (ctx.companyId) {
        await teamApi.updateProfile(ctx.companyId, ctx.userId, profile);
      }
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
          <div key={i} className="mt-1 flex items-center gap-1">
            <input
              aria-label={`Social link ${i + 1}`}
              className={FIELD}
              placeholder="https://…"
              value={url}
              onChange={(e) => setLinks((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))}
            />
            <button
              type="button"
              aria-label={`Remove social link ${i + 1}`}
              className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => setLinks((prev) => prev.filter((_, j) => j !== i))}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
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
