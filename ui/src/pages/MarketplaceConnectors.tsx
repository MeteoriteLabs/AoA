import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Cable, Search } from "lucide-react";
import { useCompany } from "@/context/CompanyContext";
import { useTeamAccess } from "@/hooks/useTeamAccess";
import { mcpConnectorsApi, type McpConnector } from "@/api/mcpConnectors";
import { queryKeys } from "@/lib/queryKeys";
import { Link } from "@/lib/router";
import { LobbyShellMobileMenuButton } from "@/components/LobbyShell";
import { CompanyPicker } from "@/components/marketplace/install/CompanyPicker";
import { ConnectorShelf } from "@/components/marketplace/connectors/ConnectorShelf";
import { useMarketplaceSidebar } from "@/components/marketplace/useMarketplaceSidebar";
import { cn } from "@/lib/utils";

/**
 * Marketplace → Connectors: browse + install external MCP servers, a sibling of
 * the Skills / Plugins / Agents / Teams surfaces.
 *
 * ── Why this is a page of its own rather than another `?type=` section ────────
 * Connectors are NOT catalog items. `catalog.json` is parsed with a whole-array
 * `z.enum` of item types, so adding `"connector"` to `MarketplaceItemTypeSchema`
 * would make one unknown entry fail the entire catalog parse — and the sync
 * failure path PRESERVES the previous cache, freezing skills and agents for every
 * deployed instance. (Pinned by `server/src/__tests__/connector-catalog-isolation.test.ts`.)
 * Connectors therefore come from their own company-scoped endpoint
 * (`GET …/mcp-connectors/catalog`) and are rendered ALONGSIDE the catalog, never
 * through it. `pathToItemType()` still returns null for "connectors"; this route
 * is a static path that never reaches it.
 *
 * ── Company context ──────────────────────────────────────────────────────────
 * Same mechanism as every other install on this surface (see
 * `install/SnapshotInstallModal.tsx`): default to `CompanyContext.selectedCompanyId`,
 * and render `CompanyPicker` — which auto-hides at ≤1 active company — when the
 * founder has several. The picker is hoisted to the page (rather than living in
 * a modal) only because the connector CATALOG read is itself company-scoped, so
 * the target must be known before anything can be listed.
 */
export default function MarketplaceConnectors() {
  useMarketplaceSidebar("connector");

  const { selectedCompanyId, companies, loading: companiesLoading } = useCompany();
  const [pickedCompanyId, setPickedCompanyId] = useState<string | null>(null);
  const companyId = pickedCompanyId ?? selectedCompanyId ?? null;

  const activeCompanies = useMemo(
    () => companies.filter((c) => c.status !== "archived"),
    [companies],
  );

  const { role, isLoading: roleLoading } = useTeamAccess(companyId);
  // Default to the RESTRICTIVE assumption while the role loads: the catalog
  // endpoint is founder-only and mints signed install material, so never flash
  // the shelf at someone who may turn out not to be a founder.
  const isFounder = role === "founder";

  const { data: connectors } = useQuery({
    queryKey: companyId ? queryKeys.mcpConnectors.list(companyId) : ["mcp-connectors", "none"],
    queryFn: () => mcpConnectorsApi.list(companyId!),
    enabled: !!companyId && isFounder,
  });

  const [search, setSearch] = useState("");
  const [installed, setInstalled] = useState<McpConnector | null>(null);
  // A notice about company A must not survive a switch to company B.
  useEffect(() => setInstalled(null), [companyId]);

  const settingsLink = (
    <Link to="/settings?tab=connectors" className="text-brand hover:underline">
      Settings → Connectors
    </Link>
  );

  return (
    <div className="mx-auto w-full max-w-[1080px] px-4 py-6 sm:px-6 sm:py-7 md:px-10 md:py-9">
      <LobbyShellMobileMenuButton className="mb-4" />

      <div className="mb-5">
        <h1 className="text-[1.55rem] font-bold tracking-tight">
          Connectors<span className="text-brand">.</span>
        </h1>
        <p className="mt-1 text-[0.86rem] text-dim">
          External tools and data sources your agents can reach — Notion, Linear, Sentry,
          and more. Install here; manage credentials and per-agent access in {settingsLink}.
        </p>
      </div>

      {activeCompanies.length > 1 && (
        <div className="mb-5 max-w-xs" data-testid="connector-company-picker">
          <CompanyPicker value={companyId} onChange={setPickedCompanyId} />
        </div>
      )}

      {!companyId ? (
        <EmptyPanel>
          {companiesLoading
            ? "Loading your companies…"
            : "Create or select a company to install connectors."}
        </EmptyPanel>
      ) : roleLoading ? (
        <EmptyPanel>Loading…</EmptyPanel>
      ) : !isFounder ? (
        <EmptyPanel>
          Only founders can browse and install connectors. Ask a founder on your team to
          add the connector you need.
        </EmptyPanel>
      ) : (
        <>
          <div className="mb-5 relative">
            <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-very-dim pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search connectors…"
              aria-label="Search connectors"
              className="w-full h-9 pl-9 pr-3 rounded-md bg-card border border-border text-sm placeholder:text-very-dim focus:outline-none focus:border-border-strong"
            />
          </div>

          {installed && (
            <div
              data-testid="connector-install-notice"
              className="mb-5 rounded-md border border-info/30 bg-info/[0.06] px-3 py-2.5 text-sm"
            >
              {installed.status === "needs_credentials" ? (
                <>
                  <strong>{installed.displayName}</strong> is installed but needs a
                  credential before agents can use it — finish setup in {settingsLink}.
                </>
              ) : installed.status === "pending_approval" ? (
                <>
                  <strong>{installed.displayName}</strong> is installed and waiting for
                  board approval. Track it in {settingsLink}.
                </>
              ) : (
                <>
                  <strong>{installed.displayName}</strong> is installed and active. Choose
                  which agents may use it in {settingsLink}.
                </>
              )}
            </div>
          )}

          <ConnectorShelf
            companyId={companyId}
            installed={connectors ?? []}
            onInstalled={setInstalled}
            search={search}
          />
        </>
      )}
    </div>
  );
}

function EmptyPanel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      data-testid="marketplace-connectors-empty"
      className={cn(
        "rounded-xl border border-border bg-card px-6 py-12 text-center text-sm text-dim",
        className,
      )}
    >
      <Cable className="mx-auto mb-3 size-6 text-very-dim" />
      {children}
    </div>
  );
}
