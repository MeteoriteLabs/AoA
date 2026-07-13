import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "@/lib/router";
import { authApi } from "../api/auth";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { AsciiArtAnimation } from "@/components/AsciiArtAnimation";
import { Sparkles } from "lucide-react";

function safeNextPath(candidate: string | null): string {
  if (!candidate?.startsWith("/")) return "/";
  if (candidate.startsWith("//") || candidate.includes("\\")) return "/";
  return candidate;
}

export function AuthPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const nextPath = useMemo(() => safeNextPath(searchParams.get("next")), [searchParams]);
  const { data: session, isLoading: isSessionLoading } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    retry: false,
  });

  useEffect(() => {
    if (session) {
      navigate(nextPath, { replace: true });
    }
  }, [session, navigate, nextPath]);

  // bfcache guard. Clicking "Continue with Google" sets `pending` then does a
  // full-page navigation to Google, so the browser caches this page frozen on
  // the disabled "Redirecting…" button. Pressing Back restores it FROM the
  // back-forward cache without re-mounting React, so `pending` never resets and
  // the already-signed-in redirect above never re-fires — the page looks stuck.
  // On a bfcache restore (`persisted`), force a clean reload so the session is
  // re-checked and an authenticated user is bounced onward.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  const handleGoogle = async () => {
    setError(null);
    setPending(true);
    try {
      const { url } = await authApi.signInSocial("google", nextPath);
      if (url) {
        window.location.href = url;
        return;
      }
      setError("Could not start Google sign-in. Please try again.");
      setPending(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed");
      setPending(false);
    }
  };

  if (isSessionLoading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex bg-background">
      {/* Left half — sign in */}
      <div className="w-full md:w-1/2 flex flex-col overflow-y-auto">
        <div className="w-full max-w-md mx-auto my-auto px-8 py-12">
          <div className="flex items-center gap-2 mb-8">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">AoA</span>
          </div>

          <h1 className="text-xl font-semibold">Sign in to AoA</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Run your hybrid team of agents and humans from one control room.
          </p>

          <div className="mt-6 space-y-3">
            <Button onClick={handleGoogle} disabled={pending} className="w-full">
              {pending ? "Redirecting…" : "Continue with Google"}
            </Button>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>

          <p className="mt-5 text-xs text-muted-foreground">
            Signing up and signing in both happen here — Google decides which.
          </p>
        </div>
      </div>

      {/* Right half — ASCII art animation (hidden on mobile) */}
      <div className="hidden md:block w-1/2 overflow-hidden">
        <AsciiArtAnimation />
      </div>
    </div>
  );
}
