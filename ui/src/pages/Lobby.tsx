import { useState, type CSSProperties } from "react";
import { useNavigate } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { Menu } from "lucide-react";
import { useCompany } from "@/context/CompanyContext";
import { useDialog } from "@/context/DialogContext";
import { profileApi } from "@/api/profile";
import { companiesApi, type CompanyStats } from "@/api/companies";
import { queryKeys } from "@/lib/queryKeys";
import { LobbyCompanyCard } from "@/components/LobbyCompanyCard";
import { LobbyEmptyState } from "@/components/LobbyEmptyState";
import { LobbySidebar } from "@/components/LobbySidebar";
import { Sheet, SheetContent } from "@/components/ui/sheet";

function deriveFirstName(displayName: string | undefined, email: string | undefined): string {
  if (displayName?.trim()) {
    const first = displayName.trim().split(/\s+/)[0];
    if (first) return first;
  }
  if (email) {
    const local = email.split("@")[0] ?? "";
    return local.split(".")[0] ?? local;
  }
  return "there";
}

export function Lobby() {
  const { companies, loading: companiesLoading } = useCompany();
  const { openOnboarding } = useDialog();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const { data: profile } = useQuery({
    queryKey: queryKeys.auth.profile,
    queryFn: () => profileApi.get(),
    staleTime: 60_000,
  });

  // Filter out archived companies
  const visibleCompanies = companies.filter((c) => c.status !== "archived");

  // Lazy-load stats (T4)
  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: queryKeys.companies.stats,
    queryFn: () => companiesApi.stats(),
    enabled: visibleCompanies.length > 0,
  });

  const stats: CompanyStats | undefined = statsData ?? undefined;

  if (companiesLoading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-bg text-dim">
        <span className="text-sm">Loading...</span>
      </div>
    );
  }

  const isEmpty = visibleCompanies.length === 0;
  const firstName = deriveFirstName(profile?.displayName ?? undefined, profile?.email ?? undefined);
  const pendingCompanies = stats
    ? visibleCompanies.filter((c) => (stats[c.id]?.pendingApprovalCount ?? 0) > 0).length
    : 0;
  const subtitleParts: string[] = [];
  subtitleParts.push(
    `${visibleCompanies.length} ${visibleCompanies.length === 1 ? "company" : "companies"}`,
  );
  if (pendingCompanies > 0) {
    subtitleParts.push(
      `${pendingCompanies} with pending approval${pendingCompanies === 1 ? "" : "s"}`,
    );
  }

  return (
    <div className="flex h-dvh bg-bg text-foreground bg-[radial-gradient(ellipse_120%_70%_at_50%_-10%,var(--brand-focus-ring)_0%,transparent_55%)]">
      {/* Desktop / tablet sidebar — inline, hidden on mobile */}
      <div className="hidden md:flex">
        <LobbySidebar onCreateCompany={() => openOnboarding()} />
      </div>

      {/* Mobile drawer sidebar — opens on hamburger click, hidden on tablet+ */}
      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent side="left" className="w-[260px] p-0 sm:max-w-[260px]">
          <LobbySidebar
            onCreateCompany={() => openOnboarding()}
            drawer
            onNavigate={() => setMobileMenuOpen(false)}
          />
        </SheetContent>
      </Sheet>

      {/* Main column — no header bar */}
      <main className="flex flex-1 flex-col overflow-auto min-w-0">
        {isEmpty ? (
          <LobbyEmptyState
            onCreate={() => openOnboarding()}
            onImport={() => navigate("/import")}
          />
        ) : (
          <div className="mx-auto w-full max-w-4xl px-4 py-5 sm:px-6 sm:py-7 md:px-10 md:py-9">
            {/* Mobile hamburger — hidden on tablet+ */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open menu"
              className="mb-4 inline-flex size-9 items-center justify-center rounded-md border border-border-strong bg-card text-very-dim hover:bg-card-2 hover:text-foreground md:hidden"
            >
              <Menu className="size-4" />
            </button>

            {/* Welcome */}
            <div className="mb-6 sm:mb-7 lobby-heading-enter">
              <h1 className="text-[1.25rem] sm:text-[1.4rem] md:text-[1.55rem] font-bold tracking-[-0.025em] text-foreground">
                Welcome back, {firstName}
                <span className="text-brand">.</span>
              </h1>
              <p className="mt-1 text-[0.82rem] sm:text-[0.86rem] text-dim">{subtitleParts.join(" · ")}.</p>
            </div>

            <div className="mb-3 sm:mb-3.5 text-[0.66rem] sm:text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-dim">
              Your companies
            </div>

            <div className="flex flex-col gap-3 sm:gap-3.5">
              {visibleCompanies.map((company, i) => (
                <div
                  key={company.id}
                  className="lobby-card-enter"
                  style={{ "--lobby-card-index": i } as CSSProperties}
                >
                  <LobbyCompanyCard
                    company={company}
                    stats={stats?.[company.id]}
                    statsLoading={statsLoading}
                    onClick={() => navigate(`/${company.issuePrefix}/home`)}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
