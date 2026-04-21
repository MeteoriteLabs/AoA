import { useEffect, useRef } from "react";
import { useNavigate } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { Plus, Settings, Upload } from "lucide-react";
import { useCompany } from "@/context/CompanyContext";
import { useDialog } from "@/context/DialogContext";
import { companiesApi, type CompanyStats } from "@/api/companies";
import { queryKeys } from "@/lib/queryKeys";
import { LobbyCompanyCard } from "@/components/LobbyCompanyCard";
import { UserMenu } from "@/components/UserMenu";
import { cn } from "@/lib/utils";

export function Lobby() {
  const { companies, loading: companiesLoading } = useCompany();
  const { openOnboarding } = useDialog();
  const navigate = useNavigate();
  const onboardingTriggered = useRef(false);

  // Filter out archived companies
  const visibleCompanies = companies.filter((c) => c.status !== "archived");

  // Auto-trigger onboarding for new users with 0 companies (Decision UI-10)
  useEffect(() => {
    if (companiesLoading || onboardingTriggered.current) return;
    if (visibleCompanies.length === 0) {
      onboardingTriggered.current = true;
      openOnboarding();
    }
  }, [companiesLoading, visibleCompanies.length, openOnboarding]);

  // Lazy-load stats (T4)
  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: queryKeys.companies.stats,
    queryFn: () => companiesApi.stats(),
    enabled: visibleCompanies.length > 0,
  });

  const stats: CompanyStats | undefined = statsData ?? undefined;

  if (companiesLoading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background text-muted-foreground">
        <span className="text-sm">Loading...</span>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      {/* Minimal header */}
      <header className="flex items-center justify-between px-6 h-14 shrink-0 border-b border-border">
        <span className="text-sm font-bold tracking-tight text-foreground">AoA</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              navigate("/instance/settings");
            }}
            className={cn(
              "flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground",
              "hover:bg-accent hover:text-foreground transition-colors",
            )}
            aria-label="Settings"
          >
            <Settings className="h-4 w-4" />
          </button>
          <UserMenu collapsed />
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl px-6 py-10">
          <h1 className="text-xl font-semibold text-foreground">
            Welcome back
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Select a company to get started.
          </p>

          {/* Company card grid */}
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibleCompanies.map((company) => (
              <LobbyCompanyCard
                key={company.id}
                company={company}
                stats={stats?.[company.id]}
                statsLoading={statsLoading}
                onClick={() => navigate(`/${company.issuePrefix}/home`)}
              />
            ))}

            {/* Create Company card */}
            <button
              type="button"
              onClick={() => openOnboarding()}
              className={cn(
                "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-5",
                "text-muted-foreground transition-all duration-150",
                "hover:border-foreground/20 hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                "min-h-[120px]",
              )}
            >
              <Plus className="h-5 w-5" />
              <span className="text-sm font-medium">Create Company</span>
            </button>

            {/* Import Company card */}
            <button
              type="button"
              onClick={() => navigate("/import")}
              className={cn(
                "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-5",
                "text-muted-foreground transition-all duration-150",
                "hover:border-foreground/20 hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                "min-h-[120px]",
              )}
            >
              <Upload className="h-5 w-5" />
              <span className="text-sm font-medium">Import Company</span>
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
