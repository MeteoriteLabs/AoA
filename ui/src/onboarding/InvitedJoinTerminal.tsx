import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "@/lib/router";
import { fetchJourney, finalizeInvitedJoin } from "../api/onboarding";

const POLL_MS = 7000;

type Phase = "checking" | "pending" | "invite_invalid" | "not_approved";

/**
 * Terminal of the invited journey (spec §6). Attempts finalize on every poll
 * tick until it gets a definitive response — a verified email match admits
 * immediately (the invitation carried the approval), and a transient blip must
 * not silently downgrade an auto-admit-eligible user to founder-wait (finalize
 * is idempotent, so retrying is safe). Otherwise poll the journey until the
 * founder approves (journey→returning) or the request is rejected /
 * invalidated. Never navigates to "/" while still invited — that re-triggers
 * the join loop.
 */
export function InvitedJoinTerminal() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [phase, setPhase] = useState<Phase>("checking");
  const [company, setCompany] = useState<{ name: string; role: string } | null>(null);
  const timerRef = useRef<number | null>(null);
  const finalizedRef = useRef(false);

  const enter = useCallback(() => {
    // Evict the gate's cached pre-approval `invited` journey — otherwise the
    // index gate can bounce us straight back to /onboarding/join.
    queryClient.removeQueries({ queryKey: ["onboarding", "journey"], exact: true });
    navigate("/", { replace: true });
  }, [navigate, queryClient]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const j = await fetchJourney();
        if (cancelled) return;
        if (j.journey === "returning") {
          enter();
          return;
        }
        if (j.journey !== "invited") {
          // No membership and no pending invitation left → rejected/expired.
          setPhase("not_approved");
          return;
        }
        // Prefer the deep-linked ?company= (InviteLanding passes it) when it is
        // one of the caller's pending invitations; else the resolver's target.
        const deepLinked = searchParams.get("company");
        const targetId =
          (deepLinked && j.pendingInvitations.some((p) => p.companyId === deepLinked)
            ? deepLinked
            : j.targetCompanyId) ?? null;
        const inv =
          j.pendingInvitations.find((p) => p.companyId === targetId) ??
          j.pendingInvitations[0] ??
          null;
        if (inv) setCompany({ name: inv.companyName, role: inv.role });
        if (!finalizedRef.current && targetId) {
          try {
            const result = await finalizeInvitedJoin(targetId);
            if (cancelled) return;
            finalizedRef.current = true;
            if (result.admitted) {
              enter();
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
              // Session gone — nothing to poll for. Back through sign-in.
              navigate("/auth?next=%2Fonboarding%2Fjoin", { replace: true });
              return;
            }
            // Transient — finalizedRef stays false, so the next tick retries
            // (finalize is idempotent).
            setPhase((p) => (p === "checking" ? "pending" : p));
          }
        } else {
          setPhase((p) => (p === "invite_invalid" ? p : "pending"));
        }
      } catch {
        if (!cancelled) setPhase((p) => (p === "checking" ? "pending" : p));
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
  }, [enter, navigate, searchParams]);

  if (phase === "checking") {
    return <div className="mx-auto max-w-md py-16 text-sm text-muted-foreground">Checking your invitation…</div>;
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
        {company ? ` as ${company.role}` : ""}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Your request is with the admin for approval. This page will let you in automatically the
        moment it's approved — you can also come back later.
      </p>
    </div>
  );
}
