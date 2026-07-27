import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, LogOut } from "lucide-react";
import { authApi } from "@/api/auth";
import { fetchJourney } from "@/api/onboarding";
import { Button } from "@/components/ui/button";
import { useAccountSwitch } from "@/hooks/useAccountSwitch";
import { queryKeys } from "@/lib/queryKeys";

export function AccessRequiredPage() {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const sessionQuery = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    retry: false,
  });
  const identityKey = sessionQuery.data?.user.id ?? "local";
  const journeyQuery = useQuery({
    queryKey: queryKeys.onboarding.journeyForIdentity(identityKey),
    queryFn: () => fetchJourney(),
    enabled: !sessionQuery.isLoading,
    retry: false,
  });
  const { switchAccount, isSwitching, error: switchError } = useAccountSwitch();

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <main className="min-h-[100dvh] overflow-y-auto bg-[#09090b] px-5 py-10 text-zinc-100 [color-scheme:dark]">
      <section
        className="mx-auto flex min-h-[calc(100dvh-5rem)] w-full max-w-lg flex-col justify-center"
        aria-labelledby="access-required-title"
      >
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/90 p-6 shadow-2xl sm:p-8">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-red-400">
            AOA
          </div>
          <h1
            ref={headingRef}
            id="access-required-title"
            tabIndex={-1}
            className="mt-3 text-2xl font-semibold focus:outline-none"
          >
            Access required
          </h1>
          <p className="mt-3 text-sm leading-6 text-zinc-400">
            This AOA instance is invitation-only. Ask an instance administrator
            to invite your verified account to the company.
          </p>
          {sessionQuery.data?.user.email ? (
            <p className="mt-4 break-all rounded-lg bg-zinc-900 px-3 py-2 text-sm text-zinc-300">
              Signed in as {sessionQuery.data.user.email}
            </p>
          ) : null}

          {journeyQuery.error ? (
            <p className="mt-4 text-sm text-red-300" role="alert">
              Access could not be refreshed. Check the connection and try again.
            </p>
          ) : null}
          {switchError ? (
            <p className="mt-4 text-sm text-red-300" role="alert">
              {switchError}
            </p>
          ) : null}
          <p className="sr-only" role="status" aria-live="polite">
            {journeyQuery.isFetching
              ? "Checking access"
              : "Access check complete"}
          </p>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              className="border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
              disabled={journeyQuery.isFetching || isSwitching}
              onClick={() => void journeyQuery.refetch()}
            >
              <RefreshCw
                className={journeyQuery.isFetching ? "animate-spin" : ""}
              />
              {journeyQuery.isFetching
                ? "Checking access..."
                : "Refresh access"}
            </Button>
            <Button
              type="button"
              disabled={isSwitching}
              onClick={() => void switchAccount()}
            >
              <LogOut />
              {isSwitching ? "Switching..." : "Sign out and switch account"}
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
}
