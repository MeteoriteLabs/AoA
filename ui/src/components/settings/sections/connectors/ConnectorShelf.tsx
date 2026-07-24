import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Cable, Github } from "lucide-react";
import {
  mcpConnectorsApi,
  type McpConnector,
  type McpConnectorShelfEntry,
} from "@/api/mcpConnectors";
import { ApiError } from "@/api/client";
import { queryKeys } from "@/lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { isConsentFresh } from "./consentFreshness";
import { ConnectorInstallDialog, commandLine } from "./ConnectorInstallDialog";

/**
 * The single reason `installable` is ever false. The server computes it by
 * running the real D7 gate (`assertTransportAllowed`) and only reports the
 * boolean, but the gate has exactly one refusal branch — non-`local_trusted`
 * deployment + stdio + non-verified tier — so this copy cannot drift from it
 * without the gate itself gaining a second branch.
 *
 * Rendering the reason (rather than hiding the card, or greying it silently) is
 * the point: a capability that disappears without explanation is indistinguishable
 * from a bug, and founders work around bugs by pasting credentials into the
 * manual form.
 */
const UNAVAILABLE_REASON =
  "Unverified local connectors run a command on the AoA host, so this deployment " +
  "only allows verified catalog entries. Remote HTTP connectors are unaffected.";

function TrustPill({ tier }: { tier: string }) {
  if (tier === "verified") return null;
  return (
    <Badge variant="idle" className="text-[10px]">
      {tier === "unverified" ? "Unverified" : "Community"}
    </Badge>
  );
}

interface ShelfCardProps {
  entry: McpConnectorShelfEntry;
  installed: boolean;
  busy: boolean;
  onInstall: () => void;
}

/** Marketplace card chrome (design-system §9.13), minus the bits that only make
 *  sense for catalog items: no TypeChip (every card here is a connector) and no
 *  detail-page link (connectors have no detail route). */
