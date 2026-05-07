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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

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
      <div className="flex h-dvh items-center justify-center bg-background text-muted-foreground">
        <span className="text-sm">Loading...</span>
      </div>
    );
  }

  const isEmpty = visibleCompanies.length === 0;

  return (
    <div className="flex h-dvh bg-background text-foreground">
      <LobbySidebar />

      {/* Main column */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Header */}
        <header className="flex items-center justify-between px-6 h-14 shrink-0 border-b border-border">
          <h1 className="text-sm font-semibold text-foreground">Companies</h1>
          {!isEmpty && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-sm font-medium",
                    "bg-primary text-primary-foreground transition-colors",
                    "hover:bg-primary/90",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  )}
                >
                  <span>+ New</span>
                  <ChevronDown className="h-3.5 w-3.5 opacity-80" />
                </button>
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
                {visibleCompanies.map((company) => (
                  <LobbyCompanyCard
                    key={company.id}
                    company={company}
                    stats={stats?.[company.id]}
                    statsLoading={statsLoading}
                    onClick={() => navigate(`/${company.issuePrefix}/home`)}
                  />
                ))}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
