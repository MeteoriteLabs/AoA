import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useNavigate } from "@/lib/router";
import { ArrowLeft, ChevronRight, Store } from "lucide-react";
import { SearchTypeahead } from "./SearchTypeahead";

export interface MarketplaceLayoutProps {
  /** Optional breadcrumb segments after "Marketplace". */
  breadcrumbs?: Array<{ label: string; to?: string }>;
  /** Right-aligned slot for actions. Defaults to <SearchTypeahead />. Pass `null` to suppress. */
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * Shared layout wrapper for all marketplace pages.
 * Renders consistent header with Marketplace icon + breadcrumb trail + actions slot.
 */
export function MarketplaceLayout({ breadcrumbs = [], actions, children }: MarketplaceLayoutProps) {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col h-screen">
      <header className="border-b px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/home")}
            aria-label="Go back"
            className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-accent"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="w-px h-4 bg-border" />
        </div>
        <nav className="flex items-center gap-2 text-sm flex-1">
          <Link
            to="/marketplace"
            className="flex items-center gap-2 hover:text-foreground text-muted-foreground"
          >
            <Store className="h-4 w-4" />
            <span>Marketplace</span>
          </Link>
          {breadcrumbs.map((crumb, i) => (
            <span key={i} className="flex items-center gap-2 text-muted-foreground">
              <ChevronRight className="h-3 w-3" />
              {crumb.to ? (
                <Link to={crumb.to} className="hover:text-foreground">
                  {crumb.label}
                </Link>
              ) : (
                <span className="text-foreground">{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>
        <div className="flex items-center gap-2 shrink-0">{actions !== undefined ? actions : <SearchTypeahead />}</div>
      </header>
      <main className="flex-1 overflow-auto px-6 py-6">{children}</main>
    </div>
  );
}