function ShelfCard({ entry, installed, busy, onInstall }: ShelfCardProps) {
  const verified = entry.trust?.tier === "verified";
  const unavailable = !entry.installable;

  return (
    <div
      data-testid={`connector-shelf-card-${entry.id}`}
      className={cn(
        "relative rounded-xl border border-border-strong bg-card overflow-hidden p-4",
        unavailable ? "opacity-70" : "card-hover",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="size-12 shrink-0 rounded-2xl border bg-blue-500/15 border-blue-500/30 text-blue-500 flex items-center justify-center">
          <Cable className="size-5" />
        </div>
        <div className="min-w-0 flex-1 mt-0.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <h3 className="text-[1.05rem] font-semibold tracking-tight truncate">
              {entry.displayName}
            </h3>
            {verified && (
              <BadgeCheck
                data-testid="verified-check"
                className="size-4 shrink-0 text-[hsl(208_80%_60%)]"
                aria-label="Verified"
              />
            )}
            <TrustPill tier={entry.trust?.tier ?? "community"} />
          </div>
          <div className="mt-0.5 text-[12px] text-very-dim truncate font-mono">
            {entry.transport === "http" ? entry.url : commandLine(entry)}
          </div>
        </div>
      </div>

      {entry.description && (
        <p className="mt-3 text-[12.5px] text-dim leading-relaxed line-clamp-2">
          {entry.description}
        </p>
      )}

      {entry.requiresSecret && (
        <div className="mt-2 text-[11.5px] text-very-dim">
          Needs a credential{entry.secretLabel ? `: ${entry.secretLabel}` : ""}
        </div>
      )}

      {unavailable && (
        <div className="mt-3 rounded-md border border-border bg-card-2 px-2.5 py-2 text-[11.5px] text-dim">
          <span className="font-medium text-foreground">Unavailable in this deployment. </span>
          {UNAVAILABLE_REASON}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0 text-[11.5px] text-very-dim">
          {entry.docsUrl ? (
            <a
              href={entry.docsUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 hover:text-foreground"
            >
              <Github className="size-3 shrink-0" />
              <span className="truncate">Docs</span>
            </a>
          ) : (
            <span className="truncate">{entry.transport === "http" ? "HTTP" : "Local (stdio)"}</span>
          )}
        </div>
        {installed ? (
          <Badge variant="active" className="h-7 px-2.5 shrink-0">
            Installed
          </Badge>
        ) : unavailable ? null : (
          <Button
            size="sm"
            className="text-[11.5px] h-7 px-3 shrink-0"
            onClick={onInstall}
            disabled={busy}
            aria-label={`Install ${entry.displayName}`}
          >
            {busy ? "…" : "Install"}
          </Button>
        )}
      </div>
    </div>
  );
}

export interface ConnectorShelfProps {
  companyId: string;
  /** The company's already-registered connectors, used to mark installed cards.
   *  Matched on `serverName`, which is the (companyId, serverName) uniqueness
   *  key the server enforces — installing a second time 409s. */
  installed: McpConnector[];
  /** Called after a successful install so the section can point the founder at
   *  the credential step when the new connector landed unconfigured. */
  onInstalled: (connector: McpConnector) => void;
}

/**
 * The curated connector shelf.
 *
 * WHY IT LIVES IN SETTINGS → CONNECTORS rather than the Marketplace surface:
 * the catalog endpoint is company-scoped AND founder-only, while the Marketplace
 * renders inside `LobbyShell` — a pre-company-selection surface with no
 * guaranteed company in context. More importantly the journey does not end at
 * install: a catalog connector lands as `needs_credentials` and is useless until
 * a secret is bound and (in shared deployments) an approval clears. Browse →
 * install → bind → enable-for-agents is one continuous task, and splitting its
 * first step onto another route would hand the founder a connector and no way
 * back to finish it.
 */
export function ConnectorShelf({ companyId, installed, onInstalled }: ConnectorShelfProps) {
  const queryClient = useQueryClient();
  const [dialogEntryId, setDialogEntryId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const catalogQuery = useQuery({
    queryKey: queryKeys.mcpConnectors.catalog(companyId),
    queryFn: () => mcpConnectorsApi.catalog(companyId),
  });

  const entries = catalogQuery.data?.entries ?? [];
  // Derived from LIVE query data, not captured at open time: when the freshness
  // check below refetches, the open dialog re-renders against the refreshed
  // entry (new token, and the command that token was minted for) automatically.
  const dialogEntry = entries.find((e) => e.id === dialogEntryId) ?? null;
  const installedNames = new Set(installed.map((c) => c.serverName));

  const installMutation = useMutation({
    mutationFn: (body: { entryId: string; consentToken?: string }) =>
      mcpConnectorsApi.install(companyId, body),
    onSuccess: (created) => {
      setError(null);
      setDialogEntryId(null);
      setPendingId(null);
      // Invalidating the LIST key also invalidates the catalog (it is a prefix
      // of the catalog key), which re-mints consent tokens — cheap and correct.
      queryClient.invalidateQueries({ queryKey: queryKeys.mcpConnectors.list(companyId) });
      onInstalled(created);
    },
    onError: (err) => {
      setPendingId(null);
      setError(err instanceof ApiError ? err.message : "Failed to install connector");
    },
  });

  const handleInstall = async (entry: McpConnectorShelfEntry) => {
    setError(null);

    // Verified entries and every http entry install straight through: there is
    // no host command to consent to, and the server asks for no token.
    if (!entry.consentRequired) {
      setPendingId(entry.id);
      installMutation.mutate({ entryId: entry.id });
      return;
    }

    if (isConsentFresh(entry)) {
      setDialogEntryId(entry.id);
      return;
    }

    // Stale (or never-minted) token → refetch BEFORE showing the dialog, so the
    // founder never confirms a command bound to a token the server will reject.
    setPendingId(entry.id);
    const refreshed = await catalogQuery.refetch();
    setPendingId(null);
    const fresh = refreshed.data?.entries.find((e) => e.id === entry.id);
    if (!fresh) {
      setError(`"${entry.displayName}" is no longer in the connector catalog.`);
      return;
    }
    if (!fresh.installable) {
      setError(`"${entry.displayName}" is not installable in this deployment.`);
      return;
    }
    setDialogEntryId(entry.id);
  };

  if (catalogQuery.isLoading) {
    return <div className="text-sm text-muted-foreground">Loading connector catalog…</div>;
  }
  if (catalogQuery.isError) {
    return (
      <div className="text-sm text-muted-foreground">
        Could not load the connector catalog. You can still add a connector by hand below.
      </div>
    );
  }
  if (entries.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No curated connectors are available right now. You can add one by hand below.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {catalogQuery.data?.stale && (
        <div className="text-[11.5px] text-very-dim">
          Showing a cached catalog — the connector directory could not be refreshed.
        </div>
      )}
      {error && <div className="text-sm text-destructive">{error}</div>}
      <div className="grid gap-3 sm:grid-cols-2">
        {entries.map((entry) => (
          <ShelfCard
            key={entry.id}
            entry={entry}
            installed={installedNames.has(entry.serverName)}
            busy={pendingId === entry.id}
            onInstall={() => void handleInstall(entry)}
          />
        ))}
      </div>

      <ConnectorInstallDialog
        entry={dialogEntry}
        onClose={() => {
          setDialogEntryId(null);
          setError(null);
        }}
        onConfirm={(entry) =>
          installMutation.mutate({ entryId: entry.id, consentToken: entry.consentToken })
        }
        busy={installMutation.isPending}
        error={dialogEntryId ? error : null}
      />
    </div>
  );
}
