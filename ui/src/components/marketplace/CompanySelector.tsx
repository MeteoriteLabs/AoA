import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { useCompany } from "@/context/CompanyContext";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function initials(name: string | null | undefined, fallback: string): string {
  return ((name && name.trim()) || fallback).slice(0, 2).toUpperCase();
}

function avatarStyle(brandColor: string | null | undefined): React.CSSProperties {
  if (!brandColor) return {};
  return {
    backgroundColor: `${brandColor}22`, // ~13% opacity tint
    color: brandColor,
  };
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Shown in the MarketplaceLayout header so the user always knows which company
 * they are installing items for.
 *
 * - Single company  → read-only badge (name + initials)
 * - Multi-company   → clickable popover that calls setSelectedCompanyId so both
 *                     install modals (which read selectedCompanyId from
 *                     CompanyContext) automatically pick up the change
 */
export function CompanySelector() {
  const { companies, selectedCompany, setSelectedCompanyId } = useCompany();
  const [open, setOpen] = useState(false);

  const activeCompanies = companies.filter((c) => c.status !== "archived");

  if (!selectedCompany) return null;

  const isMulti = activeCompanies.length > 1;

  // ── Avatar sub-element ───────────────────────────────────────────────────
  function Avatar({ company }: { company: typeof selectedCompany }) {
    return (
      <span
        className="w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold shrink-0 bg-violet-500/15 text-violet-400"
        style={avatarStyle(company.brandColor)}
      >
        {initials(company.name, company.issuePrefix)}
      </span>
    );
  }

  // ── Single company — static badge ────────────────────────────────────────
  if (!isMulti) {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-border bg-card text-xs text-muted-foreground select-none">
        <Avatar company={selectedCompany} />
        <span className="max-w-[140px] truncate">
          {selectedCompany.name || selectedCompany.issuePrefix}
        </span>
      </div>
    );
  }

  // ── Multi-company — dropdown ─────────────────────────────────────────────
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-border bg-card hover:bg-accent text-xs text-muted-foreground transition-colors">
          <Avatar company={selectedCompany} />
          <span className="max-w-[120px] truncate">
            {selectedCompany.name || selectedCompany.issuePrefix}
          </span>
          <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-56 p-1.5" align="end">
        <p className="text-[10px] font-semibold tracking-widest uppercase text-muted-foreground px-2 pb-1.5">
          Installing for
        </p>
        {activeCompanies.map((company) => {
          const isSelected = company.id === selectedCompany.id;
          return (
            <button
              key={company.id}
              className={cn(
                "w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors",
                isSelected
                  ? "bg-violet-500/10 text-violet-300"
                  : "hover:bg-accent text-muted-foreground hover:text-foreground",
              )}
              onClick={() => {
                setSelectedCompanyId(company.id);
                setOpen(false);
              }}
            >
              <Avatar company={company} />
              <span className="flex-1 text-left text-xs truncate">
                {company.name || company.issuePrefix}
              </span>
              {isSelected && (
                <Check className="h-3.5 w-3.5 shrink-0 text-violet-400" />
              )}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
