import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useSearchParams } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { fetchJourney, finalizeInvitedJoin } from "../api/onboarding";
import { HUMAN_ROLE_LABELS } from "@/lib/human-profile-constants";
import { queryKeys } from "@/lib/queryKeys";

const POLL_MS = 7000;

type Phase = "checking" | "consent" | "pending" | "invite_invalid" | "not_approved";

/**
 * Terminal of the invited journey (spec §6). Attempts finalize on every poll
 * tick until it gets a definitive response — a verified email match admits
 * immediately (the invitation carried the approval), and a transient blip must
 * not silently downgrade an auto-admit-eligible user to founder-wait (finalize
 * is idempotent, so retrying is safe). Otherwise poll the journey until the
 * founder approves (the invitation leaves the pending set) or the request is
 * rejected / invalidated. Routing is invitation-driven, NOT journey-label
 * driven: an existing member of another company (journey "returning") with a
 * pending invitation here still gets the finalize attempt. Never navigates to
 * "/" while an invitation is still pending — that re-triggers the join loop.
 *
 * Consent gate: a tokenlessly-DETECTED invitation (`filed === false` — no
 * join_request exists; the user never clicked the invite link) is NEVER
 * auto-finalized. Clicking the link was the consent moment the detection path
 * removed, so an explicit "Join {company}" click stands in for it; only then
 * does finalize claim + file + auto-admit. Polling continues under the consent
 * card — a revoked/expired invite drops out of the pending set and the
 * not-approved/enter branches take over. This gate is defense-in-depth only:
 * the click also sets `acceptOpenInvite: true` on the finalize call, which the
 * server independently requires for the claim branch (it does not trust the
 * client not to skip this component).
 */
