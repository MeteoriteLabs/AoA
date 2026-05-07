import type { CSSProperties } from "react";
import { useNavigate } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Plus, Upload } from "lucide-react";
import { useCompany } from "@/context/CompanyContext";
import { useDialog } from "@/context/DialogContext";
import { companiesApi, type CompanyStats } from "@/api/companies";
import { queryKeys } from "@/lib/queryKeys";
import { LobbyCompanyCard } from "@/components/LobbyCompanyCard";
import { LobbyEmptyState } from "@/components/LobbyEmptyState";
import { LobbySidebar } from "@/components/LobbySidebar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function Lobby() {
  const { companies, loading: companiesLoading } = useCompany();
  const { openOnboarding } = useDialog();
  const navigate = useNavigate();

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

  return (
    <div className="flex h-dvh text-text bg-bg bg-[radial-gradient(ellipse_120%_70%_at_50%_-10%,var(--brand-focus-ring)_0%,transparent_55%)]">
      <LobbySidebar />

      {/* Main column */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Header */}
        <header className="flex items-center justify-between px-6 h-14 shrink-0 border-b border-border lobby-heading-enter">
          <h1 className="text-sm font-semibold text-text">Companies</h1>
          {!isEmpty && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="default">
                  <span>+ New</span>
                  <ChevronDown className="opacity-80" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={6} className="min-w-48">
                <DropdownMenuItem onSelect={() => openOnboarding()}>
                  <Plus />
                  Create company
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate("/import")}>
                  <Upload />
                  Import company
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </header>

        {/* Body */}
        <main className="flex flex-1 flex-col overflow-auto">
          {isEmpty ? (
            <LobbyEmptyState
              onCreate={() => openOnboarding()}
              onImport={() => navigate("/import")}
            />
          ) : (
            <div className="mx-auto w-full max-w-5xl px-6 py-10">
              <p className="text-sm text-muted-foreground">
                Select a company to get started.
              </p>
              <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
    </div>
  );
}