export function InvitedJoinTerminal() {
  const navigate = useNavigate();
  // Destructured to primitives: react-router's location object is stable per
  // navigation, but the test double for it is not (fresh object per render) —
  // depending on the whole object would re-run this effect (and repoll) on
  // every unrelated state update. Strings compare by value either way.
  const { pathname, search } = useLocation();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [phase, setPhase] = useState<Phase>("checking");
  const [company, setCompany] = useState<{ name: string; role: string } | null>(null);
  // Explicit consent for tokenless-detected invitations (filed === false).
  // State (not a ref) so flipping it re-runs the poll effect immediately —
  // the fresh tick performs the finalize the consent unlocked.
  const [consented, setConsented] = useState(false);
  const timerRef = useRef<number | null>(null);
  const finalizedRef = useRef(false);
  // The company the user actually came to join, captured on the FIRST tick that
  // resolves a target. Once the founder approves/rejects it the target leaves
  // pendingInvitations; re-deriving from the (shrinking) list would fall through
  // to a DIFFERENT pending invite and silently switch companies. Anchoring keeps
  // the page bound to the original target; its outcome is resolved in `!inv`.
  const anchoredTargetRef = useRef<string | null>(null);
  // The inviteId last processed for the anchored company. A reject→re-invite
  // cycle keeps the companyId (the anchor above) but mints a FRESH inviteId; a
  // change here means a NEW invitation surfaced for the same company and the
  // finalize/consent latch of the DEAD invite must be re-armed (see the tick).
  // Null until the first invitation resolves.
  const lastInviteIdRef = useRef<string | null>(null);

  const enter = useCallback(async () => {
    // Evict the gate's cached pre-approval journey AND refresh the companies
    // list (the root CompanyContext subscription cached an empty list from
    // before membership existed — without this, a just-admitted teammate lands
    // on the founder-oriented empty Lobby).
    queryClient.removeQueries({ queryKey: ["onboarding", "journey"], exact: true });
    await queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
    navigate("/", { replace: true });
  }, [navigate, queryClient]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const j = await fetchJourney();
        if (cancelled) return;
        // Invitation-driven: the journey label alone can't route this page —
        // "returning" means a membership exists SOMEWHERE (the resolver returns
        // it for members of any company), so an existing member with a pending
        // invitation for the target company must still get the finalize
        // attempt, not a bounce to "/". Prefer the deep-linked ?company=
        // (InviteLanding passes it) when it is one of the caller's pending
        // invitations; else the resolver's target (invited) or the first
        // pending invitation (returning).
        const deepLinked = searchParams.get("company");
        const invitations = j.pendingInvitations ?? [];
        // Derive the target from the pending list — but only to SEED the anchor
        // on the first resolving tick (see anchoredTargetRef). After that, the
        // anchor wins so an approved/rejected target that dropped out of the
        // pending set does NOT fall through to invitations[0] (a different invite).
        const derivedTargetId =
          (deepLinked && invitations.some((p) => p.companyId === deepLinked)
            ? deepLinked
            : j.journey === "invited"
              ? j.targetCompanyId
              : invitations[0]?.companyId) ?? null;
        if (anchoredTargetRef.current === null && derivedTargetId) {
          anchoredTargetRef.current = derivedTargetId;
        }
        const targetId = anchoredTargetRef.current ?? derivedTargetId;
        const inv = invitations.find((p) => p.companyId === targetId) ?? null;

        if (!inv) {
          // The anchored target is no longer pending — resolve ITS outcome, and
          // never fall through to another pending invite (the multi-invite
          // switch bug). When we already engaged finalize for this target
          // (finalizedRef), ask it: finalize is idempotent and DEFINITIVE —
          // admitted:true => approved, status "rejected" => rejected. That
          // disambiguates the "returning" label, which only means a membership
          // exists SOMEWHERE (possibly a DIFFERENT company) and so cannot tell
          // "this target approved" from "this target rejected but I'm already a
          // member elsewhere". A tokenless invite the user never consented to
          // (finalizedRef still false) must never be finalized, so it skips the
          // call and relies on the label. Finalize errors + non-definitive
          // responses fall back to the same label below.
          if (targetId && finalizedRef.current) {
            try {
              const result = await finalizeInvitedJoin(targetId);
              if (cancelled) return;
              if (result.admitted) {
                await enter();
                return;
              }
              if (result.status === "rejected") {
                setPhase("not_approved");
                return;
              }
            } catch (err) {
              if (cancelled) return;
              if ((err as { status?: number }).status === 401) {
                // Session gone — back through sign-in, preserving the deep link.
                navigate(`/auth?next=${encodeURIComponent(pathname + search)}`, {
                  replace: true,
                });
                return;
              }
              // Any other error (incl. 404 = the request/invite is gone) — fall
              // back to the journey label below.
            }
          }
          if (j.journey === "returning") {
            // Approved (the invitation left the pending set and a membership now
            // exists) — or simply an existing member with nothing pending here:
            // enter the app.
            await enter();
            return;
          }
          // founder/no-invitation: the request was rejected or the invite died.
          setPhase("not_approved");
          return;
        }

        // Re-arm finalize + consent when a DIFFERENT invitation surfaces for the
        // anchored company. The anchor (companyId) is stable across a
        // reject→re-invite, but the founder minting a fresh invite yields a new
        // inviteId; finalizedRef (and a latched `consented`) from the DEAD invite
        // would otherwise trap the new one out of BOTH the consent branch and the
        // finalize branch (each needs !finalizedRef), stranding the user on the
        // pending/not-approved screen until a reload. Compare the per-invite id
        // (inviteId, NOT companyId — same company across the re-invite); on change
        // drop finalizedRef and re-close the tokenless consent gate so the new
        // invitation flows through consent (filed:false) + finalize afresh. The
        // SAME invitation leaves both untouched, so finalizedRef still guards
        // against re-finalizing one invite in a loop. `consentedNow` applies the
        // reset THIS tick — the setConsented state write is not visible in this
        // closure — so a re-armed tokenless invite re-shows the consent card
        // (an explicit re-click), never an auto-finalize.
        const reArmed =
          lastInviteIdRef.current !== null && lastInviteIdRef.current !== inv.inviteId;
        if (reArmed) {
          finalizedRef.current = false;
          setConsented(false);
        }
        lastInviteIdRef.current = inv.inviteId;
        const consentedNow = reArmed ? false : consented;

        setCompany({ name: inv.companyName, role: inv.role });
        if (inv.filed === false && !consentedNow && !finalizedRef.current) {
          // Tokenlessly-detected open invite: joining requires an explicit
          // click — auto-finalize would admit the user into an org they never
          // agreed to join. Keep polling (revoke/expiry removes the invitation
          // and the branches above take over).
          setPhase("consent");
        } else if (!finalizedRef.current && targetId) {
          try {
            // The consent flag is the server-side assertion mirroring the
            // "Join {company}" click below — only the tokenless path
            // (filed === false) reaches this call post-consent; the filed
            // path carried consent at token-accept time and stays bare.
            const result = await (inv.filed === false
              ? finalizeInvitedJoin(targetId, { acceptOpenInvite: true })
              : finalizeInvitedJoin(targetId));
            if (cancelled) return;
            finalizedRef.current = true;
            if (result.admitted) {
              await enter();
              return;
            }
            if (result.status === "rejected") {
              setPhase("not_approved");
              return;
            }
            // invite_invalid: distinct copy (spec §9), but keep polling — the
            // founder can still approve the pending request manually.
            setPhase(result.status === "invite_invalid" ? "invite_invalid" : "pending");
          } catch (err) {
            if (cancelled) return;
            if ((err as { status?: number }).status === 401) {
              // Session gone — nothing to poll for. Back through sign-in,
              // preserving the live deep link so a successful re-auth returns
              // the user right back here.
              navigate(`/auth?next=${encodeURIComponent(pathname + search)}`, {
                replace: true,
              });
              return;
            }
            // Transient — finalizedRef stays false, so the next tick retries
            // (finalize is idempotent).
            setPhase((p) => (p === "checking" ? "pending" : p));
          }
        } else {
          setPhase((p) => (p === "invite_invalid" ? p : "pending"));
        }
      } catch (err) {
        if (cancelled) return;
        if ((err as { status?: number }).status === 401) {
          // Session gone mid-poll — nothing to poll for. Back through sign-in,
          // preserving the live deep link.
          navigate(`/auth?next=${encodeURIComponent(pathname + search)}`, {
            replace: true,
          });
          return;
        }
        setPhase((p) => (p === "checking" ? "pending" : p));
      }
      if (!cancelled) {
        timerRef.current = window.setTimeout(() => void tick(), POLL_MS);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [enter, navigate, searchParams, pathname, search, consented]);

  if (phase === "checking") {
    return <div className="mx-auto max-w-md py-16 text-sm text-muted-foreground">Checking your invitation…</div>;
  }
  if (phase === "consent") {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="text-xl font-semibold">
          You've been invited to join{company ? ` ${company.name}` : " a company"}
          {company ? ` as ${HUMAN_ROLE_LABELS[company.role] ?? company.role}` : ""}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Joining shares your profile with the team and gives you access to the company workspace.
          You'll only become a member if you choose to join.
        </p>
        <Button className="mt-6" disabled={consented} onClick={() => setConsented(true)}>
          {consented ? "Joining…" : `Join${company ? ` ${company.name}` : ""}`}
        </Button>
      </div>
    );
  }
  if (phase === "not_approved") {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="text-xl font-semibold">Request not approved</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your request to join{company ? ` ${company.name}` : ""} wasn't approved, or the invite is no
          longer valid. Ask your admin for a new invitation.
        </p>
      </div>
    );
  }
  if (phase === "invite_invalid") {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="text-xl font-semibold">
          You're joining{company ? ` ${company.name}` : ""}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your invite link is no longer valid, but your request is with the admin for approval —
          this page will let you in automatically the moment it's approved.
        </p>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-xl font-semibold">
        You're joining{company ? ` ${company.name}` : ""}
        {company ? ` as ${HUMAN_ROLE_LABELS[company.role] ?? company.role}` : ""}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Your request is with the admin for approval. This page will let you in automatically the
        moment it's approved — you can also come back later.
      </p>
      {/* The page polls every 7s — show that it is alive, not stuck. */}
      <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        Checking for approval…
      </p>
    </div>
  );
}
